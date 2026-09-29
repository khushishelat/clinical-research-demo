// Stage 1: the ClinicalTrials.gov API v2. Free, no key, under a second.
// Every function takes an optional fetch so tests and fixture mode never
// touch the network.

import type { RegistryLookup, RunBy, TrialRow } from './types';

const BASE = 'https://clinicaltrials.gov/api/v2/studies';
export const ACTIVE_STATUSES = 'RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION,SUSPENDED';
const FIELDS =
  'NCTId,BriefTitle,LeadSponsorName,LeadSponsorClass,CollaboratorName,InterventionName,Condition,Phase,OverallStatus,LastUpdatePostDate,PrimaryCompletionDate';

type Fetch = typeof fetch;
type Study = { protocolSection: any };

async function getJson(url: string, fetchImpl: Fetch): Promise<any> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
  return res.json();
}

function roleOf(leadName: string, leadClass: string | undefined, match: string): RunBy {
  if (leadName.toLowerCase().includes(match)) return 'company_led';
  return leadClass === 'INDUSTRY' ? 'partner_led' : 'investigator_led';
}

export function toRow(study: Study, match: string): Omit<TrialRow, 'check'> {
  const p = study.protocolSection;
  const lead = p.sponsorCollaboratorsModule?.leadSponsor ?? {};
  return {
    nct_id: p.identificationModule.nctId,
    title: p.identificationModule.briefTitle ?? '',
    role: roleOf(lead.name ?? '', lead.class, match),
    lead_sponsor: lead.name ?? '',
    collaborators: (p.sponsorCollaboratorsModule?.collaborators ?? []).map((c: { name: string }) => c.name),
    interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: { name: string }) => i.name),
    condition: (p.conditionsModule?.conditions ?? [''])[0] ?? '',
    phases: p.designModule?.phases ?? [],
    status: p.statusModule.overallStatus,
    last_update_posted: p.statusModule.lastUpdatePostDateStruct?.date ?? '',
    primary_completion_date: p.statusModule.primaryCompletionDateStruct?.date ?? '',
  };
}

/** Every active trial where the company is lead sponsor or collaborator. */
export async function findCompanyTrials(
  opts: { company: string; match: string; advanced?: string },
  fetchImpl: Fetch = fetch
): Promise<Omit<TrialRow, 'check'>[]> {
  const params = new URLSearchParams({ 'query.spons': opts.company, 'filter.overallStatus': ACTIVE_STATUSES, fields: FIELDS, pageSize: '500' });
  if (opts.advanced) params.set('filter.advanced', opts.advanced);
  const body = await getJson(`${BASE}?${params}`, fetchImpl);
  const order: Record<RunBy, number> = { company_led: 0, partner_led: 1, investigator_led: 2 };
  return (body.studies as Study[]).map((s) => toRow(s, opts.match)).sort((a, b) => order[a.role] - order[b.role]);
}

/** Active-trial count for a sponsor name (typeahead and cost cues). */
export async function countActiveTrials(sponsor: string, fetchImpl: Fetch = fetch): Promise<number> {
  const params = new URLSearchParams({ 'query.spons': sponsor, 'filter.overallStatus': ACTIVE_STATUSES, countTotal: 'true', pageSize: '1', fields: 'NCTId' });
  const body = await getJson(`${BASE}?${params}`, fetchImpl);
  return Number(body.totalCount ?? 0);
}

/** Registry records for NCT IDs, used to confirm found-by-research trials and trials that left the active search. */
export async function lookupTrials(ids: readonly string[], fetchImpl: Fetch = fetch): Promise<Record<string, RegistryLookup>> {
  const out: Record<string, RegistryLookup> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const params = new URLSearchParams({
      'filter.ids': ids.slice(i, i + 100).join(','),
      fields: 'NCTId,Acronym,BriefTitle,LeadSponsorName,LeadSponsorClass,CollaboratorName,OverallStatus,Phase,InterventionName,InterventionOtherName',
      pageSize: '100',
    });
    const body = await getJson(`${BASE}?${params}`, fetchImpl);
    for (const s of body.studies as Study[]) {
      const p = s.protocolSection;
      out[p.identificationModule.nctId] = {
        lead_sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? '',
        lead_sponsor_class: p.sponsorCollaboratorsModule?.leadSponsor?.class ?? '',
        collaborators: (p.sponsorCollaboratorsModule?.collaborators ?? []).map((c: { name: string }) => c.name),
        status: p.statusModule.overallStatus,
        phase: (p.designModule?.phases ?? []).join('/'),
        acronym: p.identificationModule.acronym ?? null,
        title: p.identificationModule.briefTitle ?? '',
        interventions: (p.armsInterventionsModule?.interventions ?? [])
          .map((iv: { name?: string; otherNames?: string[] }) => [iv.name ?? '', ...(iv.otherNames ?? [])].join(' '))
          .join(' | '),
      };
    }
  }
  return out;
}
