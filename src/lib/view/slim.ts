// What the landscape sends to the browser: the pack without per-field basis,
// connector logs and registry records (trial detail loads those itself).
// Keeps the page payload small. Pure.

import type { FoundTrial, Pack, TrialCheck, TrialRow } from '../domain/types';

export type SlimCheck = Omit<TrialCheck, 'basis' | 'connector_log' | 'registry_record'> & { sites: number | null };
export type SlimRow = Omit<TrialRow, 'check'> & { check: SlimCheck | null };
export type SlimFound = Omit<FoundTrial, 'check'> & { check: SlimCheck | null };

export function slimCheck(c: TrialCheck | null | undefined): SlimCheck | null {
  if (!c) return null;
  const { basis: _b, connector_log: _l, registry_record, ...rest } = c;
  return { ...rest, sites: registry_record?.sites ?? null };
}

export const slimRow = (r: TrialRow): SlimRow => ({ ...r, check: slimCheck(r.check) });
export const slimFound = (f: FoundTrial): SlimFound => ({ ...f, check: slimCheck(f.check ?? null) });

export type SlimPack = Omit<Pack, 'rows' | 'found_beyond_registry_search' | 'snapshot_basis' | 'mechanism_basis' | 'snapshot_connector_log' | 'mechanism_connector_log' | 'found_beyond_excluded'> & {
  rows: SlimRow[];
  found_beyond_registry_search: SlimFound[];
  found_excluded: number;
  snapshot_connector_calls: number;
  mechanism_connector_calls: number;
};

export function slimPack(p: Pack): SlimPack {
  const { rows, found_beyond_registry_search, snapshot_basis: _sb, mechanism_basis: _mb, snapshot_connector_log, mechanism_connector_log, found_beyond_excluded, ...rest } = p;
  return {
    ...rest,
    rows: rows.map(slimRow),
    found_beyond_registry_search: found_beyond_registry_search.map(slimFound),
    found_excluded: found_beyond_excluded?.length ?? 0,
    snapshot_connector_calls: snapshot_connector_log?.length ?? 0,
    mechanism_connector_calls: mechanism_connector_log?.length ?? 0,
  };
}
