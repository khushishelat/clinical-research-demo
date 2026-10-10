// Drawer view models: one trial, or one clinician. Pure, built from a loaded
// space. Professional facts only; contacts are never in the data to begin with.

import type { Space } from './load';
import type { Clinician } from './types';
import { comparatorLabel, regulatoryEvent, regulatoryLabel, routeLabel } from './labels';
import { drugLabels, hostOf, shortMechanism } from './view';

type S = Space;
const present = <T>(x: T | undefined | null): x is T => x != null;

// Arms that aren't the drug under test.
const COMPARATOR = /placebo|matching|vehicle|sham|standard of care|usual care|saline|diet|lifestyle|exercise/i;
const HIDDEN_SITE = /investigational site|clinical study site|research site|site\s*\d+|study site/i;
const title = (x: string | null | undefined) => (x ?? '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
const place = (city?: string | null, state?: string | null, country?: string | null) => {
  if (country && country !== 'United States') return [city, country].filter(present).join(', ');
  return [title(city), state && state.length === 2 ? state.toUpperCase() : state].filter((x) => x).join(', ');
};
export const initials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .filter((ch) => /\p{L}/u.test(ch))
    .slice(0, 2)
    .join('')
    .toUpperCase();

const ROLE: Record<string, string> = { principal_investigator: 'Principal investigator', study_chair: 'Study chair', steering_committee: 'Steering committee', presenter: 'Presented data', lead_author: 'Lead author', other: 'Named role' };
const roleLabel = (r: string) => ROLE[r] ?? r;

/** A clinician by key, or by a registry key merged into them. */
export const findClinician = (s: S, key: string): Clinician | undefined => s.clinicians.find((x) => x.key === key || x.aliases.includes(key));

function clinicianLine(s: S, key: string) {
  const c = findClinician(s, key);
  if (!c) return null;
  const profile = Boolean(c.us && c.npi);
  return {
    key: c.key,
    name: c.name,
    initials: initials(c.name),
    profile,
    // Outside the US only when a country says so; the registry often names a study chair with no location at all.
    specialty: c.npi?.taxonomy ?? (c.us ? 'Specialty not verified' : c.country ? 'Outside the US' : 'Location not listed'),
    place: c.npi ? place(c.npi.city, c.npi.state) : place(c.city, c.state, c.country),
    npiNote: c.us ? (c.npi ? null : c.npi_status === 'ambiguous' ? 'More than one NPI match' : 'No US NPI match') : c.country ? 'No NPI' : null,
    trials: new Set(c.roles.map((r) => r.nct)).size,
    papers: c.pubmed?.verified ? c.pubmed.count : null,
  };
}

export function trialDetail(s: S, nct: string) {
  const t = s.trials.find((x) => x.nct === nct);
  if (!t) return null;
  const company = s.companies.find((c) => c.trials.includes(nct) || c.investigator_trials.includes(nct)) ?? null;
  const f = company ? s.facts[company.key] : null;
  const drugs = company ? drugLabels(company.drugs ?? []) : [];

  // Which of the company's drugs this trial tests, by any name it goes by.
  const names = new Set<string>();
  for (const d of company?.drugs ?? []) for (const n of [d.name, ...(d.codes ?? []), ...(d.name.match(/\(([^)]+)\)/)?.[1].split(/[;,]/) ?? [])]) if (n) names.add(n.split('(')[0].trim().toLowerCase());
  const text = [t.title, t.acronym, ...t.interventions.flatMap((i) => [i.name, ...i.other_names])].join(' ').toLowerCase();
  const tested = drugs.filter((l) => [...names].some((n) => n.length > 3 && text.includes(n) && l.toLowerCase().includes(n.split(' ')[0])) || text.includes(l.split(' (')[0].toLowerCase()));
  // When no company drug is named, fall back to what the experimental arm gives, never a placebo or comparator.
  const experimental = new Set(t.arms.filter((a) => a.type === 'EXPERIMENTAL').flatMap((a) => a.interventions.map((n) => n.toLowerCase())));
  const candidates = t.interventions.filter((i) => i.type !== 'OTHER' && !COMPARATOR.test(i.name));
  const lead = tested[0] ?? (candidates.find((i) => experimental.has(i.name.toLowerCase())) ?? candidates[0])?.name ?? '';

  // Other trials of the same company testing the same lead drug: the rabbit hole.
  const leadNeedles = [lead.split(' (')[0], ...(lead.match(/\(([^)]+)\)/)?.[1].split(/[;,]/) ?? [])]
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.length > 3);
  const siblings = company
    ? [...company.trials, ...company.investigator_trials]
        .filter((n) => n !== nct)
        .map((n) => s.trials.find((x) => x.nct === n))
        .filter(present)
        .filter((o) => {
          const text = [o.title, o.acronym, ...o.interventions.flatMap((i) => [i.name, ...i.other_names])]
            .join(' ')
            .toLowerCase();
          return leadNeedles.some((n) => text.includes(n));
        })
        .map((o) => ({
          nct: o.nct,
          label: o.acronym || o.nct,
          phase: o.phases.map((p) => p.replace('PHASE', 'Phase ').replace('EARLY_', 'Early ')).join(' / ') || 'Phase n/a',
        }))
    : [];
  // Disclosures the research run tied to this trial (v1 `nct`), then news about the
  // trial's drug as a program. Nothing is matched from headlines.
  type Item = { date: string | null; headline: string; source_url: string | null };
  const aboutLead = (x: string | null | undefined) => Boolean(x) && leadNeedles.some((n) => x!.toLowerCase().includes(n));
  const newest = (a: Item, b: Item) => (b.date ?? '').localeCompare(a.date ?? '');
  const once = (m: Item, i: number, all: Item[]) => all.findIndex((x) => x.date === m.date && hostOf(x.source_url) === hostOf(m.source_url)) === i;
  const row = (m: Item) => ({ date: m.date, headline: m.headline, source: m.source_url, host: hostOf(m.source_url) });
  const news = s.events.filter((e) => e.origin === 'monitor' && company && e.company === company.key);
  const web = [...(f?.milestones ?? []).filter((m) => m.nct === nct), ...news.filter((e) => e.nct === nct)].sort(newest).filter(once).slice(0, 6).map(row);
  const program: Item[] = [
    ...(f?.milestones ?? []).filter((m) => !m.nct && aboutLead(m.drug)),
    ...news.filter((e) => !e.nct && aboutLead(e.drug)),
    ...(f?.deals ?? []).filter((x) => (x.drugs ?? []).some(aboutLead)),
    ...(f?.approvals ?? []).filter((a) => aboutLead(a.drug)).map((a) => ({ ...a, headline: `${a.region} approval: ${a.indication}` })),
    ...(f?.regulatory ?? []).filter((r) => r.status === 'done' && aboutLead(r.drug)).map((r) => ({ date: r.date, headline: regulatoryEvent(r.agency, r.kind), source_url: r.source_url })),
  ];
  const programWeb = program.sort(newest).filter(once).slice(0, 4).map(row);
  const webSources = new Set([...web, ...programWeb].map((w) => w.host).filter((h) => h)).size;
  const guided = (f?.next ?? []).filter((n) => n.nct === nct).map((n) => ({ what: n.what, window: n.timing_text, source: n.source_url, host: hostOf(n.source_url) }));
  const readout = f?.readouts?.find((r) => r.nct === nct) ?? null;
  const pivot = f?.pivotal?.find((p) => p.nct === nct);
  const pivotal = pivot ? (pivot.comparator === 'active' && pivot.comparator_name ? `vs ${pivot.comparator_name}` : `vs ${comparatorLabel(pivot.comparator).toLowerCase()}`) : null;

  // What the trial is, in plain terms: registry design and arms, plus the company's record of the drug. Nothing generated.
  const drugRec = company?.drugs.find((x) => [x.name, ...(x.codes ?? [])].some((n) => leadNeedles.some((l) => n.toLowerCase().includes(l))));
  const PLACEBO = /placebo|matching|vehicle|sham/i;
  const BACKGROUND = /biopsy|procedure|diet|exercise|lifestyle|standard of care|background|counsel|imaging|mri|scan/i;
  const testsLead = (a: { interventions: string[] }) => a.interventions.some((n) => leadNeedles.some((l) => n.toLowerCase().includes(l)));
  const placebo = t.arms.some((a) => a.type === 'PLACEBO_COMPARATOR' || a.interventions.some((n) => PLACEBO.test(n)));
  const others = [...new Set(t.arms.filter((a) => !testsLead(a)).flatMap((a) => a.interventions).filter((n) => !PLACEBO.test(n) && !BACKGROUND.test(n)))];
  const control = placebo ? 'placebo-controlled' : others.length ? `vs ${others.slice(0, 2).join(' and ')}` : t.arms.length > 1 ? 'multiple arms' : t.arms.length === 1 ? 'single-arm' : null;
  const ALLOC: Record<string, string> = { RANDOMIZED: 'Randomized', NON_RANDOMIZED: 'Non-randomized' };
  const MASK: Record<string, string> = { NONE: 'open-label', SINGLE: 'single-blind', DOUBLE: 'double-blind', TRIPLE: 'double-blind', QUADRUPLE: 'double-blind' };
  const MODALITY: Record<string, string> = { small_molecule: 'small molecule', peptide: 'peptide', protein: 'protein', antibody: 'antibody', oligonucleotide: 'oligonucleotide', gene_therapy: 'gene therapy', cell_therapy: 'cell therapy' };
  const design = [ALLOC[t.design?.allocation ?? ''], MASK[t.design?.masking ?? ''], control].filter((x): x is string => Boolean(x));
  const endpoint = t.primary_outcomes?.[0];
  const sameDrug = (x: string | null | undefined) => Boolean(x) && leadNeedles.some((l) => x!.toLowerCase().includes(l));
  const summary = {
    drug: lead,
    mechanism: drugRec ? (drugRec.phase && drugRec.mechanism.length <= 40 ? drugRec.mechanism : (shortMechanism(drugRec.mechanism) ?? null)) : null,
    modality: drugRec?.modality ? (MODALITY[drugRec.modality] ?? null) : null,
    route: f?.how_given?.route && (sameDrug(f.furthest_along?.drug) || sameDrug(f.lead_assets?.[0])) ? [routeLabel(f.how_given.route), f.how_given.frequency].filter(Boolean).join(', ') : null,
    design: design.length ? `${design.join(', ')} ${t.phases.length ? t.phases.map((p) => p.replace('PHASE', 'Phase ')).join('/') : ''} trial`.replace(/^./, (c) => c.toUpperCase()).replace(/\s+/g, ' ') : null,
    endpoint: endpoint?.measure ? (endpoint.measure.length > 200 ? `${endpoint.measure.slice(0, 199).trimEnd()}…` : endpoint.measure) : null,
    timeframe: endpoint?.time_frame || null,
    more_endpoints: Math.max(0, (t.primary_outcomes?.length ?? 0) - 1),
    designations: [...new Set((f?.regulatory ?? []).filter((r) => r.status === 'done' && sameDrug(r.drug) && ['breakthrough', 'fast_track', 'orphan', 'prime', 'priority_review'].includes(r.kind)).map((r) => `${r.agency} ${regulatoryLabel(r.kind)}`))],
  };

  // Investigators the registry names, most involved first.
  const named = t.people
    .map((p) => {
      const line = clinicianLine(s, p.key);
      if (!line) return null;
      const here = HIDDEN_SITE.test(p.facility ?? '') ? null : (p.facility ?? p.affiliation ?? null);
      const c = findClinician(s, p.key);
      const elsewhere = !here ? c?.facilities.find((x) => !HIDDEN_SITE.test(x)) : undefined;
      const other = elsewhere ? c?.roles.find((r) => r.facility === elsewhere) : undefined;
      const otherCo = other ? (s.companies.find((x) => x.key === other.company)?.name ?? other.sponsor) : null;
      const webRole = c?.web_roles[0];
      return { ...line, role: p.role === 'study_chair' ? 'Study chair' : p.facility ? 'Site PI' : 'Principal investigator', site: here, note: elsewhere ? `Site named in ${otherCo}’s record: ${elsewhere}` : webRole ? `${roleLabel(webRole.role)}, ${webRole.program}` : null };
    })
    .filter(present)
    .filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i)
    .sort((a, b) => b.trials - a.trials || (b.papers ?? 0) - (a.papers ?? 0));
  const hiddenSites = t.people.filter((p) => HIDDEN_SITE.test(p.facility ?? '')).length;
  const hiddenLabel = hiddenSites ? (t.people.find((p) => HIDDEN_SITE.test(p.facility ?? ''))?.facility ?? null) : null;

  // Investigators named in disclosures on this trial (v1: the role's own `nct`).
  const fromWeb = s.clinicians
    .filter((c) => !t.people.some((p) => p.key === c.key || c.aliases.includes(p.key)))
    .flatMap((c) =>
      c.web_roles
        .filter((r) => r.nct === nct)
        .slice(0, 1)
        .map((r) => ({ ...clinicianLine(s, c.key)!, role: roleLabel(r.role), program: r.program, date: r.date, source: r.source_url, host: hostOf(r.source_url) }))
    )
    .sort((a, b) => (b.papers ?? 0) - (a.papers ?? 0))
    .slice(0, 12);

  return {
    nct: t.nct,
    acronym: t.acronym,
    title: t.title,
    status: t.status.replace(/_/g, ' '),
    // What the daily registry pull saw change, newest first, so anything marked new can be traced.
    changes: s.events
      .filter((e) => e.origin === 'registry' && e.nct === nct && e.type !== 'trial_registered')
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ date: e.date, text: e.change ?? e.headline })),
    phase: t.phases.map((p) => p.replace('PHASE', 'Phase ').replace('EARLY_', 'Early ')).join(' / ') || 'Phase not set',
    company: company ? { key: company.key, name: company.name } : null,
    sponsor: t.sponsor,
    runBy: t.run_by,
    lead,
    enrollment: t.enrollment,
    sites: t.n_sites,
    countries: t.countries.length,
    firstPosted: t.first_posted,
    primaryCompletion: t.primary_completion,
    // Step 08: when the web first announced this trial, against its registry date. Per-trial only — never invented per news item.
    firstSeen: (() => {
      const seen = s.firstSeen[nct];
      return seen && seen.days_earlier > 0 && seen.first_announced
        ? { days: seen.days_earlier, date: seen.first_announced, source: seen.source_url, what: seen.what }
        : null;
    })(),
    summary,
    web,
    programWeb,
    webSources,
    guided,
    readout,
    pivotal,
    siblings,
    named,
    hiddenSites,
    hiddenLabel,
    fromWeb,
  };
}

