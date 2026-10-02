// Task specs for every pipeline step: processors, connectors and output
// schemas in one place. Flags and joins are never asked of the model; code
// sets them from these fields.
//
// Every spec has a `key`: the run-log prefix its units are stored under. A
// changed spec gets a new version in its key (facts@1 → facts@2), so a re-run
// pays for the new spec on purpose and every record says which spec made it.
// Specs without a version are unchanged since the first MASH build.
//
// v1 rules: anything about a trial returns `nct`, picked from the trials we
// pass in, and anything about a drug returns `drug`, by the name we pass in.
// Code joins on those exactly; nothing is matched from prose. Phases, deal
// types and event kinds are enums; amounts come as stated plus a number.

import type { Disease } from './pipeline';
import { A, B, E, N, O, S } from './pipeline';

export const PHASES = ['preclinical', 'phase_1', 'phase_1_2', 'phase_2', 'phase_2_3', 'phase_3', 'filed', 'approved'] as const;
const PHASE = (description: string) => E([...PHASES], description);
const NCT = N('NCT ID from registry_trials that this item is about, or null if it is about the program or company rather than one trial.');
const DRUG = S('The drug by its name in known_drugs, or its INN if it is not listed there.');
const NUM = (description: string) => ({ type: ['number', 'null'], description });
const INT = (description: string) => ({ type: ['integer', 'null'], description });
const label = (d: Disease) => (d.subtitle ? `${d.name} (${d.subtitle})` : d.name);

// Step 3c: one company, one row. Registry sponsors and web finds name the same
// company differently ("Hoffmann-La Roche" in the registry, "Roche" after the
// 89bio acquisition). One run groups the names; code merges the rows. No
// hand-written alias list.
export const SAME_COMPANY = {
  key: 'same',
  processor: 'core',
  schema: O({
    groups: A(
      O({
        names: A(S(), 'Two or more of the given names, exactly as given.'),
        company: S('The company’s usual name today.'),
        source_url: S('A source showing these names are one company.'),
      }),
      'Only groups of two or more names. Leave out every name that stands alone.'
    ),
  }),
  input: (d: Disease, names: string[]) => ({
    disease: d.name,
    names,
    task: 'Which of these names refer to the same company today? A parent and its wholly owned subsidiaries count as one company. Different companies that share a word are not the same (Merck & Co. and Merck KGaA are two companies). Copy names exactly as given.',
  }),
};

// Step 3a: who owns a registry sponsor today, and its drugs for this indication.
// Tested Oct 1 on 12 MASH sponsors: core and pro agreed on every owner, but only
// pro returned real drug codes (core put NCT IDs in `codes`), so pro.
// v1: phase is an enum (MASH v0 returned 16 phrasings), plus modality, targets
// and rights by territory.
export const OWNER = {
  key: 'owner@1',
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
        modality: E(['small_molecule', 'peptide', 'protein', 'antibody', 'oligonucleotide', 'gene_therapy', 'cell_therapy', 'other']),
        targets: A(S('Gene symbol of a molecular target, e.g. THRB, GLP1R, FGFR1.'), 'From ChEMBL where it has them.'),
        mechanism: S('One short phrase, e.g. "THR-β agonist" or "GLP-1/GIP receptor agonist".'),
        mechanism_source: E(['chembl', 'web']),
        chembl_id: N('ChEMBL molecule ID if ChEMBL has it.'),
        phase: PHASE('Highest phase for this indication.'),
        phase_note: N('Only if the phase needs a caveat, e.g. "Phase 3 in NAFLD; no indication-specific trial yet".'),
        rights: A(O({ holder: S(), territory: S('e.g. "Worldwide", "Greater China", "ex-China".') }), 'Who holds rights by territory, if anyone other than the owner holds some.'),
      }),
      "This sponsor's drugs for the indication."
    ),
  }),
  input: (d: Disease, sponsor: string, today: string, trials: { nct: string; title: string; interventions: string[]; phase: string }[]) => ({
    registry_sponsor: sponsor,
    indication: label(d),
    today,
    trials,
  }),
};

