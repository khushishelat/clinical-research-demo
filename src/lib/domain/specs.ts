// Task specs for the three research runs, the connectors each run enables,
// and the row flag rule. Ported unchanged from validation/lib/ci-spec-v2.ts,
// where they were tested against live runs (see validation/README.md).
import type { TaskAdvancedSettings, TaskSpec } from 'parallel-web/resources/task-run';

const nullableString = (description: string) => ({ type: ['string', 'null'], description });

const EVIDENCE_RULES = [
  'Independent evidence is the company itself (press releases, investor presentations, SEC filings, earnings call transcripts), its partners (including non-US exchange filings), conference abstracts, peer-reviewed publications, regulators, other national trial registries, and reputable trade or financial news.',
  'The ClinicalTrials.gov record and sites that copy it (for example trial-finder sites) are NOT evidence of anything beyond what the registry says.',
  'Report negative results as milestones too: interim analyses that did not cross an efficacy threshold, missed endpoints, futility stops and discontinuations, including when first disclosed in a company quarterly report. Every milestone must carry a date and a source URL; prefer the primary source (the company or regulator) over coverage of it. Use the input field "today" as the current date. Be strict: if no dated public source says it, report no_public_update rather than inferring. Do not report a first patient dosed unless a source says so; if it only says enrollment began or is ongoing, use "enrolling".',
].join(' ');

const MILESTONE_TYPES = [
  'trial_announced',
  'enrolling',
  'first_patient_dosed',
  'enrollment_completed',
  'interim_data',
  'topline_results',
  'results_presented',
  'results_published',
  'regulatory_filing_based_on_trial',
  'discontinued_or_terminated',
  'paused_or_on_hold',
  'timeline_changed',
  'no_public_update',
];

const CATALYST = {
  type: 'object',
  description: 'Next milestone guided publicly, with timing. All fields null if none is stated.',
  properties: {
    description: nullableString('What is expected, e.g. "Topline PFS data from the squamous cohort".'),
    timing_text: nullableString('Timing exactly as stated, e.g. "2H 2026", "by year-end", "Nov 14, 2026".'),
    earliest: nullableString('Earliest date the stated timing allows, YYYY-MM-DD (e.g. "2H 2026" -> "2026-07-01").'),
    latest: nullableString('Latest date the stated timing allows, YYYY-MM-DD (e.g. "2H 2026" -> "2026-12-31").'),
    stated_by: nullableString('Who stated it, e.g. "Summit Q2 2026 results release".'),
  },
  required: ['description', 'timing_text', 'earliest', 'latest', 'stated_by'],
  additionalProperties: false,
};

const MILESTONE = (description: string) => ({
  type: 'object',
  description,
  properties: {
    type: { type: 'string', enum: MILESTONE_TYPES, description: 'Milestone type. "no_public_update" if no dated independent source mentions this trial beyond its registry record.' },
    description: { type: 'string', description: 'One sentence describing the milestone, with its date. For no_public_update, say what was searched.' },
    date: nullableString('Date the milestone happened or was reported, YYYY-MM-DD or YYYY-MM. null for no_public_update.'),
    source_url: nullableString('URL of the source. null for no_public_update.'),
  },
  required: ['type', 'description', 'date', 'source_url'],
  additionalProperties: false,
});

export const TRIAL_CHECK_SCHEMA_V2 = {
  type: 'object',
  description: `Report what has happened with one clinical trial beyond its ClinicalTrials.gov record, for a competitive intelligence analyst. ${EVIDENCE_RULES}`,
  properties: {
    program: { type: 'string', description: 'Asset and indication this trial belongs to, e.g. "ivonescimab, 1L PD-L1+ NSCLC". Include the trial acronym if it has one.' },
    latest_milestone: MILESTONE('The most recent dated public milestone for this specific trial.'),
    earlier_milestones: {
      type: 'array',
      description: 'Up to 4 earlier dated public milestones for this trial, newest first. Empty if none.',
      items: MILESTONE('An earlier dated milestone.'),
    },
    results_publications: {
      type: 'array',
      items: { type: 'string' },
      description: 'PMIDs, DOIs or conference abstract IDs reporting results from this specific trial. Empty if none.',
    },
    next_catalyst: CATALYST,
  },
  required: ['program', 'latest_milestone', 'earlier_milestones', 'results_publications', 'next_catalyst'],
  additionalProperties: false,
} as const;