export function clinicianDetail(s: S, key: string) {
  const c = findClinician(s, key);
  // Profiles are US-only and NPI-verified.
  if (!c || !c.us || !c.npi) return null;
  const trialsBy = new Map(s.trials.map((t) => [t.nct, t]));
  const nameOf = (k: string | null, sponsor: string) => (k && s.companies.find((x) => x.key === k)?.name) || sponsor;
  const roles = [...new Map(c.roles.map((r) => [r.nct, r])).values()].map((r) => {
    const t = trialsBy.get(r.nct);
    return {
      nct: r.nct,
      label: t?.acronym || r.nct,
      company: nameOf(r.company, r.sponsor),
      phase: t ? t.phases.map((p) => p.replace('PHASE', 'Phase ')).join(' / ') : '',
      role: r.role === 'study_chair' ? 'Study chair' : r.facility ? 'Site PI' : 'Principal investigator',
      where: [HIDDEN_SITE.test(r.facility ?? '') ? null : r.facility, place(r.city, r.state, r.country)].filter((x) => x).join(', '),
    };
  });
  // Only companies that are rows on this map; an academic sponsor still shows on its trial role.
  const onMap = new Set(s.companies.map((x) => x.name));
  const companies = [...new Set([...c.roles.map((r) => r.company), ...c.web_roles.map((w) => w.company)])].filter((x): x is string => Boolean(x && onMap.has(x))).slice(0, 8);
  const hostFor = (name: string) => {
    const co = s.companies.find((x) => x.name === name);
    return co ? hostOf(co.owner_source ?? co.web?.source) : null;
  };
  return {
    key: c.key,
    name: c.name,
    initials: initials(c.name),
    specialty: c.npi.taxonomy,
    place: place(c.npi.city, c.npi.state),
    npiUrl: `https://npiregistry.cms.hhs.gov/provider-view/${c.npi.number}`,
    activeTrials: roles.length,
    webRoles: c.web_roles.map((w) => ({ role: roleLabel(w.role), program: w.program, nct: w.nct ?? null, company: w.company, date: w.date, source: w.source_url, host: hostOf(w.source_url) })),
    papers: c.pubmed?.verified ? { count: c.pubmed.count, since2024: c.pubmed.since_2024, recent: c.pubmed.recent } : null,
    companies: companies.map((n) => ({ name: n, host: hostFor(n) })),
    roles,
    focus: c.profile?.research_focus ?? null,
    institution: c.profile?.institution ?? c.facilities.find((x) => !HIDDEN_SITE.test(x)) ?? null,
    otherTrials: (c.profile?.other_trial_roles ?? []).filter((o) => !roles.some((r) => r.nct === o.nct)).slice(0, 6),
  };
}

export type TrialDetail = NonNullable<ReturnType<typeof trialDetail>>;
export type ClinicianDetail = NonNullable<ReturnType<typeof clinicianDetail>>;
