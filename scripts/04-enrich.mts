// Step 4: company facts and trial readouts. One Task Group per disease:
//   a. per company, a FACTS run for clinical facts (pro, ClinicalTrials.gov +
//      PubMed connectors) and a DEALS run for deal terms, financings and
//      regulatory events (pro)
//   b. one READOUT run per company trial in Phase 2 or later that has reached
//      primary completion or reported data (core, same connectors)
// plus Medicare coverage for the approved drugs (core, CMS Coverage connector).
// Every field keeps its basis for the table view. Companies found only on the
// web are researched once a person approves them in review/companies.json.
//   npx tsx scripts/04-enrich.mts --disease mash

import type { Company, Facts, Readout } from '../src/lib/space/types';
import { isApproved } from './lib/companies';
import { disease, groupRuns, log, parallel, recorder, runLog, runOnce, saveReplay, spacePath, store, today, where } from './lib/pipeline';
import { assertNoContacts, redactContacts, type Trial } from './lib/registry';
import { COVERAGE, DEALS, FACTS, READOUT } from './lib/specs';
import { cleanFacts, dealsUnit, factsUnit, readoutTrials, readoutUnit } from './lib/units';

const d = disease();
const client = parallel(d, 'enrich');
if (!client) process.exit(0);
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
if (!companies.length) throw new Error('No companies yet. Run 03-companies first.');
const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
const approved = new Set(review.filter((r) => r.include).map((r) => r.company));
const pending = review.filter((r) => r.include === null).length;

// Registry companies always; web-only companies once a person says include.
const targets = companies.filter((c) => !c.web_only || approved.has(c.name));
const byNct = new Map(trials.map((t) => [t.nct, t]));
const rl = await runLog(d, 'enrich');

// a. Company facts.
const units = targets.flatMap((c) => [factsUnit(d, today(), c, byNct), dealsUnit(d, today(), c, byNct)]);
log(d, `researching ${targets.length} companies, two runs each (${pending} web-only companies await review)`);
const rec = recorder();
const results = await groupRuns(client, rl, d, 'facts', units, 12, rec);
await saveReplay(d, 'facts', rec);
const factsOf = new Map(targets.map((c) => { const f = results[`${FACTS.key}:${c.key}`]?.content as Facts | undefined; const deals = results[`${DEALS.key}:${c.key}`]?.content as Facts | undefined; return [c.key, f && deals ? cleanFacts(c, f, deals) : undefined]; }));

// b. Readouts, for trials that could have them.
const readoutJobs = targets.flatMap((c) => readoutTrials(c, byNct, factsOf.get(c.key), today()).map((t) => ({ c, t })));
const readouts = await groupRuns(client, rl, d, 'readouts', readoutJobs.map(({ c, t }) => readoutUnit(d, today(), t, c)), 12);
log(d, `readouts: ${readoutJobs.length} trials checked · ${readoutJobs.filter(({ t }) => (readouts[`${READOUT.key}:${t.nct}`]?.content as Readout | undefined)?.has_data).length} have reported data`);

const drugsApproved = [...new Set(targets.flatMap((c) => c.drugs.filter((x) => isApproved(x.highest_phase)).map((x) => x.name)))];
const coverage = drugsApproved.length ? await runOnce(client, rl, COVERAGE.key, { processor: COVERAGE.processor, connectors: COVERAGE.connectors, schema: COVERAGE.schema, input: COVERAGE.input(d, drugsApproved), metadata: { job: 'coverage', disease: d.key } }) : null;

// Sources sometimes quote a company's contact line; excerpts keep the facts, not the contacts.
const redact = (basis: unknown[] | undefined, prefix = '') => (basis ?? []).map((b: any) => ({ ...b, field: prefix + b.field, citations: (b.citations ?? []).map((c: any) => ({ ...c, excerpts: (c.excerpts ?? []).map(redactContacts) })) }));

const facts: Record<string, Facts> = {};
let failed = 0;
for (const c of targets) {
  const r = results[`${FACTS.key}:${c.key}`];
  const f = factsOf.get(c.key);
  if (!r || !f) {
    failed += 1;
    continue;
  }
  const mine = readoutJobs.filter((j) => j.c.key === c.key).map(({ t }) => ({ t, rr: readouts[`${READOUT.key}:${t.nct}`] }));
  const reported = mine.filter(({ rr }) => (rr?.content as Readout | undefined)?.has_data).map(({ t, rr }) => ({ ...(rr.content as Omit<Readout, 'nct'>), nct: t.nct, _run: rr.run_id }));
  facts[c.key] = { ...f, readouts: reported, _spec: `${FACTS.key}+${DEALS.key}`, _run: r.run_id, _connectors: r.connectors, _seconds: r.seconds };
  // Basis goes in its own file per company (large, only the table view reads it); readout fields as readouts.<nct>.<field>.
  const basis = [...redact(r.basis), ...redact(results[`${DEALS.key}:${c.key}`]?.basis), ...mine.flatMap(({ t, rr }) => redact(rr?.basis, `readouts.${t.nct}.`))];
  assertNoContacts(`basis ${c.key}`, basis);
  await store.put(spacePath(d, `basis/${c.key}.json`), { company: c.name, run_id: r.run_id, basis });
}
assertNoContacts('facts', facts);
await store.put(spacePath(d, 'facts.json'), { disease: d.key, built: new Date().toISOString(), spec: [FACTS.key, DEALS.key, READOUT.key], facts });
await store.put(spacePath(d, 'coverage.json'), { disease: d.key, built: new Date().toISOString(), drugs: drugsApproved, run_id: coverage?.run_id ?? null, determinations: (coverage?.content as any)?.determinations ?? [], connectors: coverage?.connectors ?? {} });

const all = Object.values(facts);
const n = (fn: (x: Facts) => number) => all.reduce((s, x) => s + fn(x), 0);
log(d, `${all.length} companies researched (${failed} failed) · ${n((x) => x.milestones?.length ?? 0)} milestones · ${n((x) => x.deals?.length ?? 0)} deals · ${n((x) => x.financings?.length ?? 0)} financings · ${n((x) => x.regulatory?.length ?? 0)} regulatory · ${n((x) => x.next?.length ?? 0)} guided catalysts · ${n((x) => x.readouts?.length ?? 0)} readouts`);
log(d, `coverage: ${(coverage?.content as any)?.determinations?.length ?? 0} Medicare determinations for ${drugsApproved.length} approved drugs`);
log(d, `saved to ${where}spaces/${d.key}/facts.json, coverage.json and basis/`);
