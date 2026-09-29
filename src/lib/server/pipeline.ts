// Server-only. The research pipeline as a resumable state machine, shared by
// the weekly refresh (Job 1) and public research requests (Job 3). Each call
// to advance() does at most one step and never blocks on a run, so it fits
// in one serverless invocation; the caller persists the state after each step.
//
//   pending ──► created ──► submitted ──► finalized
//      │           │            │
//      └───────────┴────────────┴──► failed / queued (over budget)
//
// - pending:   stage 1 live, budget reserved, group created. The group ID is
//              saved (via `save`) BEFORE any run is added.
// - created:   runs added with retries off. On any failure the next call
//              lists the group's runs and adds only what is missing.
// - submitted: once the snapshot run finishes, its found-by-research trials
//              are confirmed against the registry and their checks are added
//              to the same group (once). When the group is idle, the pack is
//              built and written: dated, then latest.

import type Parallel from 'parallel-web';
import { buildPack, foundTrials } from '../domain/join';
import { PRICE_USD } from '../domain/specs';
import type { CompanyConfig, Pack, RegistryLookup, TrialRow } from '../domain/types';
import type { Context } from './context';
import { loadPack } from './context';
import { reserveBudget, today } from './guards';
import { addMissingRuns, buildRunInputs, collectResults, type RunMeta } from './runs';
import { paths } from './store';

export type Phase = 'pending' | 'created' | 'submitted' | 'finalized' | 'failed' | 'queued';
export type Bucket = 'refresh' | 'research';

export type JobState = {
  key: string;
  company: CompanyConfig;
  bucket: Bucket;
  phase: Phase;
  taskgroup_id: string | null;
  stage1: Omit<TrialRow, 'check'>[] | null;
  /** Found trials whose checks are in the group (carried over, then added after the snapshot). */
  found: Record<string, RegistryLookup>;
  extended: boolean;
  estimated_cost_usd: number;
  actual_cost_usd: number | null;
  runs: { added: number; completed: number; failed: number };
  started_at: string;
  updated_at: string;
  finalized_at?: string;
  error?: string;
  /** Only these stage 1 trials are checked (narrowing, section 7). Others still list, unchecked. */
  only_nct_ids?: string[];
};

export type StepResult = { state: JobState; status: 'advanced' | 'waiting' | 'finalized' | 'failed' | 'queued' | 'idle'; detail?: string };

export function newJob(company: CompanyConfig, bucket: Bucket, now: Date, only_nct_ids?: string[]): JobState {
  const at = now.toISOString();
  return {
    key: company.key,
    company,
    bucket,
    phase: 'pending',
    taskgroup_id: null,
    stage1: null,
    found: {},
    extended: false,
    estimated_cost_usd: 0,
    actual_cost_usd: null,
    runs: { added: 0, completed: 0, failed: 0 },
    started_at: at,
    updated_at: at,
    ...(only_nct_ids?.length ? { only_nct_ids } : {}),
  };
}

const capFor = (c: Context, bucket: Bucket) => (bucket === 'refresh' ? c.settings.budgets.refresh : c.settings.budgets.research);
const tagFor = (s: JobState) => ({ app: 'trial-check', job: s.bucket });

function checkedRows(s: JobState) {
  const rows = s.stage1 ?? [];
  return s.only_nct_ids ? rows.filter((r) => s.only_nct_ids!.includes(r.nct_id)) : rows;
}

function inputsFor(s: JobState, now: Date) {
  return buildRunInputs({ company: s.company, today: today(now), stage1: checkedRows(s), found: s.found, tag: tagFor(s) });
}

/**
 * Advances a job by one step. `save` must persist the state durably; it is
 * called before any irreversible call (group creation, adding runs) so a
 * crash mid-step never loses a group or re-bills runs.
 */
export async function advance(s: JobState, c: Context, save: (s: JobState) => Promise<void>): Promise<StepResult> {
  const client = c.parallel;
  if (!client) return { state: s, status: 'failed', detail: 'Live research is off (DEMO_MODE=fixture).' };
  const now = c.now();
  const touch = (patch: Partial<JobState>) => Object.assign(s, patch, { updated_at: now.toISOString() });

  try {
    if (s.phase === 'pending' || s.phase === 'queued') return await start(s, c, client, save, touch, now);
    if (s.phase === 'created') {
      const { inputs } = inputsFor(s, now);
      const { added, present } = await addMissingRuns(client, s.taskgroup_id!, inputs);
      touch({ phase: 'submitted', runs: { ...s.runs, added: added + present } });
      await save(s);
      return { state: s, status: 'advanced', detail: `${added} runs added` };
    }
    if (s.phase === 'submitted') return await poll(s, c, client, save, touch, now);
    return { state: s, status: 'idle' };
  } catch (error) {
    // Transient API or registry errors leave the phase as is; the next call retries it.
    touch({ error: String((error as Error).message ?? error).slice(0, 300) });
    await save(s);
    return { state: s, status: 'waiting', detail: s.error };
  }
}

type Touch = (patch: Partial<JobState>) => void;

