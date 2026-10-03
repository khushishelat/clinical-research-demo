// The one human step: companies found only on the web wait in
// review/companies.json until a person sets include. This lists them with a
// recommendation (include anything in Phase 2 or later, or approved, but not a
// maker of generic versions only) and, only
// with --apply, writes the recommendation for the companies still undecided.
// Decisions already made are never changed.
//   npm run review -- --disease migraine            (list)
//   npm run review -- --disease migraine --apply    (accept the recommendations)

import type { Company, CompanyReview } from '../src/lib/space/types';
import { disease, spacePath, store, where } from './lib/pipeline';

const d = disease();
const apply = process.argv.includes('--apply');
const review = (await store.get<(CompanyReview & Record<string, unknown>)[]>(spacePath(d, 'review/companies.json'))) ?? [];
const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
const LATE = new Set(['phase_2', 'phase_2_3', 'phase_3', 'filed', 'approved']);
// A generic: approved, named by molecule and dosage form, with no brand ("Rizatriptan benzoate tablets").
const FORM = /\b(tablets?|capsules?|injection|orally disintegrating|oral solution|nasal spray|autoinjector)\b/i;
const generic = (x: Company['drugs'][number]) => (x.phase === 'approved' || /^approved/i.test(x.highest_phase)) && FORM.test(x.name) && !x.name.includes('(');

const rows = review.map((r) => {
  const c = companies.find((x) => x.name === r.company);
  const drugs = c?.drugs ?? [];
  const best = drugs.find((x) => (LATE.has(x.phase ?? '') || /^approved/i.test(x.highest_phase)) && !generic(x));
  const generics = drugs.length > 0 && drugs.every(generic);
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
for (const x of pending) Object.assign(x.r, { include: x.recommend, decided: `recommendation: ${x.recommend ? 'Phase 2+ or approved' : x.why.startsWith('generic') ? 'generic versions only' : 'earlier than Phase 2'}` });
await store.put(spacePath(d, 'review/companies.json'), review);
console.log(`\nWrote ${pending.length} decisions (${pending.filter((x) => x.recommend).length} included). Change any of them in ${where}${spacePath(d, 'review/companies.json')}.`);
