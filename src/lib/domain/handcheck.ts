// Hand-check carry-over (HANDOFF-v2.1 section 5). A tick from review.json
// applies only while the claim it checked is unchanged: same milestone type,
// date and source URL. Never carry a tick over to new wording.

import type { FoundTrial, HandCheck, Milestone, Pack, TrialRow } from './types';

export type Fingerprint = { type: string; date: string | null; source_url: string | null };
/**
 * `fingerprint` pins a check on a registry row to its milestone.
 * `found_lead_sponsor` pins a check on a found-by-research trial (a claim
 * about who runs it) to the registry's lead sponsor.
 */
export type PinnedCheck = HandCheck & { fingerprint?: Fingerprint; found_lead_sponsor?: string };

export const fingerprintOf = (m: Milestone | null | undefined): Fingerprint | undefined =>
  m ? { type: m.type, date: m.date, source_url: m.source_url } : undefined;

const same = (a: Fingerprint | undefined, b: Fingerprint | undefined) =>
  Boolean(a && b && a.type === b.type && a.date === b.date && a.source_url === b.source_url);

/** Pins each trial-level check to what it was checked against. */
export function pinChecks(review: readonly HandCheck[], rows: readonly TrialRow[], found: readonly FoundTrial[] = []): PinnedCheck[] {
  return review.map((c): PinnedCheck => {
    const already = c as PinnedCheck;
    if (already.fingerprint || already.found_lead_sponsor) return { ...already };
    const row = c.nct_id ? rows.find((r) => r.nct_id === c.nct_id) : undefined;
    if (row) return { ...c, fingerprint: fingerprintOf(row.check?.latest_milestone) };
    const f = c.nct_id ? found.find((x) => x.nct_id === c.nct_id) : undefined;
    return f?.registry ? { ...c, found_lead_sponsor: f.registry.lead_sponsor } : { ...c };
  });
}

/**
 * Which pinned checks still hold for a new pack.
 * - on a registry row: an unchanged latest or earlier milestone
 * - on a found-by-research trial: still found, same lead sponsor
 * - company-level (programs, partners, competitors): the source is still cited
 */
export function carryOver(pinned: readonly PinnedCheck[], next: Pack): PinnedCheck[] {
  const sources = new Set([
    ...(next.snapshot?.programs ?? []).map((p) => p.source_url),
    ...(next.snapshot?.partnerships ?? []).map((p) => p.source_url ?? ''),
    ...(next.snapshot_basis ?? []).flatMap((b) => b.citations.map((c) => c.url)),
    ...(next.mechanism?.competitors ?? []).map((c) => c.source_url),
    ...(next.mechanism_basis ?? []).flatMap((b) => b.citations.map((c) => c.url)),
  ]);
  return pinned.filter((c) => {
    if (c.verdict === 'unverified' || c.verdict === 'wrong') return true; // negative results never become ticks
    if (!c.nct_id) return sources.has(c.source);
    const row = next.rows.find((r) => r.nct_id === c.nct_id);
    if (row) {
      if (!row.check || !c.fingerprint) return false;
      const milestones = [row.check.latest_milestone, ...row.check.earlier_milestones].map(fingerprintOf);
      return milestones.some((m) => same(m, c.fingerprint));
    }
    const found = next.found_beyond_registry_search.find((f) => f.nct_id === c.nct_id);
    return Boolean(found?.registry && c.found_lead_sponsor && found.registry.lead_sponsor === c.found_lead_sponsor);
  });
}
