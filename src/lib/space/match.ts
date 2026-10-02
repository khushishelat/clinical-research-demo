// Shared mention-matching: how a trial is named on the web (its acronym plus
// any of its company's drug names that appear in the trial record), and a
// case-insensitive "does this headline mention it" test. Used by the trial
// drawer (detail.ts) and the map's news marks (view.ts) so both join the same
// way. Pure: no I/O.

import type { Drug, Trial } from './types';

type TrialText = Pick<Trial, 'acronym' | 'title' | 'interventions'>;

/** Lowercased name fragments for a company's drugs: brand, codes, parenthetical aliases. */
export function drugNameSet(drugs: Drug[] | undefined): Set<string> {
  const names = new Set<string>();
  for (const d of drugs ?? [])
    for (const n of [d.name, ...(d.codes ?? []), ...(d.name.match(/\(([^)]+)\)/)?.[1].split(/[;,]/) ?? [])])
      if (n) names.add(n.split('(')[0].trim().toLowerCase());
  return names;
}

const trialText = (t: TrialText) => [t.title, t.acronym, ...t.interventions.flatMap((i) => [i.name, ...i.other_names])].join(' ').toLowerCase();

/** Needles for one trial: its acronym plus drug names that actually appear in the trial record. */
export function trialNeedles(t: TrialText, drugs: Drug[] | undefined): string[] {
  const names = drugNameSet(drugs);
  const text = trialText(t);
  return [t.acronym, ...[...names].filter((n) => n.length > 3 && text.includes(n))]
    .filter((x) => x)
    .map((x) => x.toLowerCase());
}

/** Case-insensitive substring match of any needle in the haystack. */
export function mentionsNeedles(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => n.length > 0 && h.includes(n));
}