async function start(s: JobState, c: Context, client: Parallel, save: (s: JobState) => Promise<void>, touch: Touch, now: Date): Promise<StepResult> {
  const stage1 = s.stage1 ?? (await c.registry.companyTrials(s.company));
  const previous = s.bucket === 'refresh' ? (await loadPack(s.key, c))?.pack ?? null : null;
  // Carry the previous pack's found trials so the weekly re-run checks them
  // without waiting for the snapshot.
  const carried = previous?.found_beyond_registry_search.map((f) => f.nct_id) ?? [];
  const found = carried.length ? await c.registry.lookup(carried) : {};
  touch({ stage1, found });
  const { estimatedCostUsd } = inputsFor(s, now);
  if (s.bucket === 'research' && estimatedCostUsd > c.settings.maxRunCostUsd) {
    touch({ phase: 'failed', error: `Too many trials to check in one run (${checkedRows(s).length}). Narrow first.`, estimated_cost_usd: estimatedCostUsd });
    await save(s);
    return { state: s, status: 'failed', detail: s.error };
  }
  if (!(await reserveBudget(c.kv, s.bucket, estimatedCostUsd, capFor(c, s.bucket), now))) {
    touch({ phase: 'queued', estimated_cost_usd: estimatedCostUsd, error: 'Daily research budget reached; queued for tomorrow.' });
    await save(s);
    return { state: s, status: 'queued', detail: s.error };
  }
  const group = await client.taskGroup.create({ metadata: { ...tagFor(s), company: s.key } });
  touch({ phase: 'created', taskgroup_id: group.taskgroup_id, estimated_cost_usd: estimatedCostUsd, error: undefined });
  await save(s);
  const { inputs } = inputsFor(s, now);
  const { added, present } = await addMissingRuns(client, group.taskgroup_id, inputs);
  touch({ phase: 'submitted', runs: { ...s.runs, added: added + present } });
  await save(s);
  return { state: s, status: 'advanced', detail: `group ${group.taskgroup_id}: ${added} runs added` };
}

/** Status of the snapshot run, without reading every output. */
async function snapshotRun(client: Parallel, gid: string): Promise<{ run_id: string; status: string; is_active: boolean } | null> {
  for await (const e of await client.taskGroup.getRuns(gid, { include_output: false })) {
    if (e.type === 'task_run.state' && (e.run.metadata as Partial<RunMeta> | null)?.kind === 'snapshot') return e.run;
  }
  return null;
}

async function poll(s: JobState, c: Context, client: Parallel, save: (s: JobState) => Promise<void>, touch: Touch, now: Date): Promise<StepResult> {
  const gid = s.taskgroup_id!;
  if (!s.extended) {
    const snap = await snapshotRun(client, gid);
    if (snap && !snap.is_active) {
      let added = 0;
      if (snap.status === 'completed') {
        const result = await client.taskRun.result(snap.run_id, { timeout: 30 });
        const stage1Ids = new Set((s.stage1 ?? []).map((r) => r.nct_id));
        const { kept } = await foundTrials(s.company, (result.output as any)?.content ?? null, stage1Ids, (ids) => c.registry.lookup(ids), Object.keys(s.found));
        const fresh = kept.filter((f) => !s.found[f.nct_id] && f.registry);
        const extraCost = fresh.length * PRICE_USD.pro;
        if (fresh.length && (await reserveBudget(c.kv, s.bucket, extraCost, capFor(c, s.bucket), now))) {
          const found = { ...s.found, ...Object.fromEntries(fresh.map((f) => [f.nct_id, f.registry!])) };
          touch({ found, estimated_cost_usd: Math.round((s.estimated_cost_usd + extraCost) * 100) / 100 });
          await save(s);
          const { inputs } = inputsFor(s, now);
          const res = await addMissingRuns(client, gid, inputs);
          added = res.added;
          touch({ runs: { ...s.runs, added: res.added + res.present } });
        }
      }
      touch({ extended: true });
      await save(s);
      if (added) return { state: s, status: 'advanced', detail: `${added} found-trial checks added` };
    }
  }

  const group = await client.taskGroup.retrieve(gid);
  if (group.status.is_active || !s.extended) {
    const counts = group.status.task_run_status_counts ?? {};
    touch({ runs: { ...s.runs, completed: counts.completed ?? 0, failed: (counts.failed ?? 0) + (counts.cancelled ?? 0) } });
    await save(s);
    return { state: s, status: 'waiting', detail: group.status.status_message ?? undefined };
  }
  return finalize(s, c, client, save, touch, now);
}

async function finalize(s: JobState, c: Context, client: Parallel, save: (s: JobState) => Promise<void>, touch: Touch, now: Date): Promise<StepResult> {
  const gid = s.taskgroup_id!;
  const results = await collectResults(client, gid);
  const previous = (await loadPack(s.key, c))?.pack ?? null;
  const date = today(now);
  const stage1 = s.stage1 ?? [];
  const pack: Pack = await buildPack({
    company: s.company,
    recorded: date,
    taskgroup_id: gid,
    stage1,
    snapshot: results.snapshot,
    mechanism: results.mechanism,
    trials: results.trials,
    found: results.found,
    lookup: (ids) => c.registry.lookup(ids),
    previous,
    extraClaimed: Object.keys(s.found),
  });
  const actual = actualCost(results);
  pack.about.note = `${s.bucket === 'refresh' ? 'Weekly re-run' : 'Research run'} on public data. Model output unless hand-checked. Not investment advice.`;
  await c.store.put(paths.datedPack(s.key, date), pack);
  await c.store.put(paths.latestPack(s.key), pack);
  touch({
    phase: 'finalized',
    finalized_at: now.toISOString(),
    actual_cost_usd: actual,
    runs: { added: s.runs.added, completed: results.completed, failed: results.failed },
    error: undefined,
  });
  await save(s);
  return { state: s, status: 'finalized', detail: `${results.completed} runs · $${actual.toFixed(2)}` };
}

function actualCost(results: Awaited<ReturnType<typeof collectResults>>): number {
  const runs = [results.snapshot, results.mechanism, ...Object.values(results.trials), ...Object.values(results.found)].filter(Boolean);
  const usd = runs.reduce((sum, r: any) => (r.run?.status === 'completed' ? sum + (PRICE_USD[r.run.processor as keyof typeof PRICE_USD] ?? 0) : sum), 0);
  return Math.round(usd * 100) / 100;
}

