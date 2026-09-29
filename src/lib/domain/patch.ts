// Applying one follow-up check to a stored pack (BACKEND-DESIGN.md, Job 2).
// A Monitor event names a trial; a connector-backed Task run re-checks it;
// the result replaces that row's check. Hand-check ticks re-apply with the
// same carry-over rule as the weekly re-run. Pure.

import { carryOver, pinChecks, type PinnedCheck } from './handcheck';
import { totalsOf } from './join';
import type { Pack, TrialCheck } from './types';

export function patchCheck(pack: Pack, nctId: string, check: TrialCheck): Pack | null {
  const pinned: PinnedCheck[] = pinChecks(pack.review ?? [], pack.rows, pack.found_beyond_registry_search);
  const rowIndex = pack.rows.findIndex((r) => r.nct_id === nctId);
  const foundIndex = pack.found_beyond_registry_search.findIndex((f) => f.nct_id === nctId);
  if (rowIndex < 0 && foundIndex < 0) return null;

  const next: Pack = {
    ...pack,
    rows: pack.rows.map((r, i) => (i === rowIndex ? { ...r, check } : r)),
    found_beyond_registry_search: pack.found_beyond_registry_search.map((f, i) => (i === foundIndex ? { ...f, check } : f)),
  };
  next.review = carryOver(pinned, next);
  for (const row of next.rows) {
    if (!row.check) continue;
    const checks = next.review.filter((c) => c.nct_id === row.nct_id);
    row.check = checks.length ? { ...row.check, hand_checked: checks } : (({ hand_checked: _h, ...rest }) => rest)(row.check);
  }
  next.totals = { ...pack.totals, ...totalsOf(next) };
  return next;
}
