// Add companies to an indication's map by hand: ones the weekly sweep found that the map
// lacks (scripts/monitor-report.mts lists them; companies the news Monitors find join on
// their own, steps/expand.ts). One OWNER run each (pro, $0.10, the same spec as step 3)
// researches who the company is and its drugs for the indication; it joins as a web-found
// row, approved in review/companies.json with today's date, since a person decided. The
// next daily expansion researches it, or research it now like any other row:
//   npx tsx scripts/add-company.mts --disease obesity "Kalohexis" "Ribo Life Science"
//   npx tsx scripts/04-enrich.mts --disease obesity     facts and deals for the new rows
//   npx tsx scripts/07-registries.mts --disease obesity  their trials outside ClinicalTrials.gov
//   npx tsx scripts/06-events.mts --disease obesity      the feed

import type { Company } from '../src/lib/space/types';
import { joinRow, ownerFrom } from './lib/companies';
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
  const { row: c, created } = joinRow(doc.companies, name, o);
  if (!created) log(d, `${c.name} is already a row; adding its drugs`);
  const entry = { company: c.name, include: true, decided: today(), added_by_hand: true, drugs: c.drugs.map((x) => `${x.name} (${x.highest_phase})`), source: o.owner_source_url };
  const i = review.findIndex((r) => r.company === c.name);
  if (i >= 0) review[i] = { ...review[i], ...entry };
  else review.push(entry);
  log(d, `added ${c.name}: ${c.drugs.map((x) => `${x.name} (${x.highest_phase})`).join(', ') || 'no drugs found for this indication'}`);
}
await store.put(spacePath(d, 'companies.json'), doc);
await store.put(spacePath(d, 'review/companies.json'), review);
