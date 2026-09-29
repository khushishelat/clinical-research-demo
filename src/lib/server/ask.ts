// Server-only. Job 4: Ask, on the Responses API with connectors. Public,
// capped per IP and per day, cached for 24 hours. An answer never changes a
// flag or a pack; it is labeled as a quick answer, not a check.
//
// Validated in validation/06-responses.ts: `data_sources` is a top-level
// field; effort "low" is rejected with connectors; web_search_call items
// stream live, mcp_call items and the answer text arrive at the end.

import { createHash } from 'node:crypto';
import type { Pack } from '../domain/types';
import type { Context } from './context';
import { allowRequest, reserveBudget } from './guards';

export const ASK_CONNECTORS = ['clinical_trials', 'pubmed'] as const;
const ASK_PRICE_USD = 0.05; // reasoning.effort "medium"
const CACHE_TTL = 24 * 60 * 60;
export const MAX_QUESTION_CHARS = 500;

export type AskEvent =
  | { k: 'search'; n: number }
  | { k: 'connector'; connector: string; tool: string; error: string | null }
  | { k: 'text'; delta: string }
  | { k: 'done'; text: string; citations: { url: string; title: string | null }[]; cached: boolean }
  | { k: 'error'; message: string };

type Cached = Extract<AskEvent, { k: 'done' }> & { connectors: Extract<AskEvent, { k: 'connector' }>[] };

export const normalizeQuestion = (q: string) => q.toLowerCase().replace(/\s+/g, ' ').replace(/[?.!\s]+$/, '').trim();

const cacheKey = (key: string, nct: string | undefined, q: string) =>
  `ask:${createHash('sha256').update(`${key}|${nct ?? ''}|${normalizeQuestion(q)}`).digest('hex').slice(0, 32)}`;

/** A short grounding block from the pack, so the answer starts from what we recorded. */
export function groundingFor(pack: Pack | null, company: string, nct?: string): string {
  const lines = [`Company: ${company}.`];
  if (pack) lines.push(`Research recorded ${pack.about.recorded}.`);
  const row = nct ? pack?.rows.find((r) => r.nct_id === nct) : undefined;
  const found = nct ? pack?.found_beyond_registry_search.find((f) => f.nct_id === nct) : undefined;
  if (nct) lines.push(`Trial: ${nct}${row ? `, "${row.title}", lead sponsor ${row.lead_sponsor}, registry status ${row.status}, last update posted ${row.last_update_posted}` : found?.registry ? `, "${found.registry.title}", lead sponsor ${found.registry.lead_sponsor}, registry status ${found.registry.status}` : ''}.`);
  const check = row?.check ?? found?.check;
  if (check?.latest_milestone) lines.push(`Latest recorded milestone: ${check.latest_milestone.type} on ${check.latest_milestone.date ?? 'unknown date'}: ${check.latest_milestone.description} (${check.latest_milestone.source_url ?? 'no URL'}).`);
  if (check?.next_catalyst?.description) lines.push(`Next catalyst on record: ${check.next_catalyst.description} (${check.next_catalyst.timing_text ?? 'timing not stated'}).`);
  if (!nct && pack?.snapshot?.programs?.length) lines.push(`Programs on record: ${pack.snapshot.programs.slice(0, 8).map((p) => `${p.asset} in ${p.indication} (${p.phase})`).join('; ')}.`);
  return lines.join('\n').slice(0, 2500);
}

export function askInput(question: string, grounding: string): string {
  return [
    'You answer questions about clinical trials and drug pipelines for competitive-intelligence analysts.',
    'Use the ClinicalTrials.gov and PubMed data sources and the web. Prefer primary sources (company releases, filings, registries, papers). Give dates. Say when something is not publicly known.',
    'Do not give investment advice. If the question is not about clinical trials, drugs or this company, say briefly that it is out of scope.',
    '',
    'What we have on record (may be out of date):',
    grounding,
    '',
    `Question: ${question}`,
  ].join('\n');
}