export const COMPANY_SNAPSHOT_SCHEMA_V2 = {
  type: 'object',
  description: `Build a snapshot of the company's clinical pipeline as publicly disclosed, and find partner-run trials of its assets. ${EVIDENCE_RULES}`,
  properties: {
    company: { type: 'string', description: 'Company legal name, and stock ticker and exchange if public, e.g. "Summit Therapeutics Inc. (NASDAQ: SMMT)".' },
    latest_filing: nullableString('Most recent annual or quarterly report used (10-K, 10-Q, 20-F, interim or annual report), as "form, period, filing date YYYY-MM-DD". null if not public.'),
    programs: {
      type: 'array',
      description: 'Every disclosed clinical program, one entry per asset and indication, most advanced first. At most 30. Include programs discontinued or deprioritized in the last 24 months.',
      items: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Asset name and codes, e.g. "ivonescimab (SMT112, AK112)".' },
          indication: { type: 'string', description: 'Indication and line of therapy, as the company describes it.' },
          phase: { type: 'string', description: 'Highest phase for this program, e.g. "Phase 3".' },
          status: {
            type: 'string',
            enum: ['active', 'discontinued', 'deprioritized', 'partnered_or_out_licensed', 'regulatory_submission', 'approved'],
            description: 'Current program status per the company. "approved" if approved in any major market; say where in latest_milestone.',
          },
          key_trials: { type: 'array', items: { type: 'string' }, description: 'Trial names and NCT IDs the company cites for this program, e.g. "HARMONi-3 (NCT05899608)".' },
          latest_milestone: { type: 'string', description: 'Most recent disclosed milestone for this program, one sentence.' },
          latest_milestone_date: nullableString('Date of that milestone, YYYY-MM-DD or YYYY-MM.'),
          next_catalyst: CATALYST,
          source_url: { type: 'string', description: 'URL of the source for the latest milestone.' },
        },
        required: ['asset', 'indication', 'phase', 'status', 'key_trials', 'latest_milestone', 'latest_milestone_date', 'next_catalyst', 'source_url'],
        additionalProperties: false,
      },
    },
    partnerships: {
      type: 'array',
      description: 'Licensing, co-development or clinical collaboration partnerships that cover these programs.',
      items: {
        type: 'object',
        properties: {
          partner: { type: 'string', description: 'Partner company.' },
          scope: { type: 'string', description: 'Asset, territories and rights, one sentence.' },
          source_url: { type: 'string', description: 'Source URL.' },
        },
        required: ['partner', 'scope', 'source_url'],
        additionalProperties: false,
      },
    },
    partner_run_trials: {
      type: 'array',
      description:
        'Active trials (recruiting, not yet recruiting, or active not recruiting) of the company\'s assets that are sponsored by ANOTHER company and do not list this company as sponsor or collaborator. Find them by searching ClinicalTrials.gov by each asset name and code. At most 40, Phase 3 first.',
      items: {
        type: 'object',
        properties: {
          nct_id: { type: 'string', description: 'NCT ID.' },
          asset: { type: 'string', description: 'The company asset studied.' },
          lead_sponsor: { type: 'string', description: 'Lead sponsor as listed on ClinicalTrials.gov.' },
          phase: { type: 'string', description: 'Phase as listed.' },
          status: { type: 'string', description: 'Overall status as listed.' },
        },
        required: ['nct_id', 'asset', 'lead_sponsor', 'phase', 'status'],
        additionalProperties: false,
      },
    },
  },
  required: ['company', 'latest_filing', 'programs', 'partnerships', 'partner_run_trials'],
  additionalProperties: false,
} as const;

