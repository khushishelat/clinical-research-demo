// Build one disease map end to end.
//   npm run pipeline -- --disease mash
//   npm run pipeline -- --disease mash --estimate   (what a build costs, from the registry; free)
//
// Each step reads what the previous one wrote (to .data/ or Vercel Blob), keeps
// a run log, and reuses finished runs, so re-running never bills twice. A first
// build shows its estimate and waits for --yes. The pipeline stops once for a
// person: web-found companies wait in review/companies.json until someone sets
// include to true or false.

import { execFileSync } from 'node:child_process';
import { estimate, formatEstimate } from './lib/estimate';
import { disease, flag, spacePath, store, today, where } from './lib/pipeline';
import { fetchTrials, inScope } from './lib/registry';

const d = disease();
const step = (file: string, ...args: string[]) => execFileSync('npx', ['tsx', `scripts/${file}`, '--disease', d.key, ...args], { stdio: 'inherit' });

const built = Boolean(await store.get(spacePath(d, 'trials.json')));
if (flag('estimate') || (!built && !flag('yes'))) {
  console.log(`[${d.key}] ${d.name}: estimate from today's registry (free)\n`);
  console.log(formatEstimate(estimate(d, (await fetchTrials(d)).filter(inScope(d)), today())));
  if (!flag('estimate')) console.log(`\nNothing built yet. To build it at this cost: npm run pipeline -- --disease ${d.key} --yes`);
  process.exit(0);
}

step('02-registry.mts');
step('03-companies.mts');

const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
const pending = review.filter((r) => r.include === null);
if (pending.length) {
  console.log(`\n[${d.key}] ${pending.length} companies found on the web, not in the registry, need a yes or no:`);
  for (const r of pending) console.log(`  · ${r.company}`);
  console.log(`Set "include" to true or false in ${where}${spacePath(d, 'review/companies.json')}, or see recommendations with npm run review -- --disease ${d.key}; then run this again.\n`);
  process.exit(0);
}

step('04-enrich.mts');
step('05-clinicians.mts');
step('06-events.mts');
step('08-first-seen.mts');
step('09-brief.mts');
console.log(`\n[${d.key}] done. Open /d/${d.key}`);