// Step 3b: companies the web knows about, by interaction chaining until dry.
// v1: MASH v0 stopped at the 4-page cap while pages still added 7 to 9 new
// companies, so the cap is 8 and a page must add 3, but only from page 4 (the
// MASH v1 run stopped at page 3 after one thin page and missed 8 companies v0
// had found). Large indications chain once per region (`chain_regions`).
export const COMPANY_CHAIN = {
  key: 'chain@1',
  processor: 'ultra',
  connectors: ['clinical_trials', 'chembl'],
  field: 'companies',
  maxPages: 8,
  minNew: 3,
  minPages: 4,
  schema: O({
    companies: A(
      O({
        company: S(),
        country: S(),
        registry_sponsor_names: A(S(), 'Names this company uses as a trial sponsor on ClinicalTrials.gov, if any.'),
        drugs: A(O({ name: S(), codes: A(S()), mechanism: S('One short phrase.'), phase: PHASE('Highest phase for this indication.'), approved_in: A(S()) })),
        source_url: S(),
      })
    ),
  }),
  first: (d: Disease, today: string, region: string | null) =>
    `Enumerate every company, pharma or biotech, with a drug in clinical development or approved for ${label(d)} as of ${today}${region ? `, headquartered in ${region}` : ' in any country'}. Go far beyond the best-known companies${region ? '' : ': include Chinese, Korean, Japanese, Indian and European biotechs, and companies whose trials appear only in non-US registries'}. Search ClinicalTrials.gov through the connector and confirm mechanisms with ChEMBL. For each company give its country, the names it uses as a trial sponsor, and its drugs for ${d.name} (name, codes, mechanism, highest phase, where approved) with a source URL. Never fabricate.`,
  next: (d: Disease, region: string | null) =>
    `Continue. Return MORE companies${region ? ` headquartered in ${region}` : ''} with drugs in clinical development or approved for ${d.name} that you have NOT already returned in this conversation. Net-new only, no repeats, same fields, real source URLs.`,
};

const SRC = S('Primary source URL: company release, filing, regulator, journal or conference.');
const DATE = N('YYYY-MM-DD, or null if not stated.');

// Step 4: two runs per company, each with one job. The registry summary goes in
// so the model reconciles with the registry instead of rediscovering it. Every
// field keeps its basis (citations, reasoning, confidence) for the table view.
// v1 rules, from what MASH v0 returned: items carry nct and drug (35% of
// milestones named a trial); phases are enums (40 phrasings); readouts move to
// their own per-trial spec (READOUT).
// v2: the v1 pilot asked one pro run for ~56 fields and got fewer milestones
// and no deal amounts (Madrigal: 3 deals with 2 amounts in v0, 2 with none in
// v1). Clinical facts and deal terms are now separate runs (FACTS, DEALS).
const registryInput = (d: Disease, today: string, company: { name: string; drugs: { name: string; codes: string[]; mechanism: string; highest_phase: string }[]; registry_sponsors: string[] }, registry: { nct: string; acronym: string; title: string; phase: string; status: string; sponsor: string }[]) => ({
  company: company.name,
  indication: label(d),
  today,
  known_drugs: company.drugs.map((x) => ({ name: x.name, codes: x.codes.slice(0, 8), mechanism: x.mechanism, highest_phase: x.highest_phase })),
  registry_sponsor_names: company.registry_sponsors,
  registry_trials: registry,
});

