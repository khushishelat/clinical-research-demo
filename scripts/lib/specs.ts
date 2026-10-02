// Task specs for every pipeline step: processors, connectors and output
// schemas in one place. Flags and joins are never asked of the model; code
// sets them from these fields.

import type { Disease } from './pipeline';
import { A, B, E, N, O, S } from './pipeline';

// Step 3a: who owns a registry sponsor today, and its drugs for this disease.
// Tested Oct 1 on 12 MASH sponsors: core and pro agreed on every owner, but only
// pro returned real drug codes (core put NCT IDs in `codes`), so pro.
export const OWNER = {
  processor: 'pro',
  connectors: ['chembl', 'clinical_trials'],
  schema: O({
    current_owner: S('Company name only: the company that owns or controls this registry sponsor today (itself if independent). Pending deals go in relationship, not here.'),
    relationship: E(['independent', 'acquired', 'subsidiary', 'merged', 'renamed']),
    announced: N('Date the acquisition or merger was announced, YYYY-MM-DD.'),
    closed: N('Date it closed, YYYY-MM-DD.'),
    value: N('Deal value as stated, e.g. "up to $5.2B".'),
    owner_source_url: S('Source for the ownership.'),
    drugs: A(
      O({
        name: S('INN if there is one.'),
        codes: A(S('Development codes and brand names, never trial IDs.')),
        mechanism: S(),
        mechanism_source: E(['chembl', 'web']),
        chembl_id: N('ChEMBL molecule ID if ChEMBL has it.'),
        rights_holder: N('Company holding development rights if licensed out.'),
        highest_phase: S('Highest phase for this disease, or "Approved".'),
      }),
      "This sponsor's drugs for the disease."
    ),
  }),
  input: (d: Disease, sponsor: string, today: string, trials: { nct: string; title: string; interventions: string[]; phase: string }[]) => ({
    registry_sponsor: sponsor,
    disease: d.key === 'mash' ? 'MASH (metabolic dysfunction-associated steatohepatitis)' : d.name,
    today,
    trials,
  }),
};

// Step 3b: companies the web knows about, by interaction chaining until dry.
export const COMPANY_CHAIN = {
  processor: 'ultra',
  connectors: ['clinical_trials', 'chembl'],
  field: 'companies',
  maxPages: 4,
  minNew: 2,
  schema: O({
    companies: A(
      O({
        company: S(),
        country: S(),
        drugs: A(O({ name: S(), codes: A(S()), mechanism: S(), highest_phase: S('For this disease.'), approved_in: A(S()) })),
        source_url: S(),
      })
    ),
  }),
  first: (d: Disease, today: string) =>
    `Enumerate every company, pharma or biotech in any country, with a drug in clinical development or approved for ${d.name} as of ${today}. Go far beyond the best-known companies: include Chinese, Korean, Japanese, Indian and European biotechs, and companies whose trials appear only in non-US registries. Search ClinicalTrials.gov through the connector and confirm mechanisms with ChEMBL. For each company give its country and its drugs for ${d.name} (name, codes, mechanism, highest phase, where approved) with a source URL. Never fabricate.`,
  next: (d: Disease) =>
    `Continue. Return MORE companies with drugs in clinical development or approved for ${d.name} that you have NOT already returned in this conversation. Net-new only, no repeats, same fields, real source URLs.`,
};


const SRC = S('Primary source URL: company release, filing, regulator, journal or conference.');
const DATE = N('YYYY-MM-DD, or null if not stated.');

