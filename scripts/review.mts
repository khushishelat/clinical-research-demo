// The one human step: companies found only on the web wait in
// review/companies.json until a person sets include. This lists them with a
// recommendation (include anything in Phase 1 or later, or approved, but not a
// maker of generic versions only: inScopeDrug, the rule the daily expansion also
// applies) and, only with --apply, writes the recommendation for the companies
// still undecided. Decisions already made are never changed.
//   npm run review -- --disease migraine            (list)
//   npm run review -- --disease migraine --apply    (accept the recommendations)

import type { Company, CompanyReview } from '../src/lib/space/types';
import { inScopeDrug, isGeneric } from './lib/companies';
import { disease, spacePath, store, where } from './lib/pipeline';

const d = disease();
const apply = process.argv.includes('--apply');
const review = (await store.get<(CompanyReview & Record<string, unknown>)[]>(spacePath(d, 'review/companies.json'))) ?? [];
const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };

const rows = review.map((r) => {
  const c = companies.find((x) => x.name === r.company);
  const drugs = c?.drugs ?? [];
  const best = drugs.find(inScopeDrug);
  const generics = drugs.length > 0 && drugs.every(isGeneric);
  return { r, c, recommend: Boolean(best), why: best ? `${best.name}: ${best.highest_phase}` : generics ? `generic versions only (${drugs.map((x) => x.name).join('; ')})` : (c?.drugs ?? []).map((x) => `${x.name}: ${x.highest_phase || 'phase not stated'}`).join('; ') || 'no drug returned' };
});
const pending = rows.filter((x) => x.r.include === null && x.r.listed !== false);
console.log(`[${d.key}] ${review.length} companies found only on the web · ${review.length - pending.length} decided · ${pending.length} waiting\n`);
for (const x of pending) console.log(`${x.recommend ? 'include ' : 'leave out'}  ${x.r.company}${x.c?.web?.country ? ` (${x.c.web.country})` : ''} · ${x.why}`);
if (!pending.length) process.exit(0);
if (!apply) {
  console.log(`\nNothing written. Edit include in ${where}${spacePath(d, 'review/companies.json')} by hand, or run with --apply to accept these recommendations.`);
  process.exit(0);
}
for (const x of pending) Object.assign(x.r, { include: x.recommend, decided: `recommendation: ${x.recommend ? 'Phase 1+ or approved' : x.why.startsWith('generic') ? 'generic versions only' : 'preclinical only'}` });
await store.put(spacePath(d, 'review/companies.json'), review);
console.log(`\nWrote ${pending.length} decisions (${pending.filter((x) => x.recommend).length} included). Change any of them in ${where}${spacePath(d, 'review/companies.json')}.`);
