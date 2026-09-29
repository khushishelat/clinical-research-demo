// Shapes of the recorded research packs (fixtures/recorded/<key>.json) and of
// what the app derives from them. Model-written fields stay loosely typed;
// everything the app computes is typed exactly.

export type RunBy = 'company_led' | 'partner_led' | 'investigator_led';
export type Flag = 'conflict' | 'registry_lagging' | 'news' | 'no_news';

export type Citation = { url: string; title: string | null };
export type BasisEntry = { field: string; confidence: string | null; citations: Citation[] };

export type Milestone = {
  type: string;
  description: string;
  date: string | null;
  source_url: string | null;
};

export type Catalyst = {
  description: string | null;
  timing_text: string | null;
  earliest: string | null;
  latest: string | null;
  stated_by: string | null;
};

export type ConnectorLogEntry = { connector: string; tool: string; arguments: string; error: string | null; output_chars: number };

export type RegistryRecord = {
  via: string;
  url: string | null;
  title: string | null;
  acronym: string | null;
  enrollment: number | null;
  start_date: string | null;
  primary_completion_date: string | null;
  completion_date: string | null;
  interventions: string[];
  primary_outcomes: string[];
  secondary_outcome_count: number;
  has_results: boolean | null;
  sites: number;
  countries: string[];
  site_status: Record<string, number>;
};

export type HandCheck = {
  company: string;
  claim: string;
  nct_id?: string;
  verdict: 'confirmed' | 'partly' | 'unverified' | 'wrong';
  checked: string;
  source: string;
  note?: string;
};

export type TrialCheck = {
  status: string;
  seconds: number | null;
  program: string | null;
  latest_milestone: Milestone | null;
  earlier_milestones: Milestone[];
  results_publications: string[];
  next_catalyst: Catalyst | null;
  flag: Flag;
  connector_calls: Record<string, number>;
  citations: number;
  basis: BasisEntry[];
  registry_record: RegistryRecord | null;
  connector_log: ConnectorLogEntry[];
  live: { events: number; sources_considered: number | null; sources_read: number | null } | null;
  hand_checked?: HandCheck[];
  /** Set when a Monitor event triggered this check between weekly re-runs. */
  updated_by?: { source: 'monitor'; event_id: string; date: string; summary: string };
};

export type TrialRow = {
  nct_id: string;
  title: string;
  role: RunBy;
  lead_sponsor: string;
  collaborators: string[];
  interventions: string[];
  condition: string;
  phases: string[];
  status: string;
  last_update_posted: string;
  primary_completion_date: string;
  check: TrialCheck | null;
};

export type Program = {
  asset: string;
  indication: string;
  phase: string;
  status: 'active' | 'discontinued' | 'deprioritized' | 'partnered_or_out_licensed' | 'regulatory_submission' | 'approved';
  key_trials: string[];
  latest_milestone: string;
  latest_milestone_date: string | null;
  next_catalyst: Catalyst | null;
  source_url: string;
};

export type Snapshot = {
  company: string;
  latest_filing: string | null;
  programs: Program[];
  partnerships: { partner: string; scope: string; source_url?: string }[];
  partner_run_trials: { nct_id: string; asset: string; lead_sponsor: string; phase: string; status: string }[];
};

export type Mechanism = {
  lead_asset: string;
  modality: string;
  mechanism_of_action: string;
  chembl_molecule_id: string | null;
  targets: { name: string; gene_symbol: string | null; chembl_target_id: string | null }[];
  competitors: { asset: string; company: string; mechanism: string; highest_phase: string; example_nct_ids: string[]; source_url: string; from_run?: string }[];
  competitors_merged_from?: string[];
};

export type RegistryLookup = {
  lead_sponsor: string;
  lead_sponsor_class: string;
  collaborators: string[];
  status: string;
  phase: string;
  acronym: string | null;
  title: string;
  interventions: string;
};

export type FoundTrial = { nct_id: string; found_by: string; registry: RegistryLookup | null; check?: TrialCheck | null };

export type Pack = {
  about: { company: string; recorded: string; taskgroup_id: string; note: string };
  totals: Record<string, unknown> & { flags: Partial<Record<Flag, number>> };
  snapshot: Snapshot | null;
  snapshot_basis?: BasisEntry[];
  snapshot_connector_log?: ConnectorLogEntry[];
  snapshot_live?: { events: number; sources_considered: number | null; sources_read: number | null } | null;
  mechanism: Mechanism | null;
  mechanism_basis?: BasisEntry[];
  mechanism_connector_log?: ConnectorLogEntry[];
  found_beyond_registry_search: FoundTrial[];
  found_beyond_excluded?: (FoundTrial & { reasons: string[] })[];
  rows: TrialRow[];
  review?: HandCheck[];
};

/** A recorded company the app knows about (data/companies.json). */
export type CompanyConfig = {
  key: string;
  name: string;
  /** Lower-case token that identifies the company as lead sponsor. */
  match: string;
  aliases: string[];
  /** ClinicalTrials.gov filter.advanced applied to stage 1, e.g. Phase 3 only. */
  advanced?: string;
  scope_label?: string;
  /** Lead asset passed to the mechanism run. */
  lead_asset: string;
};
