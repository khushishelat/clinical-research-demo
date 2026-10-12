// Step 7: trials of map companies registered outside ClinicalTrials.gov, for companies
// with programs here but no trial there (OTHER_REGISTRIES, pro, one run each).
//   npx tsx scripts/07-registries.mts --disease mash

import { disease, groupRuns, log, parallel, runLog, spacePath, store, today, where } from './lib/pipeline';
import { keepElsewhere, onCtGov, type ElsewhereTrial } from './lib/registries';
import { OTHER_REGISTRIES } from './lib/specs';
import type { Company } from '../src/lib/space/types';

const d = disease();
const client = parallel(d, 'registries');
if (!client) process.exit(0);
const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
const included = new Set(review.filter((r) => r.include).map((r) => r.company));
// Companies on the map with no trial on ClinicalTrials.gov.
const targets = companies.filter((c) => (!c.web_only || included.has(c.name)) && !c.trials.length && !c.investigator_trials.length);
const since = d.include_completed_since ?? `${Number(today().slice(0, 4)) - 2}-01-01`;
log(d, `${targets.length} companies on the map have no ClinicalTrials.gov trial; one run each`);
const rl = await runLog(d, 'registries');
const units = targets.map((c) => ({ key: `${OTHER_REGISTRIES.key}:${c.key}`, spec: { processor: OTHER_REGISTRIES.processor, connectors: OTHER_REGISTRIES.connectors, schema: OTHER_REGISTRIES.schema, input: OTHER_REGISTRIES.input(d, { name: c.name, country: c.web?.country ?? null, drugs: c.drugs.map((x) => x.name).slice(0, 8) }, since), metadata: { company: c.key.slice(0, 60) } } }));
const results = await groupRuns(client, rl, d, 'registries', units, 12);
const byCompany: Record<string, ElsewhereTrial[]> = {};
let found = 0;
let dropped = 0;
let crossListed = 0;
for (const c of targets) {
  const got = ((results[`${OTHER_REGISTRIES.key}:${c.key}`]?.content as { trials?: ElsewhereTrial[] } | undefined)?.trials ?? []) as ElsewhereTrial[];
  const fits = keepElsewhere(got, d.include_completed_since ?? null);
  // ClinicalTrials.gov lists some registries' IDs as secondary IDs: those trials are its own.
  const kept: ElsewhereTrial[] = [];
  for (const t of fits) {
    if (await onCtGov(t.id)) crossListed += 1;
    else kept.push(t);
  }
  dropped += got.length - kept.length;
  if (kept.length) byCompany[c.key] = kept;
  found += kept.length;
}
await store.put(spacePath(d, 'other-registries.json'), { disease: d.key, built: new Date().toISOString(), spec: OTHER_REGISTRIES.key, companies: byCompany });
log(d, `other registries: ${found} trials for ${Object.keys(byCompany).length} of ${targets.length} companies; ${dropped} left out (${crossListed} listed on ClinicalTrials.gov; the rest on it by the run's check, outside the indication's scope, or not in the registry's ID format) · saved to ${where}spaces/${d.key}/other-registries.json`);