export type AskRequest = { key: string; company: string; nct_id?: string; question: string; pack: Pack | null };

/** Streams an answer. Checks limits first; yields exactly one `done` or `error` at the end. */
export async function* ask(c: Context, req: AskRequest, client: string): AsyncGenerator<AskEvent> {
  const question = req.question.trim().slice(0, MAX_QUESTION_CHARS);
  if (question.length < 3) {
    yield { k: 'error', message: 'Ask a question about this company or trial.' };
    return;
  }
  const ck = cacheKey(req.key, req.nct_id, question);
  const hit = await c.kv.get(ck);
  if (hit) {
    const cached = JSON.parse(hit) as Cached;
    for (const e of cached.connectors) yield e;
    yield { k: 'done', text: cached.text, citations: cached.citations, cached: true };
    return;
  }
  if (!c.responses) {
    yield { k: 'error', message: 'Ask is live-only; this deployment serves recorded research.' };
    return;
  }
  if (!(await allowRequest(c.kv, 'ask', client, c.settings.perIpPerDay.ask, c.now()))) {
    yield { k: 'error', message: "You've reached today's question limit. It resets tomorrow." };
    return;
  }
  if (!(await reserveBudget(c.kv, 'ask', ASK_PRICE_USD, c.settings.budgets.ask, c.now()))) {
    yield { k: 'error', message: 'Ask has answered as many questions as it can today. It resets tomorrow.' };
    return;
  }

  const body = {
    model: 'parallel',
    input: askInput(question, groundingFor(req.pack, req.company, req.nct_id)),
    reasoning: { effort: 'medium' },
    // Parallel extension; the OpenAI SDK sends unknown fields as they are.
    data_sources: { free: [...ASK_CONNECTORS] },
    stream: true,
  };
  const connectors: Extract<AskEvent, { k: 'connector' }>[] = [];
  let text = '';
  let searches = 0;
  let citations: { url: string; title: string | null }[] = [];
  try {
    const stream = (await c.responses.responses.create(body as any)) as unknown as AsyncIterable<any>;
    for await (const e of stream) {
      if (e.type === 'response.output_item.added' && e.item?.type === 'web_search_call') yield { k: 'search', n: ++searches };
      else if (e.type === 'response.output_item.done' && e.item?.type === 'mcp_call') {
        const ev = { k: 'connector' as const, connector: String(e.item.server_label ?? ''), tool: String(e.item.name ?? ''), error: e.item.error ?? null };
        connectors.push(ev);
        yield ev;
      } else if (e.type === 'response.output_text.delta' && e.delta) {
        text += e.delta;
        yield { k: 'text', delta: e.delta };
      } else if (e.type === 'response.completed') {
        const items: any[] = e.response?.output ?? [];
        const message = items.find((i) => i.type === 'message');
        const part = message?.content?.find((p: any) => p.type === 'output_text');
        text = part?.text ?? text;
        const seen = new Set<string>();
        citations = (part?.annotations ?? [])
          .filter((a: any) => a.type === 'url_citation' && a.url && !seen.has(a.url) && seen.add(a.url))
          .map((a: any) => ({ url: a.url, title: a.title ?? null }));
        for (const m of items.filter((i) => i.type === 'mcp_call')) {
          if (connectors.some((x) => x.tool === m.name && x.connector === m.server_label)) continue;
          const ev = { k: 'connector' as const, connector: String(m.server_label ?? ''), tool: String(m.name ?? ''), error: m.error ?? null };
          connectors.push(ev);
          yield ev;
        }
      }
    }
  } catch (error) {
    yield { k: 'error', message: `Ask failed (${(error as { status?: number }).status ?? 'network'}). Try again in a minute.` };
    return;
  }
  const done: Cached = { k: 'done', text, citations, cached: false, connectors };
  if (text) await c.kv.set(ck, JSON.stringify(done), { exSeconds: CACHE_TTL });
  yield { k: 'done', text, citations, cached: false };
}
