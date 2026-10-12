// Trials registered outside ClinicalTrials.gov (OTHER_REGISTRIES): which to trust and show.
// An ID must be in its registry's own format; a trial also on ClinicalTrials.gov is
// dropped (the run gives its NCT ID, or ClinicalTrials.gov lists the registry ID as a
// secondary ID: onCtGov), since the map shows ClinicalTrials.gov trials by its own rules.

/** Is this registry ID listed on a ClinicalTrials.gov record (as a secondary ID)? Free API call. */
export async function onCtGov(id: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const r = await fetchImpl(`https://clinicaltrials.gov/api/v2/studies?${new URLSearchParams({ 'query.term': `"${id}"`, fields: 'NCTId', pageSize: '1' })}`);
  if (!r.ok) return null;
  const b: any = await r.json();
  return b.studies?.[0]?.protocolSection?.identificationModule?.nctId ?? null;
}

export type ElsewhereTrial = { registry: string; id: string; title: string; drug: string; phase: string; status: string; first_posted: string | null; primary_completion?: string | null; nct: string | null; source_url: string };

const FORMAT: Record<string, RegExp> = {
  'NMPA (China)': /^CTR\d{8}$/,
  ChiCTR: /^ChiCTR[-A-Z0-9]{8,}$/i,
  'CTRI (India)': /^CTRI\/\d{4}\/\d{2,3}\/\d{5,6}$/,
  'EU CTIS': /^\d{4}-\d{6}-\d{2}-\d{2}$/,
  EudraCT: /^\d{4}-\d{6}-\d{2}$/,
  'jRCT (Japan)': /^jRCT[a-z]?\d{9,10}$/i,
  ANZCTR: /^ACTRN\d{14}$/,
  'CRIS (Korea)': /^KCT\d{7}$/,
  ISRCTN: /^ISRCTN\d{8}$/,
};

const ACTIVE = new Set(['recruiting', 'not_yet_recruiting', 'active_not_recruiting']);

/**
 * Trials whose ID fits their registry, that aren't on ClinicalTrials.gov (no NCT ID from
 * the run), and that fit the indication's scope as the map applies it to registry
 * trials: active, or completed or stopped since `completedSince` (null: active only).
 * Once each.
 */
export function keepElsewhere(trials: ElsewhereTrial[], completedSince: string | null): ElsewhereTrial[] {
  const out = new Map<string, ElsewhereTrial>();
  for (const t of trials) {
    const id = (t.id ?? '').trim();
    if (!FORMAT[t.registry]?.test(id)) continue;
    if (t.nct && /^NCT\d{8}$/i.test(t.nct.trim())) continue;
    const done = t.status === 'completed' || t.status === 'terminated';
    if (!ACTIVE.has(t.status) && !(done && completedSince && (t.primary_completion ?? '') >= completedSince.slice(0, 7))) continue;
    if (!out.has(id.toUpperCase())) out.set(id.toUpperCase(), { ...t, id, first_posted: /^\d{4}-\d{2}-\d{2}$/.test(t.first_posted ?? '') ? t.first_posted : null });
  }
  return [...out.values()];
}
