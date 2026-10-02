// Step 4: company facts and events. One Task Group per disease, one pro run
// per company (ClinicalTrials.gov + PubMed connectors), with basis kept per
// field. Also Medicare coverage for the disease's approved drugs (core, CMS
// Coverage connector). Companies found only on the web are enriched once a
// person approves them in review/companies.json.
//   npx tsx scripts/04-enrich.mts --disease mash

import { isApproved } from './lib/companies';
import { disease, groupRuns, log, parallel, recorder, runLog, runOnce, saveReplay, spacePath, store, today, where } from './lib/pipeline';
import { assertNoContacts, redactContacts, type Trial } from './lib/registry';
import { COVERAGE, FACTS } from './lib/specs';

const d = disease();
const client = parallel(d, 'enrich');
if (!client) process.exit(0);
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
const { companies } = (await store.get<{ companies: any[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
if (!companies.length) throw new Error('No companies yet. Run 03-companies first.');
const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
const approved = new Set(review.filter((r) => r.include).map((r) => r.company));
const pending = review.filter((r) => r.include === null).length;

// Registry companies always; web-only companies once a person says include.
const targets = companies.filter((c) => !c.web_only || approved.has(c.name));
const byNct = new Map(trials.map((t) => [t.nct, t]));
const rl = await runLog(d, 'enrich');

const units = targets.map((c) => {
  const registry = [...c.trials, ...c.investigator_trials]
    .map((n: string) => byNct.get(n))
    .filter((t: Trial | undefined): t is Trial => Boolean(t))
    .map((t: Trial) => ({ nct: t.nct, acronym: t.acronym, title: t.title, phase: t.phases.join('/'), status: t.status, sponsor: t.sponsor }));
  return { key: `facts:${c.key}`, spec: { processor: FACTS.processor, connectors: FACTS.connectors, schema: FACTS.schema, input: FACTS.input(d, today(), c, registry), metadata: { company: c.key } } };
});
log(d, `enriching ${units.length} companies (${pending} web-only companies await review)`);
const rec = recorder();
const results = await groupRuns(client, rl, d, 'facts', units, 12, rec);
await saveReplay(d, 'facts', rec);

const drugsApproved = [...new Set(targets.flatMap((c) => c.drugs.filter((x: any) => isApproved(x.highest_phase)).map((x: any) => x.name)))];
const coverage = drugsApproved.length
  ? await runOnce(client, rl, 'coverage', { processor: COVERAGE.processor, connectors: COVERAGE.connectors, schema: COVERAGE.schema, input: COVERAGE.input(d, drugsApproved), metadata: { job: 'coverage', disease: d.key } })
  : null;

const facts: Record<string, unknown> = {};
let failed = 0;
for (const c of targets) {
  const r = results[`facts:${c.key}`];
  if (!r?.content) {
    failed += 1;
    continue;
  }
  facts[c.key] = { ...(r.content as object), _run: r.run_id, _connectors: r.connectors, _seconds: r.seconds };
  // Basis goes in its own file per company (large, only the dataset view reads it).
  // Sources sometimes quote a company's contact line; excerpts keep the facts, not the contacts.
  const basis = (r.basis ?? []).map((b: any) => ({ ...b, citations: (b.citations ?? []).map((c: any) => ({ ...c, excerpts: (c.excerpts ?? []).map(redactContacts) })) }));
  assertNoContacts(`basis ${c.key}`, basis);
  await store.put(spacePath(d, `basis/${c.key}.json`), { company: c.name, run_id: r.run_id, basis });
}
assertNoContacts('facts', facts);
await store.put(spacePath(d, 'facts.json'), { disease: d.key, built: new Date().toISOString(), facts });
await store.put(spacePath(d, 'coverage.json'), { disease: d.key, built: new Date().toISOString(), drugs: drugsApproved, run_id: coverage?.run_id ?? null, determinations: (coverage?.content as any)?.determinations ?? [], connectors: coverage?.connectors ?? {} });

const all = Object.values(facts) as any[];
const n = (f: (x: any) => number) => all.reduce((s, x) => s + f(x), 0);
log(d, `${all.length} companies enriched (${failed} failed) · ${n((x) => x.milestones?.length ?? 0)} milestones · ${n((x) => x.deals?.length ?? 0)} deals · ${n((x) => x.approvals?.length ?? 0)} approvals · ${n((x) => x.next?.length ?? 0)} catalysts`);
log(d, `coverage: ${(coverage?.content as any)?.determinations?.length ?? 0} Medicare determinations for ${drugsApproved.length} approved drugs`);
log(d, `saved to ${where}spaces/${d.key}/facts.json, coverage.json and basis/`);
