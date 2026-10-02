// Display labels for the enums the v1 Task specs return. Pure.

const PHASE: Record<string, string> = { preclinical: 'Preclinical', phase_1: 'Phase 1', phase_1_2: 'Phase 1/2', phase_2: 'Phase 2', phase_2_3: 'Phase 2/3', phase_3: 'Phase 3', filed: 'Filed', approved: 'Approved' };
/** "phase_1_2" → "Phase 1/2"; anything else is returned as given. */
export const phaseLabel = (p: string | null | undefined): string => PHASE[p ?? ''] ?? (p || '');

const ROUTE: Record<string, string> = { oral: 'Oral', subcutaneous: 'Subcutaneous injection', intravenous: 'Intravenous', intramuscular: 'Intramuscular', topical: 'Topical', inhaled: 'Inhaled', other: 'Other' };
export const routeLabel = (r: string | null | undefined): string => ROUTE[r ?? ''] ?? (r || '');

const REGULATORY: Record<string, string> = { breakthrough: 'Breakthrough Therapy', fast_track: 'Fast Track', orphan: 'Orphan', prime: 'PRIME', priority_review: 'Priority Review', accelerated_approval: 'Accelerated approval', filing: 'Filing', filing_accepted: 'Filing accepted', decision_date: 'Decision date', other: 'Regulatory' };
export const regulatoryLabel = (k: string): string => REGULATORY[k] ?? k;
/** "FDA Breakthrough Therapy designation", "EMA filing accepted", "EMA regulatory update". */
export const regulatoryEvent = (agency: string, k: string): string => (k === 'other' ? `${agency} regulatory update` : `${agency} ${regulatoryLabel(k)}${['breakthrough', 'fast_track', 'orphan', 'prime'].includes(k) ? ' designation' : ''}`);

const COMPARATOR: Record<string, string> = { placebo: 'Placebo', active: 'Active comparator', standard_of_care: 'Standard of care', none: 'No comparator', unknown: 'Not stated' };
export const comparatorLabel = (k: string): string => COMPARATOR[k] ?? k;
