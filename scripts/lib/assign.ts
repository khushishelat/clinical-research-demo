// Which company a trial belongs to, shared by the build (03-companies) and the daily
// refresh (steps/attach). Company-run trials belong to their sponsor's company; an
// investigator-run trial belongs to the company with an established program of the drug
// in its tested arm.

import type { Company, Drug } from '../../src/lib/space/types';
import { aliasesOf, trialTests, trialUses } from './companies';
import type { Trial } from './registry';

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A company's own (company-run) trials of a drug here, by any of its names. */
function ownTrials(c: Company, drug: Drug, byNct: Map<string, Trial>): Trial[] {
  const names = aliasesOf(drug);
  return c.trials.map((n) => byNct.get(n)).filter((t): t is Trial => Boolean(t) && t!.run_by === 'company' && names.some((a) => trialUses(t!, a)));
}

/**
 * Who a drug belongs to: the company with the most of its own trials of it, counting
 * every name and code, any case (Innovent registers mazdutide as IBI362). If those are all
 * Phase 4 studies of a marketed drug, it is a generic here and claims nothing. A company
 * with no trials here at all can own a drug (a web-found originator).
 */
export function drugOwner(companies: Company[], trials: Trial[]): (alias: string) => string | null {
  const byNct = new Map(trials.map((t) => [t.nct, t]));
  const memo = new Map<string, string | null>();
  return (alias: string) => {
    const k = alias.toLowerCase();
    if (memo.has(k)) return memo.get(k)!;
    let best: { c: Company; n: number; early: boolean } | null = null;
    for (const c of companies) {
      const drug = c.drugs.find((x) => aliasesOf(x).some((a) => same(a, alias)));
      if (!drug) continue;
      const mine = ownTrials(c, drug, byNct);
      const cand = { c, n: mine.length, early: mine.some((t) => t.phase_level > 0 && t.phase_level <= 3) };
      if (!best || cand.n > best.n) best = cand;
    }
    const owner = best && (best.early || (best.n === 0 && !best.c.trials.length)) ? best.c.key : null;
    memo.set(k, owner);
    return owner;
  };
}

/**
 * Investigator-run trials (of `among`, default all) and the companies whose drug sits in
 * a tested arm, two for a combination. Only for a drug the company runs at least two
 * trials of its own here: by its generic name a marketed drug may be anyone's product,
 * and owner records can carry the originator's codes, so a generics maker's one
 * empagliflozin trial (Getz, MASH) or a reformulation's one donepezil trial claims no
 * academic trial of it. Novo's semaglutide and Lilly's tirzepatide programs do.
 */
export function investigatorClaims(companies: Company[], trials: Trial[], ownerOf: (alias: string) => string | null, among: Trial[] = trials): Map<string, Set<string>> {
  const byNct = new Map(trials.map((t) => [t.nct, t]));
  const programs = companies.map((c) => ({ c, drugs: c.drugs.filter((x) => ownTrials(c, x, byNct).length >= 2) }));
  const claims = new Map<string, Set<string>>();
  for (const t of among.filter((x) => x.run_by === 'investigator'))
    for (const { c, drugs } of programs)
      for (const drug of drugs) for (const a of aliasesOf(drug)) if (ownerOf(a) === c.key && trialTests(t, a)) (claims.get(t.nct) ?? claims.set(t.nct, new Set()).get(t.nct)!).add(c.key);
  return claims;
}
