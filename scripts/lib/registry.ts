// ClinicalTrials.gov API v2, called directly: free, deterministic, every row.
// Only names and roles of investigators are kept; phone numbers, emails and
// site contacts are never requested or stored.

import type { Person, Trial } from '../../src/lib/space/types';
import type { Disease } from './pipeline';

export type { Person, Trial };

const BASE = 'https://clinicaltrials.gov/api/v2/studies';
export const ACTIVE = 'RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION';
// COMBINATION_PRODUCT matters: Boehringer's survodutide Phase 3s are typed that way.
export const DRUG_TYPES = 'AREA[InterventionType](DRUG OR BIOLOGICAL OR COMBINATION_PRODUCT OR GENETIC)';
const FIELDS = [
  'NCTId', 'BriefTitle', 'Acronym', 'OverallStatus', 'Phase', 'Condition',
  'LeadSponsorName', 'LeadSponsorClass', 'CollaboratorName',
  'InterventionName', 'InterventionType', 'InterventionOtherName', 'ArmGroupType', 'ArmGroupLabel', 'ArmGroupInterventionName',
  'DesignAllocation', 'DesignMasking', 'PrimaryOutcomeMeasure', 'PrimaryOutcomeTimeFrame',
  'StudyFirstPostDate', 'LastUpdatePostDate', 'StartDate', 'PrimaryCompletionDate', 'EnrollmentCount',
  'OverallOfficialName', 'OverallOfficialAffiliation', 'OverallOfficialRole',
  'LocationFacility', 'LocationCity', 'LocationState', 'LocationCountry', 'LocationContactName', 'LocationContactRole',
].join(',');

// Sponsor call centers and job titles that sit in name fields.
const PLACEHOLDER = /\b(call|center|centre|director|clinical\s*trials?|ct\.gov|transparency|information|contact|site\s*\d+|investigational\s+site|medical\s+(monitor|lead|expert)|study\s+(manager|physician))\b|\d{3}/i;

// Registry names read "First Last, MD, PhD"; some start "Dr." or "Prof.".
const PREFIX = /^(?:(?:Assoc\.?\s+)?(?:Prof(?:essor)?|Dr|Doctor|Mr|Mrs|Ms)\.?\s+)+/i;
const SUFFIX = /\s+(?:MD|M\.D\.?|DO|PhD|PHD|Ph\.D\.?|MBBS|MPH|MSc|MS|MAS|DM|FACP|FACG|FAASLD|FRCP|FRCPC|MBChB|BSc|PharmD|RN|NP|PA-C)\.?$/;
/** A person's name without titles or credentials. Case-sensitive, so "Jörn" keeps its "rn". */
export function cleanPersonName(name: string): string {
  let s = name.split(',')[0].replace(PREFIX, '').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(s)) s = s.replace(SUFFIX, '').trim();
  return s || name.trim();
}
// Affiliations sometimes carry a street address ("…, 1200 West Broad Street, Richmond VA23298, USA").
// Keep the institution and place; drop street, suite and postal-code parts.
const STREET = /^\d+[\w-]*\s|\s\d+[a-z]?$|\b(street|avenue|road|boulevard|blvd|suite|floor|p\.?o\.? box)\b|\w(straat|strasse|straße|gasse|vej|gatan)\b|^(rue|via|calle|avenida|viale|piazza)\s|\b[A-Z]{2}\s?\d{5}\b|\b\d{5}(-\d{4})?\b|\b[A-Z]-?\d{4,}\b/i;
export const stripAddress = (x: string | undefined) =>
  x
    ?.split(',')
    .map((p) => p.trim())
    .filter((p) => p && !STREET.test(p))
    .join(', ') || undefined;

export const personBase = (name: string) => cleanPersonName(name).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

export function phaseLevel(phases: string[]): number {
  const n = phases.map((p) => (/PHASE4/.test(p) ? 4 : /PHASE3/.test(p) ? 3 : /PHASE2/.test(p) ? 2 : /PHASE1/.test(p) ? 1 : 0));
  return Math.max(0, ...n);
}