// Step 4: one run per company. The registry summary goes in so the model
// reconciles with the registry instead of rediscovering it. Every field keeps
// its basis (citations, reasoning, confidence) for the dataset view.
export const FACTS = {
  processor: 'pro',
  connectors: ['clinical_trials', 'pubmed'],
  schema: O({
    lead_assets: A(S(), 'The company’s most advanced drugs for this disease, best first.'),
    approvals: A(O({ drug: S(), region: S(), date: DATE, indication: S(), source_url: SRC }), 'Regulatory approvals for this disease.'),
    deals: A(O({ date: DATE, parties: A(S()), type: E(['license', 'acquisition', 'collaboration', 'option', 'divestiture', 'financing', 'other']), upfront: N('As stated, e.g. "$50M".'), total: N('As stated, e.g. "up to $1.0B".'), headline: S('12 words or fewer.'), source_url: SRC }), 'Deals touching this disease since January 2024.'),
    milestones: A(O({ date: S('YYYY-MM-DD'), type: E(['data', 'approval', 'regulatory', 'deal', 'trial_start', 'enrollment_complete', 'discontinuation', 'exit', 'other']), drug: S(), headline: S('12 words or fewer.'), source_url: SRC }), 'Dated public milestones for this disease since January 2025, newest first.'),
    next: A(O({ what: S(), date: DATE, earliest: DATE, latest: DATE, timing_text: S('As stated, e.g. "2H 2026".'), stated_by: S(), source_url: SRC }), 'What the company has said is coming, with its own timing.'),
    furthest_along: O({ drug: S(), phase: S(), where: S('Regions or "global".') }),
    next_regulatory_decision: O({ agency: N('FDA, EMA, NMPA, PMDA…'), date_or_window: N('As stated.'), stated_by: N('Who stated it.'), source_url: N('Source.') }, ['agency', 'date_or_window', 'stated_by', 'source_url']),
    pivotal_comparator: O({ nct: N('Pivotal trial NCT ID.'), compared_against: N('Placebo, standard care, or a named drug.') }),
    how_given: O({ route: N('e.g. subcutaneous injection, oral tablet.'), frequency: N('e.g. weekly, daily.') }),
    latest_readout: O({ date: DATE, result: N('One line, numbers where stated.'), source_url: N('Source.') }),
  }),
  input: (d: Disease, today: string, company: { name: string; drugs: { name: string; codes: string[]; mechanism: string; highest_phase: string }[]; registry_sponsors: string[] }, registry: { nct: string; acronym: string; title: string; phase: string; status: string; sponsor: string }[]) => ({
    company: company.name,
    disease: d.name,
    today,
    known_drugs: company.drugs.map((x) => ({ name: x.name, codes: x.codes.slice(0, 8), mechanism: x.mechanism, highest_phase: x.highest_phase })),
    registry_sponsor_names: company.registry_sponsors,
    registry_trials: registry,
    rules: 'Only dated, sourced facts. The ClinicalTrials.gov record alone is not evidence of news; use the company, its partners, regulators, conferences and journals. Leave a field null rather than guess.',
  }),
};

// Medicare coverage for the drugs approved in this disease (CMS Coverage connector).
export const COVERAGE = {
  processor: 'core',
  connectors: ['cms_coverage'],
  schema: O({ determinations: A(O({ drug: S(), policy: S(), id: S('NCD, LCD or article ID.'), type: E(['NCD', 'LCD', 'article', 'other']), effective_date: DATE, summary: S('One sentence.'), source_url: S() })) }),
  input: (d: Disease, approved: string[]) =>
    `Which Medicare national or local coverage determinations, articles or coverage policies apply to these drugs approved in the US for ${d.name}: ${approved.join(', ')}? Use the CMS Coverage connector. Give drug, policy title, ID, type, effective date, a one-sentence summary and a source URL. If none apply, return an empty list.`,
};

const PRIVACY = 'Professional facts only. Never include phone numbers, emails, street addresses, site contacts, or any opinion about a drug.';

// Step 5b: a name with several NPI matches. The connector lets the run look
// candidates up; code has already narrowed by exact name, state and specialty.
export const NPI_PICK = {
  processor: 'base',
  connectors: ['npi_registry'],
  schema: O({ npi: N('The matching 10-digit NPI, or null if none clearly matches.'), reason: S('One sentence.'), confidence: E(['high', 'medium', 'low']) }),
  input: (d: Disease, name: string, sites: { facility: string | null; city: string | null; state: string | null }[], candidates: { npi: string; credential: string; taxonomy: string; city: string; state: string }[]) => ({
    clinician: name,
    disease: d.name,
    likely_specialties: d.specialties,
    trial_sites: sites,
    candidates,
    task: 'Which candidate is the clinician who runs these trial sites? Use the NPI Registry connector to check. Return null unless one clearly matches.',
    rules: PRIVACY,
  }),
};

// Step 5c: common names. Does this person's PubMed record match their institution?
export const AUTHORSHIP = {
  processor: 'core',
  connectors: ['pubmed'],
  schema: O({ is_same_person: B('True if the PubMed papers on this disease are by this clinician.'), verified_count: { type: ['integer', 'null'], description: 'Papers on this disease by this person.' }, since_2024: { type: ['integer', 'null'], description: 'Of those, published 2024 or later.' }, recent: A(O({ pmid: S(), title: S(), year: S() })), reason: S('One sentence.') }),
  input: (d: Disease, c: { name: string; facilities: string[]; city: string | null; state: string | null }, terms: string) => ({
    clinician: c.name,
    institution: c.facilities.slice(0, 3),
    city: c.city,
    state: c.state,
    disease: d.name,
    pubmed_terms: terms,
    task: 'Using the PubMed connector, find papers on this disease by this specific person: match on affiliation with their institution or city, not on name alone.',
    rules: PRIVACY,
  }),
};

