// Step 9: the brief (core), written only from the period's disclosures and
// registry changes and the next 30 days of catalysts. Every source must come from the
// input; anything else is dropped.
//   npx tsx scripts/09-brief.mts --disease mash [--days 14]

import { disease, log, parallel, recorder, runLog, runOnce, saveReplay, spacePath, store, today, where } from './lib/pipeline';
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
const name = new Map(companies.map((c) => [c.key, c.name]));
const inPeriod = events.filter((e) => e.date >= from && e.date <= to).map((e) => ({ date: e.date, company: name.get(e.company) ?? e.company, type: e.type, headline: e.headline, source_url: e.source_url, origin: e.origin }));
const disclosures = inPeriod.filter((e) => e.origin !== 'registry').map(({ origin: _, ...e }) => e);
const registryChanges = inPeriod.filter((e) => e.origin === 'registry').map(({ origin: _, ...e }) => e);
const week = [...disclosures, ...registryChanges];
const upcoming = catalysts.filter((c) => (c.earliest ?? c.date ?? '') >= to && (c.earliest ?? c.date ?? '') <= horizon).map((c) => ({ company: name.get(c.company) ?? c.company, what: c.what, timing: c.timing_text, stated_by: c.stated_by, source_url: c.source_url }));
if (!week.length) {
  log(d, `no events between ${from} and ${to}; no brief for this period`);
  process.exit(0);
}
const rl = await runLog(d, 'brief');
// The run is recorded live, so the brief can show how it was made (replay/brief-<date>.json).
const replay = recorder();
const rec = await runOnce(client, rl, `${BRIEF.key}:${from}:${to}`, { processor: BRIEF.processor, schema: BRIEF.schema, input: BRIEF.input(d, { from, to }, disclosures, registryChanges, upcoming), metadata: { job: 'brief', disease: d.key } }, replay);
if (replay.events.length) await saveReplay(d, `brief-${to}`, replay);
const allowed = new Set([...week, ...upcoming].map((x) => x.source_url).filter(Boolean));
const brief: any = rec.content;
let dropped = 0;
for (const s of brief?.sections ?? []) {
  const before = s.sources.length;
  s.sources = s.sources.filter((u: string) => allowed.has(u));
  dropped += before - s.sources.length;
}
const sections = (brief?.sections ?? []).filter((s: any) => s.sources.length);
await store.put(spacePath(d, `briefs/${to}.json`), { disease: d.key, date: to, from, title: brief?.title, sections, run_id: rec.run_id });
const idx = (await store.get<{ issues: string[] }>(spacePath(d, 'briefs/index.json'))) ?? { issues: [] };
await store.put(spacePath(d, 'briefs/index.json'), { issues: [...new Set([...idx.issues, to])].sort().reverse() });
log(d, `brief "${brief?.title}": ${sections.length} sections from ${week.length} events (${dropped} uncited sources dropped) · saved to ${where}spaces/${d.key}/briefs/${to}.json`);
