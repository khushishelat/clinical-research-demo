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
  'StudyFirstPostDate', 'LastUpdatePostDate', 'StartDate', 'PrimaryCompletionDate', 'CompletionDate', 'EnrollmentCount',
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
// Affiliations sometimes carry a street address ("…, 100 Example Street, Springfield VA00000, USA").
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

export const FINISHED = 'COMPLETED,TERMINATED';

/**
 * The trials an indication researches (diseases.json `default_scope`): Phase 2 and later only,
 * or only trials whose conditions name the indication, when the search also finds neighbors.
 */
export const inScope = (d: Pick<Disease, 'default_scope'>) => (t: Trial) => {
  const sc = d.default_scope;
  return (!sc?.min_phase || t.phase_level >= sc.min_phase) && (!sc?.conditions_only || t.conditions.some((c) => c.toLowerCase().includes(sc.conditions_only!)));
};
export const isActive = (status: string) => ACTIVE.split(',').includes(status);

/**
 * Active drug trials for an indication, plus (if the indication sets
 * `include_completed_since`) trials that completed or stopped since that date:
 * in a commercial-stage market the recent readouts are most of the picture.
 */
export async function fetchTrials(d: Disease, fetchImpl: typeof fetch = fetch): Promise<Trial[]> {
  const out = new Map<string, Trial>();
  await pull(d, ACTIVE, DRUG_TYPES, out, fetchImpl);
  if (d.include_completed_since) await pull(d, FINISHED, `${DRUG_TYPES} AND AREA[PrimaryCompletionDate]RANGE[${d.include_completed_since},MAX]`, out, fetchImpl);
  return [...out.values()].sort((a, b) => a.nct.localeCompare(b.nct));
}

async function pull(d: Disease, statuses: string, advanced: string, out: Map<string, Trial>, fetchImpl: typeof fetch) {
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ 'query.cond': d.query_cond, 'filter.overallStatus': statuses, 'filter.advanced': advanced, fields: FIELDS, pageSize: '1000', ...(token ? { pageToken: token } : {}) });
    const res = await fetchImpl(`${BASE}?${params}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
    const body: any = await res.json();
    for (const s of body.studies ?? []) {
      const t = toTrial(s);
      out.set(t.nct, t);
    }
    token = body.nextPageToken;
  } while (token);
}

// A domain label starts with a letter or digit, so a file name such as "Deck_@_ADA_2026.pdf" is not an address.
const EMAIL = /[\w.+-]+@[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE = /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const STREET_ADDRESS = /\b\d{2,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Boulevard|Blvd|Drive|Dr\.|Suite)\b/;

/** Removes emails, phone numbers and street addresses from quoted source text (citation excerpts). */
export const redactContacts = (text: string) => text.replace(EMAIL, '[email removed]').replace(PHONE, '[phone removed]').replace(new RegExp(STREET_ADDRESS.source, 'g'), '[address removed]');

/** Throws if anything that looks like a phone number, email or street address reached the data. */
export function assertNoContacts(label: string, data: unknown) {
  const text = JSON.stringify(data);
  const email = text.match(new RegExp(EMAIL.source, 'i'));
  const phone = text.match(PHONE);
  const street = text.match(STREET_ADDRESS);
  if (email || phone || street) throw new Error(`${label}: contact details found (${(email ?? phone ?? street)![0]}). Nothing was saved.`);
}

export type RegistryEvent = { id: string; date: string; type: 'trial_registered' | 'status_changed' | 'phase_changed'; nct: string; sponsor: string; detail: string; origin: 'registry' };

/** Diff two daily snapshots into registry events. */
/** A trial new to a snapshot counts as registered only if first posted this recently; older ones entered the search some other way. */
const NEW_TRIAL_DAYS = 30;

/**
 * What changed between two snapshots. Each event is dated when ClinicalTrials.gov
 * says it happened (first posted, or last updated), not when the pull noticed it.
 * A trial that appears with an old first-posted date is not news: it entered the
 * search through an edit (its conditions, a status from outside the search, or this
 * indication's own search terms), so it gets no event.
 */
export function diffSnapshots(prev: Trial[], next: Trial[], date: string): RegistryEvent[] {
  const before = new Map(prev.map((t) => [t.nct, t]));
  const recent = new Date(Date.parse(date) - NEW_TRIAL_DAYS * 86_400_000).toISOString().slice(0, 10);
  const events: RegistryEvent[] = [];
  for (const t of next) {
    const b = before.get(t.nct);
    if (!b) {
      if (t.first_posted >= recent) events.push({ id: `${date}:new:${t.nct}`, date: t.first_posted <= date ? t.first_posted : date, type: 'trial_registered', nct: t.nct, sponsor: t.sponsor, detail: t.title, origin: 'registry' });
      continue;
    }
    const when = t.last_update && t.last_update > b.last_update && t.last_update <= date ? t.last_update : date;
    if (b.status !== t.status) events.push({ id: `${date}:status:${t.nct}`, date: when, type: 'status_changed', nct: t.nct, sponsor: t.sponsor, detail: `${b.status} → ${t.status}`, origin: 'registry' });
    if (b.phase_level !== t.phase_level) events.push({ id: `${date}:phase:${t.nct}`, date: when, type: 'phase_changed', nct: t.nct, sponsor: t.sponsor, detail: `${b.phases.join('/')} → ${t.phases.join('/')}`, origin: 'registry' });
  }
  return events;
}

/** "Phase 2/3", "Early Phase 1", or "" when the registry gives none. */
export function phaseText(phases: string[]): string {
  if (phases.includes('EARLY_PHASE1')) return 'Early Phase 1';
  const n = phases.map((p) => p.replace('PHASE', '')).filter((p) => /^\d$/.test(p));
  return n.length ? `Phase ${n.join('/')}` : '';
}

/** A trial as a headline names it: its acronym, else "Phase 2 HRS9531 trial", else its NCT ID. */
export function trialName(t: Trial | undefined, nct: string): string {
  if (t?.acronym) return t.acronym;
  const drug = t?.interventions.find((i) => !/placebo|vehicle|standard of care|usual care/i.test(i.name))?.name.split(/[(,;]/)[0].trim();
  const phase = t ? phaseText(t.phases) : '';
  return drug ? `${phase ? `${phase} ` : ''}${drug} trial` : nct;
}

/** A registry change in words: "ZUPREME-5 starts recruiting", "KaiNETIC-1 stops recruiting". */
export function registryHeadline(r: Pick<RegistryEvent, 'type' | 'detail' | 'nct'>, t: Trial | undefined): string {
  const name = trialName(t, r.nct);
  if (r.type === 'trial_registered') return `${name} registered`;
  const [from = '', to = ''] = r.detail.split(' → ');
  if (r.type === 'phase_changed') return `${name} moves to ${phaseText(to.split('/')) || 'no stated phase'}${phaseText(from.split('/')) ? ` from ${phaseText(from.split('/'))}` : ''}`;
  if (to === 'RECRUITING') return from === 'NOT_YET_RECRUITING' ? `${name} starts recruiting` : `${name} is recruiting again`;
  if (to === 'ACTIVE_NOT_RECRUITING') return `${name} stops recruiting`;
  if (to === 'COMPLETED') return `${name} completes`;
  if (to === 'ENROLLING_BY_INVITATION') return `${name} enrolls by invitation`;
  return `${name} is ${to.toLowerCase().replace(/_/g, ' ')}`;
}
