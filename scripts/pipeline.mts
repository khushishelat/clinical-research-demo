// Build one disease map end to end.
//   npm run pipeline -- --disease mash
//
// Each step reads what the previous one wrote (to .data/ or Vercel Blob), keeps
// a run log, and reuses finished runs, so re-running never bills twice. The
// pipeline stops once for a person: web-found companies wait in
// review/companies.json until someone sets include to true or false.

import { execFileSync } from 'node:child_process';
import { disease, spacePath, store, where } from './lib/pipeline';

const d = disease();
const step = (file: string, ...args: string[]) => execFileSync('npx', ['tsx', `scripts/${file}`, '--disease', d.key, ...args], { stdio: 'inherit' });

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
