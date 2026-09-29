import { ask, MAX_QUESTION_CHARS } from '@/lib/server/ask';
import { loadPack } from '@/lib/server/context';
import { clientId } from '@/lib/server/guards';
import { badRequest, context, isKey, sse } from '@/lib/server/http';
import { requestState, resolveCompany } from '@/lib/server/research';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Ask a question on the Responses API with connectors. Streams; never changes a pack or a flag. */
export async function POST(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  let body: { key?: unknown; nct_id?: unknown; question?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('Send JSON: { "key": "...", "question": "..." }.');
  }
  if (typeof body.key !== 'string' || !isKey(body.key)) return badRequest('Unknown company.');
  if (typeof body.question !== 'string' || body.question.length > MAX_QUESTION_CHARS * 2) return badRequest('Ask a shorter question.');
  const nct = typeof body.nct_id === 'string' && /^NCT\d{8}$/.test(body.nct_id) ? body.nct_id : undefined;
  const pack = (await loadPack(body.key, c))?.pack ?? null;
  const company = pack?.about.company ?? (await resolveCompany(c, { key: body.key }))?.name ?? (await requestState(c, body.key))?.company.name;
  if (!company) return badRequest('Unknown company.');
  const req = { key: body.key, company, nct_id: nct, question: body.question, pack };
  const who = clientId(request);
  return sse(async (send) => {
    for await (const e of ask(c, req, who)) send(e);
  }, request.signal);
}