export function toTrial(study: any): Trial {
  const p = study.protocolSection;
  const lead = p.sponsorCollaboratorsModule?.leadSponsor ?? {};
  const locations: any[] = p.contactsLocationsModule?.locations ?? [];
  const sitePeople: Person[] = [];
  for (const l of locations) {
    for (const c of l.contacts ?? []) {
      if (c.role !== 'PRINCIPAL_INVESTIGATOR' || !c.name || PLACEHOLDER.test(c.name)) continue;
      sitePeople.push({ name: c.name, key: `${personBase(c.name)}|${(l.state ?? l.country ?? '').toLowerCase()}`, role: 'principal_investigator', facility: stripAddress(l.facility), city: l.city, state: l.state, country: l.country });
    }
  }
  const officials: Person[] = [];
  for (const o of p.contactsLocationsModule?.overallOfficials ?? []) {
    if (!['PRINCIPAL_INVESTIGATOR', 'STUDY_CHAIR'].includes(o.role) || !o.name || PLACEHOLDER.test(o.name)) continue;
    // Key an official to the same person's site when the trial lists one.
    const site = sitePeople.find((s) => personBase(s.name) === personBase(o.name));
    const affiliation = stripAddress(o.affiliation);
    officials.push({ name: o.name, key: site?.key ?? `${personBase(o.name)}|${(affiliation ?? '').toLowerCase()}`, role: o.role === 'STUDY_CHAIR' ? 'study_chair' : 'principal_investigator', affiliation, city: site?.city, state: site?.state, country: site?.country });
  }
  const phases: string[] = p.designModule?.phases ?? [];
  return {
    nct: p.identificationModule.nctId,
    title: p.identificationModule.briefTitle ?? '',
    acronym: p.identificationModule.acronym ?? '',
    status: p.statusModule.overallStatus,
    phases,
    phase_level: phaseLevel(phases),
    conditions: p.conditionsModule?.conditions ?? [],
    sponsor: lead.name ?? '',
    sponsor_class: lead.class ?? '',
    run_by: lead.class === 'INDUSTRY' ? 'company' : 'investigator',
    collaborators: (p.sponsorCollaboratorsModule?.collaborators ?? []).map((c: any) => c.name),
    interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => ({ name: i.name, type: i.type, other_names: i.otherNames ?? [] })),
    arms: (p.armsInterventionsModule?.armGroups ?? []).map((a: any) => ({ type: a.type ?? 'OTHER', label: a.label ?? '', interventions: (a.interventionNames ?? []).map((n: string) => n.replace(/^[A-Za-z ]+:\s*/, '')) })),
    design: { allocation: p.designModule?.designInfo?.allocation ?? null, masking: p.designModule?.designInfo?.maskingInfo?.masking ?? null },
    primary_outcomes: (p.outcomesModule?.primaryOutcomes ?? []).slice(0, 3).map((o: any) => ({ measure: o.measure ?? '', time_frame: o.timeFrame ?? '' })),
    first_posted: p.statusModule.studyFirstPostDateStruct?.date ?? '',
    last_update: p.statusModule.lastUpdatePostDateStruct?.date ?? '',
    start: p.statusModule.startDateStruct?.date ?? '',
    primary_completion: p.statusModule.primaryCompletionDateStruct?.date ?? '',
    enrollment: p.designModule?.enrollmentInfo?.count ?? null,
    n_sites: locations.length,
    countries: [...new Set(locations.map((l) => l.country).filter(Boolean))] as string[],
    // One entry per person per trial.
    people: [...new Map([...officials, ...sitePeople].map((x) => [x.key, x])).values()],
  };
}

export async function fetchTrials(d: Disease, fetchImpl: typeof fetch = fetch): Promise<Trial[]> {
  const out = new Map<string, Trial>();
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ 'query.cond': d.query_cond, 'filter.overallStatus': ACTIVE, 'filter.advanced': DRUG_TYPES, fields: FIELDS, pageSize: '1000', ...(token ? { pageToken: token } : {}) });
    const res = await fetchImpl(`${BASE}?${params}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
    const body: any = await res.json();
    for (const s of body.studies ?? []) {
      const t = toTrial(s);
      out.set(t.nct, t);
    }
    token = body.nextPageToken;
  } while (token);
  return [...out.values()].sort((a, b) => a.nct.localeCompare(b.nct));
}

const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/gi;
const PHONE = /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const STREET_ADDRESS = /\b\d{2,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd|Drive|Dr\.|Suite)\b/;

/** Removes emails and phone numbers from quoted source text (citation excerpts). */
export const redactContacts = (text: string) => text.replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]');

/** Throws if anything that looks like a phone number, email or street address reached the data. */
export function assertNoContacts(label: string, data: unknown) {
  const text = JSON.stringify(data);
  const email = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const phone = text.match(PHONE);
  const street = text.match(STREET_ADDRESS);
  if (email || phone || street) throw new Error(`${label}: contact details found (${(email ?? phone ?? street)![0]}). Nothing was saved.`);
}

export type RegistryEvent = { id: string; date: string; type: 'trial_registered' | 'status_changed' | 'phase_changed'; nct: string; sponsor: string; detail: string; origin: 'registry' };

/** Diff two daily snapshots into registry events. */
export function diffSnapshots(prev: Trial[], next: Trial[], date: string): RegistryEvent[] {
  const before = new Map(prev.map((t) => [t.nct, t]));
  const events: RegistryEvent[] = [];
  for (const t of next) {
    const b = before.get(t.nct);
    if (!b) events.push({ id: `${date}:new:${t.nct}`, date, type: 'trial_registered', nct: t.nct, sponsor: t.sponsor, detail: t.title, origin: 'registry' });
    else {
      if (b.status !== t.status) events.push({ id: `${date}:status:${t.nct}`, date, type: 'status_changed', nct: t.nct, sponsor: t.sponsor, detail: `${b.status} → ${t.status}`, origin: 'registry' });
      if (b.phase_level !== t.phase_level) events.push({ id: `${date}:phase:${t.nct}`, date, type: 'phase_changed', nct: t.nct, sponsor: t.sponsor, detail: `${b.phases.join('/')} → ${t.phases.join('/')}`, origin: 'registry' });
    }
  }
  return events;
}
