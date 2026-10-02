// Drawer view models: one trial, or one clinician. Pure, built from a loaded
// space. Professional facts only; contacts are never in the data to begin with.

import type { Space } from './load';
import type { Clinician } from './types';
import { drugNameSet, mentionsNeedles, trialNeedles } from './match';
import { drugLabels, hostOf } from './view';

type S = Space;
const present = <T>(x: T | undefined | null): x is T => x != null;

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
    specialty: c.npi?.taxonomy ?? (c.us ? 'Specialty not verified' : 'Outside the US'),
    place: c.npi ? place(c.npi.city, c.npi.state) : place(c.city, c.state, c.country),
    npiNote: c.us ? (c.npi ? null : c.npi_status === 'ambiguous' ? 'More than one NPI match' : 'No US NPI match') : 'No NPI',
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
  const names = drugNameSet(company?.drugs);
  const text = [t.title, t.acronym, ...t.interventions.flatMap((i) => [i.name, ...i.other_names])].join(' ').toLowerCase();
  const tested = drugs.filter((l) => [...names].some((n) => n.length > 3 && text.includes(n) && l.toLowerCase().includes(n.split(' ')[0])) || text.includes(l.split(' (')[0].toLowerCase()));
  const lead = tested[0] ?? t.interventions.find((i) => i.type !== 'OTHER')?.name ?? '';

  // Web items that name this trial or its drug.
  const needles = trialNeedles(t, company?.drugs);
  const mentions = (h: string) => mentionsNeedles(h, needles);
  const items: { date: string | null; headline: string; drug: string; source_url: string | null }[] = [
    ...(f?.milestones ?? []),
    ...(f?.deals ?? []).map((x) => ({ ...x, drug: '' })),
    ...(f?.approvals ?? []).map((a) => ({ ...a, headline: `${a.region} approval: ${a.indication}` })),
  ];
  const web = items
    .filter((m) => m.headline && mentions(`${m.headline} ${m.drug}`))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    // A milestone and an approval often describe the same day's news; keep the first.
    .filter((m, i, all) => all.findIndex((x) => x.date === m.date && (x.source_url === m.source_url || hostOf(x.source_url) === hostOf(m.source_url))) === i)
    .slice(0, 4)
    .map((m) => ({ date: m.date, headline: m.headline, source: m.source_url, host: hostOf(m.source_url) }));

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
      return { ...line, role: p.role === 'study_chair' ? 'Study chair' : p.facility ? 'Site PI' : 'Principal investigator', site: here, note: elsewhere ? `Site named in ${otherCo}’s record: ${elsewhere}` : webRole ? `${webRole.role}, ${webRole.program}` : null };
    })
    .filter(present)
    .filter((x, i, all) => all.findIndex((y) => y.key === x.key) === i)
    .sort((a, b) => b.trials - a.trials || (b.papers ?? 0) - (a.papers ?? 0));
  const hiddenSites = t.people.filter((p) => HIDDEN_SITE.test(p.facility ?? '')).length;
  const hiddenLabel = hiddenSites ? (t.people.find((p) => HIDDEN_SITE.test(p.facility ?? ''))?.facility ?? null) : null;

  // Investigators the web names for this trial: a role whose program is this trial's acronym or drug, at this company.
  const prog = [t.acronym, ...tested.map((x) => x.split(' (')[0])].filter((x) => x).map((x) => x.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const fromWeb = s.clinicians
    .filter((c) => !t.people.some((p) => p.key === c.key || c.aliases.includes(p.key)))
    .flatMap((c) =>
      c.web_roles
        .filter((r) => {
          const p = (r.program ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
          return p && prog.some((x) => p.includes(x) || x.includes(p)) && (!company || !r.company || r.company.toLowerCase().includes(company.name.split(' ')[0].toLowerCase()) || company.name.toLowerCase().includes(r.company.split(' ')[0].toLowerCase()));
        })
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
    web,
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
    webRoles: c.web_roles.map((w) => ({ role: roleLabel(w.role), program: w.program, company: w.company, date: w.date, source: w.source_url, host: hostOf(w.source_url) })),
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
