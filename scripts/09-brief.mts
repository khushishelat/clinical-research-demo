// Step 9: the weekly brief, a deep-research Task run (ultra2x, text output, the
// ClinicalTrials.gov and PubMed connectors). It starts from the week's known
// events (registry changes, the pipeline's disclosures, catalysts due in the
// next 30 days), keeps the material ones, and researches what they miss. The
// run is recorded live, so the brief can show how it was made.
//   npx tsx scripts/09-brief.mts --disease mash [--days 14]

import { disease, log, parallel, recorder, runLog, runOnce, saveReplay, spacePath, store, today, where } from './lib/pipeline';
import { assertNoContacts, redactContacts } from './lib/registry';
import { BRIEF } from './lib/specs';

const d = disease();
const client = parallel(d, 'brief');
if (!client) process.exit(0);
const i = process.argv.indexOf('--days');
const days = i > 0 ? Number(process.argv[i + 1]) : 7;
const to = today();
const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
const horizon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const { events, catalysts } = (await store.get<{ events: any[]; catalysts: any[] }>(spacePath(d, 'events.json')))!;
const { companies } = (await store.get<{ companies: any[] }>(spacePath(d, 'companies.json')))!;
const { trials } = (await store.get<{ trials: any[] }>(spacePath(d, 'trials.json')))!;
const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
const included = new Set(review.filter((r) => r.include).map((r) => r.company));
const name = new Map(companies.map((c) => [c.key, c.name]));
const inPeriod = events.filter((e) => e.date >= from && e.date <= to).map((e) => ({ date: e.date, company: name.get(e.company) ?? e.company, type: e.type, headline: e.headline, nct: e.nct ?? null, source_url: e.source_url, origin: e.origin }));
const disclosures = inPeriod.filter((e) => e.origin !== 'registry').map(({ origin: _, ...e }) => e);
const registryChanges = inPeriod.filter((e) => e.origin === 'registry').map(({ origin: _, ...e }) => e);
const upcoming = catalysts.filter((c) => (c.earliest ?? c.date ?? '') >= to && (c.earliest ?? c.date ?? '') <= horizon).map((c) => ({ company: name.get(c.company) ?? c.company, what: c.what, timing: c.timing_text, stated_by: c.stated_by, source_url: c.source_url }));
const onMap = companies.filter((c) => !c.web_only || included.has(c.name)).map((c) => ({ name: c.name, drugs: c.drugs.slice(0, 3).map((x: any) => x.name) }));
// A Task run's spec and input together must stay under 60,000 characters. A large
// indication's trial list alone can pass that (obesity: 380 company trials), and the run can
// look any trial up with the ClinicalTrials.gov connector, so the list is trimmed to fit:
// active trials first, then the latest phase, then the newest.
const LIMIT = 55_000;
const ACTIVE = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION']);
const allTrials = trials
  .filter((t) => t.run_by === 'company')
  .sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status)) || b.phase_level - a.phase_level || String(b.first_posted).localeCompare(String(a.first_posted)))
  .map((t) => ({ nct: t.nct, acronym: t.acronym || null, sponsor: t.sponsor, phase: t.phases.join('/'), status: t.status }));
const known = { disclosures, registry_changes: registryChanges, upcoming_30_days: upcoming };
const size = (n: number) => JSON.stringify(BRIEF.schema).length + JSON.stringify(BRIEF.input(d, { from, to }, known, onMap, allTrials.slice(0, n))).length;
let keep = allTrials.length;
while (keep > 0 && size(keep) > LIMIT) keep = Math.floor(keep * 0.9);
const companyTrials = allTrials.slice(0, keep);
if (keep < allTrials.length) log(d, `brief input: ${keep} of ${allTrials.length} company trials (active first, latest phase first) to stay under the 60,000-character limit`);

const rl = await runLog(d, 'brief');
const replay = recorder();
const rec = await runOnce(
  client,
  rl,
  `${BRIEF.key}:${from}:${to}`,
  { processor: BRIEF.processor, connectors: BRIEF.connectors, schema: BRIEF.schema, input: BRIEF.input(d, { from, to }, known, onMap, companyTrials), metadata: { job: 'brief', disease: d.key } },
  replay
);
if (replay.events.length) await saveReplay(d, `brief-${to}`, replay);
if (rec.status !== 'completed' || typeof rec.content !== 'string') throw new Error(`brief run ${rec.run_id} ${rec.status ?? 'returned no text'}`);

// Connector lookups are cited as "pubmed: get_article_metadata"; name the record instead.
const connectorTitle = (t: string) => (/^pubmed:\s*\w+$/.test(t) ? 'PubMed record' : /^clinical_trials:\s*\w+$/.test(t) ? 'ClinicalTrials.gov record' : t);
// The headline is the first "# " line; numbered references become links for the inline [n] citations.
const markdown = redactContacts(rec.content.trim());
const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? `${d.name} this week`;
const refs = markdown.split(/^##\s+References\s*$/im)[1] ?? '';
const references = [...refs.matchAll(/^\s*(\d+)\.\s+(.*?)\s*(https?:\/\/\S+?)\s*$/gm)].map((m) => ({ n: Number(m[1]), title: connectorTitle(m[2].replace(/[*.]+\s*$/, '').replace(/^\*|\*$/g, '').trim()), url: m[3] }));
const body = markdown.replace(/^#\s+.+\n+/, '').split(/^##\s+References\s*$/im)[0].trim();
const doc = { disease: d.key, date: to, from, title, markdown: body, references, run_id: rec.run_id, spec: BRIEF.key, seconds: rec.seconds ?? null, connectors: rec.connectors ?? {} };
assertNoContacts('brief', doc);
await store.put(spacePath(d, `briefs/${to}.json`), doc);
const idx = (await store.get<{ issues: string[] }>(spacePath(d, 'briefs/index.json'))) ?? { issues: [] };
await store.put(spacePath(d, 'briefs/index.json'), { issues: [...new Set([...idx.issues, to])].sort().reverse() });
log(d, `brief "${title}": ${references.length} references, from ${disclosures.length} disclosures and ${registryChanges.length} registry changes · saved to ${where}spaces/${d.key}/briefs/${to}.json`);
