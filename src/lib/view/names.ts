import type { Pack } from '../domain/types';
import { trialName } from './format';

/** Short display names for every trial in a pack, by NCT ID. */
export function namesOf(pack: Pack): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of pack.rows) out[r.nct_id] = trialName(r);
  for (const f of pack.found_beyond_registry_search) out[f.nct_id] = trialName({ nct_id: f.nct_id, title: f.registry?.title ?? '', check: f.check }, f.registry?.acronym);
  return out;
}