export const MECHANISM_SCHEMA = {
  type: 'object',
  description:
    "Describe the mechanism of the input lead_asset (if lead_asset is empty, the company's most advanced unapproved clinical asset) and list other clinical-stage or approved assets that compete on mechanism, for a competitive intelligence analyst. Competitors act on the same primary target or target pair in the same direction (for example other PD-(L)1 x VEGF bispecifics; other estrogen receptor degraders, including oral SERDs and PROTACs; other BCMA-directed CAR-T cells), whatever their modality. Use ChEMBL for targets, mechanism of action and molecules acting on the same targets; use ClinicalTrials.gov to confirm each competitor's clinical stage; use company sources for owners and partnerships. Do not include the company's own asset. Every competitor needs a source URL.",
  properties: {
    lead_asset: { type: 'string', description: 'The asset described, with codes, e.g. "ivonescimab (SMT112, AK112)". Use the input lead_asset when given.' },
    modality: { type: 'string', description: 'e.g. "bispecific antibody", "small molecule", "CAR-T", "PROTAC degrader".' },
    mechanism_of_action: { type: 'string', description: 'One sentence, e.g. "Binds PD-1 and VEGF-A".' },
    chembl_molecule_id: nullableString('ChEMBL molecule ID, e.g. "CHEMBL4297842". null if not in ChEMBL.'),
    targets: {
      type: 'array',
      description: 'Molecular targets.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Target name, e.g. "Programmed cell death protein 1".' },
          gene_symbol: nullableString('Gene symbol, e.g. "PDCD1".'),
          chembl_target_id: nullableString('ChEMBL target ID, e.g. "CHEMBL3307223".'),
        },
        required: ['name', 'gene_symbol', 'chembl_target_id'],
        additionalProperties: false,
      },
    },
    competitors: {
      type: 'array',
      description: 'Up to 8 competing assets on the same target and direction of action, most advanced first. Approved products count.',
      items: {
        type: 'object',
        properties: {
          asset: { type: 'string', description: 'Asset name and codes.' },
          company: { type: 'string', description: 'Owner, and licensor or partner if any.' },
          mechanism: { type: 'string', description: 'Its targets or mechanism, e.g. "PD-L1 x VEGF-A bispecific".' },
          highest_phase: { type: 'string', description: 'Highest clinical phase, e.g. "Phase 3".' },
          example_nct_ids: { type: 'array', items: { type: 'string' }, description: 'Up to 3 NCT IDs of its trials.' },
          source_url: { type: 'string', description: 'Source for owner and stage.' },
        },
        required: ['asset', 'company', 'mechanism', 'highest_phase', 'example_nct_ids', 'source_url'],
        additionalProperties: false,
      },
    },
  },
  required: ['lead_asset', 'modality', 'mechanism_of_action', 'chembl_molecule_id', 'targets', 'competitors'],
  additionalProperties: false,
} as const;

const spec = (schema: unknown): TaskSpec => ({ output_schema: { type: 'json', json_schema: schema as Record<string, unknown> } });
export const TRIAL_CHECK_SPEC_V2 = spec(TRIAL_CHECK_SCHEMA_V2);
export const COMPANY_SNAPSHOT_SPEC_V2 = spec(COMPANY_SNAPSHOT_SCHEMA_V2);
export const MECHANISM_SPEC = spec(MECHANISM_SCHEMA);

export const TRIAL_CONNECTORS = ['clinical_trials', 'pubmed', 'biorxiv'] as const;
export const SNAPSHOT_CONNECTORS = ['clinical_trials', 'pubmed'] as const;
export const MECHANISM_CONNECTORS = ['chembl', 'clinical_trials', 'pubmed'] as const;

const ACTIVE = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION', 'ACTIVE_NOT_RECRUITING', 'SUSPENDED']);
const ENROLLING = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION']);

/**
 * The row flag compares public milestones with the registry status field.
 * All milestones count, not just the latest: newer news (for example an
 * interim readout) must not hide that enrollment already completed while the
 * registry still says enrolling. Priority: conflict > registry_lagging > news.
 */
export function flagFor(
  type: string | undefined,
  registryStatus: string,
  earlierTypes: readonly (string | undefined)[] = []
): 'conflict' | 'registry_lagging' | 'news' | 'no_news' {
  const all = [type, ...earlierTypes].filter((t): t is string => Boolean(t) && t !== 'no_public_update');
  if (all.length === 0) return 'no_news';
  if (type && ['discontinued_or_terminated', 'paused_or_on_hold'].includes(type) && ACTIVE.has(registryStatus)) return 'conflict';
  if (all.includes('enrollment_completed') && ENROLLING.has(registryStatus)) return 'registry_lagging';
  return 'news';
}

// parallel-web 1.1.0 through 1.3.3 do not type advanced_settings.data_sources,
// which the API accepts. The intersection keeps `location` so the type is not
// a "weak type" mismatch.
export type AdvancedSettingsWithConnectors = TaskAdvancedSettings & {
  data_sources: { free?: string[]; pay_per_use?: string[] };
};

/** Published processor prices, USD per run (docs.parallel.ai/getting-started/pricing). */
export const PRICE_USD = { pro: 0.1, ultra: 0.3 } as const;
export const TRIAL_PROCESSOR = 'pro';
export const SNAPSHOT_PROCESSOR = 'ultra';
export const MECHANISM_PROCESSOR = 'pro';

/** Cost shown before a run: trials x $0.10 plus the snapshot and mechanism runs. */
export function estimateCostUsd(trials: number): number {
  return Math.round((trials * PRICE_USD.pro + PRICE_USD.ultra + PRICE_USD.pro) * 100) / 100;
}
