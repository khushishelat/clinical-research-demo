// Registry re-read on every open (HANDOFF-v2.1 section 5): compare today's
// registry status with the recorded pack and recompute each flag. Pure, so
// the registry source (live or fixture) is passed in.

import { flagFor } from './specs';
import type { Flag, TrialRow } from './types';

export type LiveStatus = { status: string; last_update_posted?: string };

export type Freshness =
  | { state: 'unchanged'; flag: Flag; status: string }
  | { state: 'caught_up'; flag: Flag; status: string; recorded_status: string; changed_on: string | null }
  | { state: 'changed_pending'; flag: Flag; status: string; recorded_status: string; changed_on: string | null }
  | { state: 'changed'; flag: Flag; status: string; recorded_status: string; changed_on: string | null };

const LOUD: readonly Flag[] = ['registry_lagging', 'conflict'];
const CLOSED = new Set(['COMPLETED', 'TERMINATED', 'WITHDRAWN', 'ACTIVE_NOT_RECRUITING']);

/**
 * @param live  statuses from today's active-status search, by NCT ID
 * @param left  records fetched for trials no longer in the active search
 */
export function freshnessOf(row: TrialRow, live: Record<string, LiveStatus>, left: Record<string, LiveStatus> = {}): Freshness {
  const recordedFlag: Flag = row.check?.flag ?? 'no_news';
  const now = live[row.nct_id] ?? left[row.nct_id];
  if (!now || now.status === row.status) return { state: 'unchanged', flag: recordedFlag, status: row.status };

  const earlier = (row.check?.earlier_milestones ?? []).map((m) => m.type);
  const recomputed = flagFor(row.check?.latest_milestone?.type, now.status, earlier);
  const changed_on = now.last_update_posted ?? null;
  const base = { status: now.status, recorded_status: row.status, changed_on };

  if (LOUD.includes(recordedFlag)) {
    if (!LOUD.includes(recomputed) || CLOSED.has(now.status)) return { state: 'caught_up', flag: recomputed === 'no_news' ? 'no_news' : 'news', ...base };
    // Still a lag or conflict on paper, but the registry moved: downgrade
    // (no orange) until the weekly re-run settles it.
    return { state: 'changed_pending', flag: 'news', ...base };
  }
  return { state: 'changed', flag: recomputed, ...base };
}

export function registryChangeSummary(rows: readonly TrialRow[], live: Record<string, LiveStatus>, left: Record<string, LiveStatus> = {}) {
  const byTrial = Object.fromEntries(rows.map((r) => [r.nct_id, freshnessOf(r, live, left)]));
  const changed = Object.values(byTrial).filter((f) => f.state !== 'unchanged').length;
  return { byTrial, changed };
}

/** NCT IDs recorded as active that today's active-status search no longer returns. */
export function missingFromActiveSearch(rows: readonly TrialRow[], live: Record<string, LiveStatus>): string[] {
  return rows.filter((r) => !live[r.nct_id]).map((r) => r.nct_id);
}
