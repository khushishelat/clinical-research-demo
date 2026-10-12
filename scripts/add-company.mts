// Add companies to an indication's map by hand: ones the news Monitors or the weekly
// sweep found that the map lacks (scripts/monitor-report.mts lists them). One OWNER run
// each (pro, $0.10, the same spec as step 3) researches who the company is and its drugs
// for the indication; it joins as a web-found row, approved in review/companies.json with
// today's date, since a person decided. Then research it like any other row:
//   npx tsx scripts/add-company.mts --disease obesity "Kalohexis" "Ribo Life Science"
//   npx tsx scripts/04-enrich.mts --disease obesity     facts and deals for the new rows
//   npx tsx scripts/07-registries.mts --disease obesity  their trials outside ClinicalTrials.gov
//   npx tsx scripts/06-events.mts --disease obesity      the feed

import type { Company } from '../src/lib/space/types';
import { companyKey, displayName, isApproved, isHoldingCompany, ownerFrom, ownerName, phaseRank } from './lib/companies';
import { disease, log, parallel, runLog, runOnce, spacePath, store, today } from './lib/pipeline';
import type { Trial } from './lib/registry';
import { ownerUnit } from './lib/units';

const d = disease();
const at = process.argv.indexOf('--disease');
const names = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && i + 2 !== at + 1);
if (!names.length) throw new Error('Usage: npx tsx scripts/add-company.mts --disease <key> "<company>" ["<company>" …]');
const client = parallel(d, 'add company');
if (!client) process.exit(1);

type Doc = { companies: Company[] } & Record<string, unknown>;
const doc = (await store.get<Doc>(spacePath(d, 'companies.json')))!;
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json'))) ?? { trials: [] as Trial[] };
const review = (await store.get<Record<string, unknown>[]>(spacePath(d, 'review/companies.json'))) ?? [];
const rl = await runLog(d, 'companies');

for (const name of names) {
  const u = ownerUnit(d, today(), name, trials);
  const rec = await runOnce(client, rl, u.key, u.spec);
  if (!rec.content) {
    log(d, `${name}: owner run ${rec.run_id} ${rec.status}; not added`);
    continue;
  }
  const o = ownerFrom(rec.content);
  // Keep the company itself unless another company now owns it outright.
  const owned = ['acquired', 'merged'].includes(o.relationship) && !isHoldingCompany(o.current_owner);
  const rowName = (owned ? ownerName(o.current_owner) : name) || name;
  const key = companyKey(rowName);
  let c = doc.companies.find((x) => x.key === key);
  if (c) log(d, `${rowName} is already a row; adding its drugs`);
  else {
    c = { key, name: displayName(rowName), relationship: owned ? o.relationship : 'independent', owner_source: o.owner_source_url, acquisitions: [], registry_sponsors: [], drugs: [], trials: [], investigator_trials: [], web: { country: '', source: o.owner_source_url }, web_only: true, approved: false, max_phase: 0 };
    doc.companies.push(c);
  }
  for (const drug of o.drugs) if (!c.drugs.some((x) => x.name.toLowerCase() === drug.name.toLowerCase())) c.drugs.push(drug);
  c.approved = c.drugs.some((x) => isApproved(x.highest_phase));
  c.max_phase = Math.max(c.max_phase, ...c.drugs.map((x) => phaseRank(x.highest_phase)));
  const entry = { company: c.name, include: true, decided: today(), added_by_hand: true, drugs: c.drugs.map((x) => `${x.name} (${x.highest_phase})`), source: o.owner_source_url };
  const i = review.findIndex((r) => r.company === c!.name);
  if (i >= 0) review[i] = { ...review[i], ...entry };
  else review.push(entry);
  log(d, `added ${c.name}: ${c.drugs.map((x) => `${x.name} (${x.highest_phase})`).join(', ') || 'no drugs found for this indication'}`);
}
await store.put(spacePath(d, 'companies.json'), doc);
await store.put(spacePath(d, 'review/companies.json'), review);
