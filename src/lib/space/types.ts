// The documents a disease's pipeline writes (scripts/) and the app reads.
// One definition for both sides. Professional facts only: no document holds
// phone numbers, emails, street addresses or site contacts.

/** spaces/<disease>/trials.json: ClinicalTrials.gov, one active drug trial each. */
export type Person = { name: string; key: string; role: 'principal_investigator' | 'study_chair'; affiliation?: string; facility?: string; city?: string; state?: string; country?: string };
export type Trial = {
  nct: string;
  title: string;
  acronym: string;
  status: string;
  phases: string[];
  phase_level: number;
  conditions: string[];
  sponsor: string;
  sponsor_class: string;
  run_by: 'company' | 'investigator';
  collaborators: string[];
  interventions: { name: string; type: string; other_names: string[] }[];
  /** Arms with their type (EXPERIMENTAL, ACTIVE_COMPARATOR, PLACEBO_COMPARATOR…) and intervention names. */
  arms: { type: string; label?: string; interventions: string[] }[];
  /** Allocation (RANDOMIZED, NON_RANDOMIZED, NA) and masking (NONE … QUADRUPLE). */
  design?: { allocation: string | null; masking: string | null };
  primary_outcomes?: { measure: string; time_frame: string }[];
  first_posted: string;
  last_update: string;
  start: string;
  primary_completion: string;
  enrollment: number | null;
  n_sites: number;
  countries: string[];
  people: Person[];
};

/** spaces/<disease>/companies.json: who owns each drug, joined to its trials in code. */
export type Drug = {
  name: string;
  codes: string[];
  mechanism: string;
  mechanism_source: string;
  chembl_id: string | null;
  /** Display phase ("Phase 3", "Approved"), derived from `phase` for v1 records. */
  highest_phase: string;
  /** v1: PHASES enum value. */
  phase?: string;
  phase_note?: string | null;
  modality?: string;
  targets?: string[];
  rights?: { holder: string; territory: string }[];
  /** v0 only. */
  rights_holder?: string | null;
};
export type Company = {
  key: string;
  name: string;
  relationship: string;
  owner_source: string | null;
  acquisitions: { sponsor: string; announced: string | null; closed: string | null; value: string | null; source: string }[];
  registry_sponsors: string[];
  drugs: Drug[];
  trials: string[];
  investigator_trials: string[];
  web: { country: string; source: string } | null;
  web_only: boolean;
  approved: boolean;
  max_phase: number;
};
export type CompanyReview = { company: string; include: boolean | null };

/** spaces/<disease>/facts.json: one Task run (FACTS, pro) per company, plus READOUT runs (core) per trial. */
export type Milestone = { date: string; type: string; drug: string; nct?: string | null; headline: string; source_url: string | null };
/** `about` (deals@2): what the deal is for; only asset and company_for_asset deals count toward the headline value. */
export type Deal = { date: string | null; parties: string[]; drugs?: string[]; type: string; about?: string; upfront: string | null; total: string | null; currency?: string | null; upfront_m?: number | null; total_m?: number | null; headline: string; source_url: string | null };
export type Financing = { date: string | null; kind: string; amount: string | null; currency: string | null; amount_m: number | null; headline: string; source_url: string | null };
export type Approval = { drug: string; region: string; date: string | null; indication: string; source_url: string | null };
export type Regulatory = { drug: string; kind: string; agency: string; status: 'done' | 'expected'; date: string | null; window: string | null; source_url: string | null };
export type NextStep = { what: string; kind?: string; drug?: string; nct?: string | null; stated_on?: string | null; earliest: string | null; latest: string | null; timing_text: string | null; stated_by: string | null; source_url: string | null };
export type Readout = { nct: string; has_data: boolean; date: string | null; analysis: string | null; endpoint: string | null; arms: { arm: string; result: string }[]; n: number | null; p_value: string | null; source_url: string | null; _run?: string };
export type Facts = {
  lead_assets?: string[];
  furthest_along?: { drug: string | null; phase: string | null; where: string | null; note?: string | null } | null;
  approvals?: Approval[];
  regulatory?: Regulatory[];
  deals?: Deal[];
  financings?: Financing[];
  milestones?: Milestone[];
  next?: NextStep[];
  pivotal?: { nct: string | null; comparator: string; comparator_name: string | null }[];
  how_given?: { route: string | null; frequency: string | null } | null;
  /** READOUT runs for this company's trials that have reported data. */
  readouts?: Readout[];
  _spec?: string;
  _run?: string;
  _connectors?: Record<string, number>;
  _seconds?: number | null;
};

/** spaces/<disease>/basis/<company>.json: the run's per-field citations. */
export type Basis = { field: string; citations: { title?: string | null; url: string; excerpts?: string[] | null }[]; reasoning: string; confidence: string | null };

/** spaces/<disease>/clinicians.json */
export type Role = { nct: string; role: string; sponsor: string; company: string | null; facility: string | null; city: string | null; state: string | null; country: string | null };
export type WebRole = { role: string; program: string; nct?: string | null; company: string; date: string | null; source_url: string };
export type Clinician = {
  key: string;
  /** Other registry keys merged into this person (an overall official listed without a site). */
  aliases: string[];
  name: string;
  first: string;
  last: string;
  us: boolean;
  country: string | null;
  city: string | null;
  state: string | null;
  facilities: string[];
  roles: Role[];
  web_roles: WebRole[];
  npi: { number: string; taxonomy: string; city: string; state: string; how: 'npi_api' | 'npi_api_specialty' | 'connector' } | null;
  npi_status: 'matched' | 'ambiguous' | 'none' | 'not_us';
  pubmed: { count: number; since_2024: number; recent: { pmid: string; title: string; year: string }[]; verified: boolean; how: 'affiliation' | 'connector' | 'unverified' } | null;
  profile: { specialty: string | null; institution: string | null; research_focus: string | null; other_trial_roles: { nct: string; condition: string; role: string }[] } | null;
  sources: string[];
  score: number;
};

/** spaces/<disease>/events.json */
export type SpaceEvent = { id: string; date: string; company: string; drug: string | null; type: string; headline: string; source_url: string | null; nct?: string; origin: 'web' | 'registry' | 'monitor'; /** Monitor news: the monitors (keys in monitor.json) that found it, and when this app first read it. */ found_by?: string[]; detected?: string; /** Registry changes: what changed, on its own ('Stopped recruiting'). */ change?: string };
export type Catalyst = NextStep & { id: string; company: string; date?: string | null };
export type EventsDoc = { events: SpaceEvent[]; catalysts: Catalyst[]; monthly: Record<string, { all: number; companies: number }> };

/** spaces/<disease>/first-seen.json: when a trial was first announced, against its registry date. */
export type FirstSeen = { first_announced: string | null; source_url: string | null; what: string | null; how_it_refers?: 'by_name' | 'by_description'; plan_announced?: string | null; registry_first_posted: string; days_earlier: number };

/** spaces/<disease>/coverage.json: Medicare coverage (CMS Coverage connector). */
export type Coverage = { drug: string; policy: string; id: string; type: string; effective_date: string | null; summary: string; source_url: string };

/** spaces/<disease>/briefs/<date>.json */
/** brief@1: sections from the given items. brief@2: a deep-research run's markdown with [n] citations and its references. */
export type Brief = { disease: string; date: string; from: string; title: string; sections?: { heading: string; body: string; sources: string[] }[]; markdown?: string; references?: { n: number; title: string; url: string }[]; run_id: string; spec?: string; seconds?: number | null; connectors?: Record<string, number> };