// Step 5d: roles the registry leaves out (lead PIs, presenters, authors), per company.
export const WEB_ROLES = {
  processor: 'pro',
  connectors: ['pubmed', 'npi_registry'],
  schema: O({
    clinicians: A(
      O({
        name: S(),
        role: E(['principal_investigator', 'study_chair', 'steering_committee', 'presenter', 'lead_author', 'other']),
        program: S('Trial acronym or drug.'),
        institution: S(),
        city: S(),
        country: S(),
        date: N('YYYY-MM-DD of the source, or null.'),
        source_url: S(),
      })
    ),
  }),
  input: (d: Disease, company: string, programs: string[], trials: { nct: string; acronym: string }[]) => ({
    company,
    disease: d.name,
    programs,
    registry_trials: trials,
    task: `Which clinicians are publicly named as principal investigators, study chairs, steering-committee members, conference presenters or lead authors for ${company}'s ${d.name} programs since 2024? Use PubMed for authorship and the NPI Registry to confirm US clinicians. Each person needs a dated source.`,
    rules: PRIVACY,
  }),
};

// Step 5e: a profile for the clinicians shown on screen (top 25 per disease).
export const PROFILE = {
  processor: 'core',
  connectors: ['npi_registry', 'pubmed', 'clinical_trials'],
  schema: O({
    specialty: N('From the NPI Registry where possible.'),
    institution: N('Current primary institution.'),
    research_focus: N('20 words or fewer, from their publications.'),
    other_trial_roles: A(O({ nct: S(), condition: S(), role: S() }), 'Investigator roles on other registered trials, up to 8.'),
  }),
  input: (d: Disease, c: { name: string; facilities: string[]; city: string | null; state: string | null; npi: string | null }) => ({
    clinician: c.name,
    npi: c.npi,
    institution_hints: c.facilities.slice(0, 3),
    city: c.city,
    state: c.state,
    disease: d.name,
    task: 'Build a short professional profile of this clinician using the NPI Registry, PubMed and ClinicalTrials.gov connectors.',
    rules: PRIVACY,
  }),
};

// Step 8: was this trial on the web before the registry? (web question, no connector)
export const FIRST_SEEN = {
  processor: 'base',
  schema: O({
    first_announced: N('YYYY-MM-DD of the earliest public announcement that refers to this specific trial, or null.'),
    source_url: N('That announcement.'),
    what: N('One line: who announced what.'),
    how_it_refers: E(['by_name', 'by_description'], 'by_name: acronym, NCT ID or study number. by_description: drug, phase and population that fit only this trial.'),
    plan_announced: N('YYYY-MM-DD of an earlier statement that the company planned to run a trial like this, before it referred to this one; else null.'),
  }),
  input: (t: { nct: string; acronym: string; title: string; company: string; drugs: string[]; first_posted: string }) => ({
    nct_id: t.nct,
    acronym: t.acronym,
    title: t.title,
    company: t.company,
    drugs: t.drugs,
    registry_first_posted: t.first_posted,
    task: 'When was this specific trial first announced publicly (press release, filing, investor presentation, conference)? Count only a source that refers to this trial by name or by a description that fits only it. A plan to start "a Phase 3 next year" does not count as this trial: report it in plan_announced instead. Return the earliest qualifying announcement, even if after the registry date. The registry record itself does not count.',
  }),
};

// Step 9: the weekly brief, written only from the week's sourced events.
export const BRIEF = {
  processor: 'core',
  schema: O({ title: S('10 words or fewer.'), sections: A(O({ heading: S('6 words or fewer.'), body: S('2 to 4 sentences, plain and specific.'), sources: A(S('URLs taken from the input events only.')) }), '4 to 6 sections.') }),
  input: (d: Disease, week: { from: string; to: string }, events: unknown[], upcoming: unknown[]) => ({
    disease: d.name,
    week,
    events,
    upcoming_30_days: upcoming,
    task: `Write this week's brief on ${d.name} drug development for BD and competitive-intelligence readers: 4 to 6 short sections, most important first. Use only the events given; every section cites the source URLs of the events it uses. No speculation, no investment advice.`,
  }),
};