export const FACTS = {
  key: 'facts@2',
  processor: 'pro',
  connectors: ['clinical_trials', 'pubmed'],
  schema: O({
    lead_assets: A(DRUG, 'The company’s most advanced drugs for this indication, best first.'),
    furthest_along: O({ drug: DRUG, phase: PHASE('Its highest phase for this indication.'), where: S('Regions or "global".'), note: N('Only if the phase needs a caveat.') }),
    approvals: A(O({ drug: DRUG, region: S(), date: DATE, indication: S(), source_url: SRC }), 'Regulatory approvals for this indication.'),
    milestones: A(
      O({
        date: S('YYYY-MM-DD'),
        type: E(['data', 'trial_start', 'enrollment_complete', 'publication', 'presentation', 'discontinuation', 'exit', 'other']),
        drug: DRUG,
        nct: NCT,
        headline: S('12 words or fewer.'),
        source_url: SRC,
      }),
      'Dated clinical and program milestones for this indication since January 2025, newest first. Deals, financings, designations and filings are researched separately; leave them out.'
    ),
    next: A(
      O({
        what: S(),
        kind: E(['readout', 'filing', 'decision', 'trial_start', 'enrollment_complete', 'launch', 'other']),
        drug: DRUG,
        nct: NCT,
        stated_on: DATE,
        earliest: DATE,
        latest: DATE,
        timing_text: S('As stated, e.g. "2H 2026".'),
        stated_by: S(),
        source_url: SRC,
      }),
      'What the company has said is coming, with its own timing. Only items whose window has not passed as of today.'
    ),
    pivotal: A(O({ nct: NCT, comparator: E(['placebo', 'active', 'standard_of_care', 'none', 'unknown']), comparator_name: N('The named drug, for an active comparator.') }), 'Pivotal trials for this indication.'),
    how_given: O({ route: E(['oral', 'subcutaneous', 'intravenous', 'intramuscular', 'topical', 'inhaled', 'other']), frequency: N('e.g. weekly, daily.') }),
  }),
  input: (d: Disease, today: string, company: Parameters<typeof registryInput>[2], registry: Parameters<typeof registryInput>[3]) => ({
    ...registryInput(d, today, company, registry),
    rules: 'Only dated, sourced facts. The ClinicalTrials.gov record alone is not evidence of news; use the company, its partners, regulators, conferences and journals. Give nct whenever an item is about one of registry_trials, and drug by its known_drugs name. Leave a field null rather than guess.',
  }),
};

// Step 4 (v2): deal terms, financings and regulatory events, one run per company.
// No connectors: these come from announcements, filings and regulators.
export const DEALS = {
  key: 'deals@1',
  processor: 'pro',
  schema: O({
    deals: A(
      O({
        date: DATE,
        parties: A(S()),
        drugs: A(DRUG),
        type: E(['license', 'acquisition', 'collaboration', 'option', 'divestiture', 'other']),
        upfront: N('As announced, e.g. "$50M upfront".'),
        total: N('The headline value as announced, including milestones, e.g. "up to $4.4B".'),
        currency: N('ISO code of the amounts, e.g. USD.'),
        upfront_m: NUM('Upfront in millions of that currency.'),
        total_m: NUM('Headline value in millions of that currency.'),
        headline: S('12 words or fewer.'),
        source_url: SRC,
      }),
      'Every licensing, acquisition, option and partnership deal touching this indication since January 2024, in or out. Read each announcement for its terms.'
    ),
    financings: A(
      O({ date: DATE, kind: E(['equity', 'debt', 'royalty', 'grant', 'other']), amount: N('As stated.'), currency: N('ISO code.'), amount_m: NUM('In millions of that currency.'), headline: S('12 words or fewer.'), source_url: SRC }),
      'Financings since January 2025.'
    ),
    regulatory: A(
      O({
        drug: DRUG,
        kind: E(['breakthrough', 'fast_track', 'orphan', 'prime', 'priority_review', 'accelerated_approval', 'filing', 'filing_accepted', 'decision_date', 'other']),
        agency: S('FDA, EMA, MHRA, NMPA, PMDA…'),
        status: E(['done', 'expected']),
        date: DATE,
        window: N('As stated, for an expected event, e.g. "1H 2027".'),
        source_url: SRC,
      }),
      'Designations, filings and decision dates for this indication, done or expected. Not approvals.'
    ),
  }),
  input: (d: Disease, today: string, company: Parameters<typeof registryInput>[2], registry: Parameters<typeof registryInput>[3]) => ({
    ...registryInput(d, today, company, registry),
    rules: 'Only dated, sourced facts from the company, its partners, filings and regulators. For each deal give the upfront and the headline value exactly as announced, with currency and amounts in millions; if terms were not disclosed, say so by leaving them null. Leave a field null rather than guess.',
  }),
};

