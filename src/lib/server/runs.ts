// Server-only. The Task Group mechanics shared by the weekly refresh and
// public research. Proven in validation/lib/group-runner.ts:
// - add runs with retries off; on any failure, list the group's runs and add
//   only what is missing (never resend: a lost response can still have
//   created runs, and completed duplicates are billed)
// - map results by run metadata, not by position

import type Parallel from 'parallel-web';
import type { RunInput } from 'parallel-web/resources/task-run';
import {
  COMPANY_SNAPSHOT_SPEC_V2,
  MECHANISM_CONNECTORS,
  MECHANISM_PROCESSOR,
  MECHANISM_SPEC,
  SNAPSHOT_CONNECTORS,
  SNAPSHOT_PROCESSOR,
  TRIAL_CHECK_SPEC_V2,
  TRIAL_CONNECTORS,
  TRIAL_PROCESSOR,
  estimateCostUsd,
  type AdvancedSettingsWithConnectors,
} from '../domain/specs';
import type { CompanyConfig, RegistryLookup, TrialRow } from '../domain/types';

type Input = Omit<RunInput, 'advanced_settings'> & { advanced_settings: AdvancedSettingsWithConnectors };
export type RunMeta = { company: string; kind: 'snapshot' | 'mechanism' | 'trial_check' | 'found_check'; nct_id?: string };
const connectors = (free: readonly string[]) => ({ data_sources: { free: [...free] } });
const metaKey = (m: Partial<RunMeta>) => `${m.kind}:${m.nct_id ?? ''}`;

export function trialInput(company: CompanyConfig, today: string, row: Omit<TrialRow, 'check'>) {
  return {
    company: company.name,
    today,
    nct_id: row.nct_id,
    title: row.title,
    sponsor_role: row.role,
    lead_sponsor: row.lead_sponsor,
    interventions: row.interventions.slice(0, 5).join('; '),
    condition: row.condition,
    phase: row.phases.join('/'),
    registry_status: row.status,
    registry_last_update_posted: row.last_update_posted,
    registry_primary_completion_date: row.primary_completion_date,
  };
}

export function buildRunInputs(opts: {
  company: CompanyConfig;
  today: string;
  stage1: Omit<TrialRow, 'check'>[];
  found?: Record<string, RegistryLookup>;
  tag: Record<string, string>;
}): { inputs: Input[]; estimatedCostUsd: number } {
  const { company, today, tag } = opts;
  const meta = (m: RunMeta) => ({ ...tag, ...m });
  const inputs: Input[] = [
    {
      processor: SNAPSHOT_PROCESSOR,
      input: { company: company.name, today },
      task_spec: COMPANY_SNAPSHOT_SPEC_V2,
      metadata: meta({ company: company.key, kind: 'snapshot' }),
      advanced_settings: connectors(SNAPSHOT_CONNECTORS),
    },
    {
      processor: MECHANISM_PROCESSOR,
      input: { company: company.name, today, lead_asset: company.lead_asset },
      task_spec: MECHANISM_SPEC,
      metadata: meta({ company: company.key, kind: 'mechanism' }),
      advanced_settings: connectors(MECHANISM_CONNECTORS),
    },
    ...opts.stage1.map((row) => ({
      processor: TRIAL_PROCESSOR,
      input: trialInput(company, today, row),
      task_spec: TRIAL_CHECK_SPEC_V2,
      metadata: meta({ company: company.key, kind: 'trial_check', nct_id: row.nct_id }),
      advanced_settings: connectors(TRIAL_CONNECTORS),
    })),
    ...Object.entries(opts.found ?? {}).map(([nct, r]) => ({
      processor: TRIAL_PROCESSOR,
      input: {
        company: company.name,
        today,
        nct_id: nct,
        title: r.title,
        sponsor_role: 'partner_led',
        lead_sponsor: r.lead_sponsor,
        interventions: r.interventions.slice(0, 300),
        phase: r.phase,
        registry_status: r.status,
      },
      task_spec: TRIAL_CHECK_SPEC_V2,
      metadata: meta({ company: company.key, kind: 'found_check', nct_id: nct }),
      advanced_settings: connectors(TRIAL_CONNECTORS),
    })),
  ];
  return { inputs, estimatedCostUsd: estimateCostUsd(opts.stage1.length + Object.keys(opts.found ?? {}).length) };
}

async function existingKeys(client: Parallel, gid: string): Promise<Set<string>> {
  const keys = new Set<string>();
  for await (const e of await client.taskGroup.getRuns(gid, { include_output: false })) {
    if (e.type === 'task_run.state') keys.add(metaKey((e.run.metadata ?? {}) as Partial<RunMeta>));
  }
  return keys;
}

/** Adds only the inputs whose metadata is not already in the group. Safe to repeat. */
export async function addMissingRuns(client: Parallel, gid: string, inputs: Input[]): Promise<{ added: number; present: number }> {
  const present = await existingKeys(client, gid);
  const missing = inputs.filter((i) => !present.has(metaKey(i.metadata as Partial<RunMeta>)));
  for (let i = 0; i < missing.length; i += 500) {
    await client.taskGroup.addRuns(gid, { inputs: missing.slice(i, i + 500) as RunInput[] }, { maxRetries: 0 });
  }
  return { added: missing.length, present: present.size };
}

export type Collected = {
  snapshot: any;
  mechanism: any;
  trials: Record<string, any>;
  found: Record<string, any>;
  completed: number;
  failed: number;
};

/** Reads every finished run in a group, with output, keyed by metadata. */
export async function collectResults(client: Parallel, gid: string): Promise<Collected> {
  const out: Collected = { snapshot: null, mechanism: null, trials: {}, found: {}, completed: 0, failed: 0 };
  for await (const e of await client.taskGroup.getRuns(gid, { include_output: true })) {
    if (e.type !== 'task_run.state') continue;
    const m = (e.run.metadata ?? {}) as Partial<RunMeta>;
    if (e.run.status === 'completed') out.completed += 1;
    else if (!e.run.is_active) out.failed += 1;
    const raw = { run: e.run, output: e.output ?? null };
    if (m.kind === 'snapshot') out.snapshot = raw;
    else if (m.kind === 'mechanism') out.mechanism = raw;
    else if (m.kind === 'trial_check' && m.nct_id) out.trials[m.nct_id] = raw;
    else if (m.kind === 'found_check' && m.nct_id) out.found[m.nct_id] = raw;
  }
  return out;
}
