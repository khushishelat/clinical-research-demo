// Test helpers: recorded packs, a test context, and a fake Parallel client
// that models Task Groups closely enough to exercise the state machines
// (partial accepts, metadata-keyed runs, results by run ID).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Parallel from 'parallel-web';
import type { Context, RegistrySource } from '../src/lib/server/context';
import { memoryKv } from '../src/lib/server/kv';
import { serverSettings } from '../src/lib/server/settings';
import { memoryStore } from '../src/lib/server/store';
import type { CompanyConfig, Pack, RegistryLookup } from '../src/lib/domain/types';

export const root = join(import.meta.dirname, '..');
export const pack = (key: string): Pack => JSON.parse(readFileSync(join(root, 'fixtures/recorded', `${key}.json`), 'utf8'));
export const companies: CompanyConfig[] = JSON.parse(readFileSync(join(root, 'data/companies.json'), 'utf8'));
export const company = (key: string) => companies.find((c) => c.key === key)!;

/** Registry records as recorded: stage 1 from the pack's rows, lookups from its found trials. */
export function recordedRegistry(key: string, overrides: Record<string, string> = {}): RegistrySource {
  const p = pack(key);
  return {
    async companyTrials() {
      return p.rows.map(({ check: _c, ...row }) => ({ ...row, status: overrides[row.nct_id] ?? row.status }));
    },
    async lookup(ids) {
      const out: Record<string, RegistryLookup> = {};
      for (const f of p.found_beyond_registry_search) if (ids.includes(f.nct_id) && f.registry) out[f.nct_id] = f.registry;
      for (const r of p.rows) if (ids.includes(r.nct_id)) out[r.nct_id] = { lead_sponsor: r.lead_sponsor, lead_sponsor_class: 'INDUSTRY', collaborators: r.collaborators, status: overrides[r.nct_id] ?? r.status, phase: r.phases.join('/'), acronym: null, title: r.title, interventions: r.interventions.join(' | ') };
      return out;
    },
  };
}

export function testContext(partial: Partial<Context> = {}): Context {
  return {
    settings: serverSettings({ DEMO_MODE: 'fixture', PARALLEL_WEBHOOK_SECRET: WEBHOOK_SECRET, CRON_SECRET: 'cron-test' } as unknown as NodeJS.ProcessEnv),
    store: memoryStore(),
    kv: memoryKv(),
    registry: recordedRegistry('summit'),
    parallel: null,
    responses: null,
    monitors: {},
    companies,
    now: () => new Date('2026-10-05T12:00:00Z'),
    ...partial,
  };
}

export const WEBHOOK_SECRET = 'whsec_' + Buffer.from('trial-check-test-secret-0123456789').toString('base64');

async function* iter<T>(items: T[]) {
  for (const i of items) yield i;
}

type FakeRun = { run_id: string; status: string; is_active: boolean; processor: string; metadata: Record<string, string>; input: any; created_at: string; modified_at: string };

/** Output content for a run, from the recorded pack it belongs to. */
export function recordedOutput(p: Pack, meta: Record<string, string>): any {
  if (meta.kind === 'snapshot') return { content: p.snapshot, basis: [], mcp_tool_calls: [] };
  if (meta.kind === 'mechanism') return { content: p.mechanism, basis: [], mcp_tool_calls: [] };
  const row = p.rows.find((r) => r.nct_id === meta.nct_id) ?? p.found_beyond_registry_search.find((f) => f.nct_id === meta.nct_id);
  const ch = row?.check;
  return {
    content: { program: ch?.program ?? null, latest_milestone: ch?.latest_milestone ?? null, earlier_milestones: ch?.earlier_milestones ?? [], results_publications: [], next_catalyst: ch?.next_catalyst ?? null },
    basis: [],
    mcp_tool_calls: [{ server_name: 'clinical_trials', tool_name: 'get_trial_details', arguments: '{}', content: '' }],
  };
}

export class FakeParallel {
  runs = new Map<string, FakeRun[]>();
  addCalls = 0;
  /** When set, the next addRuns accepts the runs, then throws (a lost response). */
  loseNextAddResponse = false;
  created: any[] = [];
  private n = 0;
  constructor(private output: (meta: Record<string, string>) => any) {}

  private all = () => [...this.runs.values()].flat();
  complete(filter: (m: Record<string, string>) => boolean = () => true) {
    for (const r of this.all()) if (r.is_active && filter(r.metadata)) Object.assign(r, { status: 'completed', is_active: false });
  }

  taskGroup = {
    create: async ({ metadata }: any) => {
      const id = `tgrp_test${String(++this.n).padStart(6, '0')}`;
      this.runs.set(id, []);
      (this.runs.get(id) as any).metadata = metadata;
      return { taskgroup_id: id, metadata };
    },
    addRuns: async (gid: string, { inputs }: any) => {
      this.addCalls += 1;
      const list = this.runs.get(gid)!;
      const ids = inputs.map((i: any) => {
        const run: FakeRun = { run_id: `trun_${++this.n}`, status: 'queued', is_active: true, processor: i.processor, metadata: i.metadata, input: i.input, created_at: '2026-10-05T12:00:00Z', modified_at: '2026-10-05T12:02:00Z' };
        list.push(run);
        return run.run_id;
      });
      if (this.loseNextAddResponse) {
        this.loseNextAddResponse = false;
        throw new Error('socket hang up');
      }
      return { run_ids: ids, event_cursor: null, run_cursor: null, status: {} };
    },
    getRuns: async (gid: string, opts: any = {}) =>
      iter((this.runs.get(gid) ?? []).map((run) => ({ type: 'task_run.state', run: { ...run }, output: opts.include_output && run.status === 'completed' ? this.output(run.metadata) : null }))),
    retrieve: async (gid: string) => {
      const list = this.runs.get(gid) ?? [];
      const counts: Record<string, number> = {};
      for (const r of list) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return { taskgroup_id: gid, metadata: (list as any).metadata, status: { is_active: list.some((r) => r.is_active), task_run_status_counts: counts, status_message: null, num_task_runs: list.length } };
    },
  };

  taskRun = {
    result: async (runId: string) => {
      const run = this.all().find((r) => r.run_id === runId)!;
      return { run: { ...run }, output: this.output(run.metadata) };
    },
    retrieve: async (runId: string) => ({ ...this.all().find((r) => r.run_id === runId)! }),
    create: async (params: any) => {
      const run: FakeRun = { run_id: `trun_${++this.n}`, status: 'queued', is_active: true, processor: params.processor, metadata: params.metadata, input: params.input, created_at: '2026-10-05T12:00:00Z', modified_at: '2026-10-05T12:01:00Z' };
      this.created.push(params);
      this.runs.set(`single_${run.run_id}`, [run]);
      return { ...run };
    },
  };

  monitorEvents: Record<string, any[]> = {};
  monitor = {
    events: async (_id: string, q: any) => ({ events: this.monitorEvents[q?.event_group_id] ?? [] }),
  };

  asClient = () => this as unknown as Parallel;
}