// Step 4b (v1): one run per company trial in Phase 2 or later that has reached
// primary completion or reported data. Results stay keyed to the trial, so a
// comparison across companies needs no matching.
export const READOUT = {
  key: 'readout@1',
  processor: 'core',
  connectors: ['clinical_trials', 'pubmed'],
  schema: O({
    has_data: B('True if results of this trial have been reported publicly.'),
    date: DATE,
    analysis: N('Which report, e.g. "Week 52 topline" or "Part 1 interim".'),
    endpoint: N('The primary endpoint as stated.'),
    arms: A(O({ arm: S('The arm or dose as named.'), result: S('As stated, with numbers.') }), 'Results per arm, comparator last.'),
    n: INT('Patients in the analysis.'),
    p_value: N('As stated, for the main comparison.'),
    source_url: N('The report: release, abstract, paper or registry results.'),
  }),
  input: (d: Disease, today: string, t: { nct: string; acronym: string; title: string; phase: string; status: string; primary_completion: string }, company: string, drugs: string[]) => ({
    nct_id: t.nct,
    acronym: t.acronym,
    title: t.title,
    phase: t.phase,
    status: t.status,
    primary_completion: t.primary_completion,
    company,
    drugs,
    indication: label(d),
    today,
    task: 'Has this trial reported results? Use ClinicalTrials.gov posted results and PubMed, plus company releases and conference abstracts. Report the most recent results for this trial with numbers exactly as stated. If none are public, set has_data to false and leave the rest empty.',
  }),
};

// Medicare coverage for the drugs approved in this disease (CMS Coverage connector).
export const COVERAGE = {
  key: 'coverage',
  processor: 'core',
  connectors: ['cms_coverage'],
  schema: O({ determinations: A(O({ drug: S(), policy: S(), id: S('NCD, LCD or article ID.'), type: E(['NCD', 'LCD', 'article', 'other']), effective_date: DATE, summary: S('One sentence.'), source_url: S() })) }),
  input: (d: Disease, approved: string[]) =>
    `Which Medicare national or local coverage determinations, articles or coverage policies apply to these drugs approved in the US for ${label(d)}: ${approved.join(', ')}? Use the CMS Coverage connector. Give drug, policy title, ID, type, effective date, a one-sentence summary and a source URL. If none apply, return an empty list.`,
};

const PRIVACY = 'Professional facts only. Never include phone numbers, emails, street addresses, site contacts, or any opinion about a drug.';

// Step 5b: a name with several NPI matches. The connector lets the run look
// candidates up; code has already narrowed by exact name, state and specialty.
export const NPI_PICK = {
  key: 'npi',
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
  key: 'pm',
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
// v1: nct, picked from the registry trials passed in (22% of v0 programs
// named a registry acronym).
export const WEB_ROLES = {
  key: 'roles@1',
  processor: 'pro',
  connectors: ['pubmed', 'npi_registry'],
  schema: O({
    clinicians: A(
      O({
        name: S(),
        role: E(['principal_investigator', 'study_chair', 'steering_committee', 'presenter', 'lead_author', 'other']),
        program: S('Trial acronym or drug.'),
        nct: NCT,
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
    task: `Which clinicians are publicly named as principal investigators, study chairs, steering-committee members, conference presenters or lead authors for ${company}'s ${d.name} programs since 2024? Use PubMed for authorship and the NPI Registry to confirm US clinicians. Each person needs a dated source. Give nct when the role is on one of registry_trials.`,
    rules: PRIVACY,
  }),
};

// Step 5e: a profile for the clinicians shown on screen (top 25 per disease).
export const PROFILE = {
  key: 'profile',
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
// v1: core, after a base re-run missed a trial a slide deck had named.
export const FIRST_SEEN = {
  key: 'seen@1',
  processor: 'core',
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

// Step 9: the brief, written only from the period's sourced events.
// v1: the title names the period's lead development (v0: "MASH Development:
// Weekly Brief"); registry changes come as their own list.
export const BRIEF = {
  key: 'brief@1',
  processor: 'core',
  schema: O({ title: S('The most important development of the period, 10 words or fewer. Never "weekly brief".'), sections: A(O({ heading: S('6 words or fewer.'), body: S('2 to 4 sentences, plain and specific.'), sources: A(S('URLs taken from the input only.')) }), '4 to 6 sections.') }),
  input: (d: Disease, period: { from: string; to: string }, disclosures: unknown[], registry_changes: unknown[], upcoming: unknown[]) => ({
    indication: label(d),
    period,
    disclosures,
    registry_changes,
    upcoming_30_days: upcoming,
    task: `Write the brief on ${d.name} drug development for this period, for BD and competitive-intelligence readers: 4 to 6 short sections, most important first. Use only the items given; every section cites the source URLs of the items it uses. No speculation, no investment advice, no named individuals.`,
  }),
};
