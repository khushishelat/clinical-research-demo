// Shared pipeline plumbing. Every script builds one disease ("space") and is
// resumable: run IDs are recorded before waiting on them, so a crash or a
// re-run never pays twice. Output goes to private Vercel Blob when
// BLOB_READ_WRITE_TOKEN is set, else to .data/ (gitignored). Generated data is
// never committed.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Parallel from 'parallel-web';
import { compactRunEvent, thinStats, type CompactEvent } from '../../src/lib/replay-events';
import { blobStore, folderStore, type Store } from '../../src/lib/store';
import { again } from './retry';

try {
  process.loadEnvFile(join(process.cwd(), '.env.local'));
} catch {
  // No .env.local: rely on the environment.
}

export type Disease = {
  key: string;
  name: string;
  query_cond: string;
  pubmed_terms: string;
  /** NPI taxonomy words that suggest the right person when a name matches several. */
  specialties: string[];
  default_scope?: { min_phase?: number; top_companies?: number; conditions_only?: string };
  subtitle?: string;
  area?: string;
  /** Large indications chain the company list once per region (COMPANY_CHAIN). */
  chain_regions?: string[];
  /** Also keep trials that completed or stopped since this date (YYYY-MM-DD). */
  include_completed_since?: string;
};

const config = JSON.parse(readFileSync(join(process.cwd(), 'scripts/diseases.json'), 'utf8')) as { diseases: Disease[]; default: string; exclude: string[] };

export function disease(): Disease {
  const i = process.argv.indexOf('--disease');
  const key = i > 0 ? process.argv[i + 1] : config.default;
  const d = config.diseases.find((x) => x.key === key);
  if (!d) throw new Error(`Unknown disease "${key}". Add it to scripts/diseases.json.`);
  if (config.exclude.some((e) => d.name.toLowerCase().includes(e))) throw new Error(`${d.name} is excluded.`);
  return d;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);
export const today = () => new Date().toISOString().slice(0, 10);

export const store: Store = process.env.BLOB_READ_WRITE_TOKEN ? blobStore(process.env.BLOB_READ_WRITE_TOKEN) : folderStore(join(process.cwd(), '.data'));
export const where = process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : '.data/';
export const spacePath = (d: Disease, file: string) => `spaces/${d.key}/${file}`;

export function log(d: Disease, msg: string) {
  console.log(`[${d.key}] ${msg}`);
}

/** The Parallel client, or null with a clear message when no key is set (jobs are skipped). */
export function parallel(d: Disease, job: string): Parallel | null {
  if (!process.env.PARALLEL_API_KEY) {
    log(d, `skipping ${job}: PARALLEL_API_KEY is not set`);
    return null;
  }
  // Retries off: a lost response can still have created a run, and a blind retry pays twice.
  return new Parallel({ apiKey: process.env.PARALLEL_API_KEY, maxRetries: 0 });
}

// ── Run log ──────────────────────────────────────────────────────────────────
// One document per disease and job, keyed by a stable ID per unit of work
// (a sponsor, a company, a chain page). The run ID is saved the moment the run
// exists; results are filled in when it finishes.

export type RunRecord = {
  run_id: string;
  interaction_id?: string;
  previous_interaction_id?: string | null;
  processor: string;
  created: string;
  status?: string;
  content?: unknown;
  basis?: unknown[];
  connectors?: Record<string, number>;
  seconds?: number | null;
};
export type RunLog = Record<string, RunRecord>;

export async function runLog(d: Disease, job: string): Promise<{ log: RunLog; save: () => Promise<void> }> {
  const path = spacePath(d, `runs/${job}.json`);
  const log = (await store.get<RunLog>(path)) ?? {};
  let pending = Promise.resolve();
  // Serialize writes so concurrent units never overwrite each other.
  const save = () => (pending = pending.then(() => store.put(path, log)));
  return { log, save };
}

/**
 * Replay recorder. A finished run returns only its final state, so the replay
 * (searches, pages read, connector calls) is captured live while runs work.
 */
export type Recorder = { start: number; events: CompactEvent[] };
export const recorder = (): Recorder => ({ start: Date.now(), events: [] });
export async function saveReplay(d: Disease, job: string, r: Recorder) {
  const events = thinStats(r.events).sort((a, b) => a.t - b.t);
  // A re-run that only reused finished runs records little; keep the fuller replay of the
  // same runs. Runs are named by their run-log keys, which carry the spec version, so a
  // recording of different runs (a new spec, a new period) always replaces the old one.
  const prior = await store.get<{ events: { run: string }[] }>(spacePath(d, `replay/${job}.json`));
  const before = new Set((prior?.events ?? []).map((e) => e.run));
  const same = events.every((e) => before.has(e.run));
  if (prior && same && prior.events.length >= events.length) return;
  await store.put(spacePath(d, `replay/${job}.json`), { job, started: new Date(r.start).toISOString(), duration_s: Math.round((Date.now() - r.start) / 1000), events });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secondsOf = (run: { created_at?: string | null; modified_at?: string | null }) =>
  run.created_at && run.modified_at ? Math.round((Date.parse(run.modified_at) - Date.parse(run.created_at)) / 1000) : null;

export type RunSpec = {
  processor: string;
  input: unknown;
  schema: object;
  connectors?: string[];
  metadata?: Record<string, string>;
  previous_interaction_id?: string | null;
};

/** Create a run once per key (or reuse the recorded one), wait for it, and record the result. */
export async function runOnce(client: Parallel, rl: { log: RunLog; save: () => Promise<void> }, key: string, spec: RunSpec, rec0?: Recorder): Promise<RunRecord> {
  let rec = rl.log[key];
  if (!rec) {
    const run: any = await client.taskRun.create({
      processor: spec.processor,
      input: spec.input as any,
      task_spec: { output_schema: outputSchema(spec.schema) as any },
      ...(spec.connectors?.length ? { advanced_settings: { data_sources: { free: spec.connectors } } as any } : {}),
      metadata: { app: 'trial-check', ...(spec.metadata ?? {}) },
      // Progress events are only tracked when asked for at creation (on by default from pro up).
      ...(rec0 ? { enable_events: true } : {}),
      ...(spec.previous_interaction_id ? { previous_interaction_id: spec.previous_interaction_id } : {}),
    } as any);
    rec = rl.log[key] = { run_id: run.run_id, interaction_id: run.interaction_id, previous_interaction_id: spec.previous_interaction_id ?? null, processor: spec.processor, created: new Date().toISOString() };
    await rl.save();
  }
  if (rec.status) return rec;
  if (rec0) {
    // Follow the run's event stream for the replay. A stream stays open for up to 570 s, and
    // reconnecting to an active run replays its reasoning trace from the start, so reconnect
    // until the run ends and keep each message once. Times come from the events' own
    // timestamps, so a stream joined late (a queued group run) still plays back in order.
    const seen = new Set<string>();
    for (let connection = 0; connection < 20; connection++) {
      let ended = false;
      try {
        for await (const e of (await client.taskRun.events(rec.run_id)) as any) {
          const at = e.timestamp ? Date.parse(e.timestamp) : Date.now();
          const once = e.type === 'task_run.state' ? `state|${e.run?.status}` : e.type === 'task_run.progress_stats' ? null : `${e.type}|${e.timestamp ?? ''}|${e.message ?? ''}`;
          if (once && seen.has(once)) continue;
          if (once) seen.add(once);
          const c = compactRunEvent(e, key, Math.max(0, Math.round((at - rec0.start) / 1000)));
          if (c) rec0.events.push(c);
          if (e.type === 'task_run.state' && e.run && !e.run.is_active) {
            ended = true;
            break;
          }
        }
      } catch {
        // reconnect, or fall through to polling
      }
      if (ended || !(await again(() => client.taskRun.retrieve(rec.run_id))).is_active) break;
    }
  }
  for (;;) {
    const run: any = await again(() => client.taskRun.retrieve(rec.run_id));
    if (!run.is_active) {
      rec.status = run.status;
      rec.seconds = secondsOf(run);
      if (run.status === 'completed') {
        const res: any = await again(() => client.taskRun.result(rec.run_id, { timeout: 30 }));
        rec.content = typeof res.output.content === 'string' && !isText(spec.schema) ? JSON.parse(res.output.content) : res.output.content;
        rec.basis = res.output.basis ?? [];
        rec.connectors = (res.output.mcp_tool_calls ?? []).reduce((m: Record<string, number>, c: any) => ((m[c.server_name] = (m[c.server_name] ?? 0) + 1), m), {});
      }
      await rl.save();
      return rec;
    }
    await sleep(15_000);
  }
}

/**
 * List building by interaction chaining (the datacenter-map-demo pattern): page 1
 * asks for everything, later pages ask for more net-new items with
 * previous_interaction_id, until a page adds fewer than `minNew`.
 */
export async function chain<T>(
  client: Parallel,
  rl: { log: RunLog; save: () => Promise<void> },
  key: string,
  opts: { first: string; next: string; field: string; dedupe: (x: T) => string; maxPages: number; minNew: number; minPages?: number } & Omit<RunSpec, 'input' | 'previous_interaction_id'>
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let prev: string | null = null;
  for (let page = 1; page <= opts.maxPages; page++) {
    const rec = await runOnce(client, rl, `${key}:p${page}`, { ...opts, input: page === 1 ? opts.first : opts.next, previous_interaction_id: prev });
    const got = ((rec.content as any)?.[opts.field] ?? []) as T[];
    let added = 0;
    for (const x of got) {
      const k = opts.dedupe(x);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push(x);
      added += 1;
    }
    // A page that adds few new items ends the list, but never before minPages: one thin page is noise.
    if (rec.status !== 'completed' || (page >= (opts.minPages ?? 1) && added < opts.minNew)) break;
    prev = rec.interaction_id ?? null;
  }
  return items;
}

/**
 * One Task Group per disease and job. Units are keyed by metadata.unit, so a
 * repeat run lists the group's runs and adds only what is missing: a lost
 * addRuns response can still have created runs, and completed duplicates are
 * billed (validation/lib/group-runner.ts, Sep 26).
 */
export async function groupRuns(
  client: Parallel,
  rl: { log: RunLog; save: () => Promise<void> },
  d: Disease,
  job: string,
  units: { key: string; spec: RunSpec }[],
  width = 12,
  rec0?: Recorder
): Promise<Record<string, RunRecord>> {
  const now = () => new Date().toISOString();
  let gid = rl.log.__group?.run_id;
  if (!gid) {
    const g: any = await client.taskGroup.create({ metadata: { app: 'trial-check', job, disease: d.key } });
    gid = g.taskgroup_id as string;
    rl.log.__group = { run_id: gid, processor: 'group', created: now() };
    await rl.save();
  }
  const sync = () =>
    again(async () => {
      for await (const e of await client.taskGroup.getRuns(gid!, { include_output: false })) {
        const ev: any = e;
        const unit = ev.type === 'task_run.state' ? ev.run?.metadata?.unit : null;
        if (unit && !rl.log[unit]) rl.log[unit] = { run_id: ev.run.run_id, processor: ev.run.processor ?? '', created: now() };
      }
      await rl.save();
    });
  await sync();
  const missing = units.filter((u) => !rl.log[u.key]);
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50).map((u) => ({
      processor: u.spec.processor,
      input: u.spec.input as any,
      task_spec: { output_schema: outputSchema(u.spec.schema) as any },
      ...(u.spec.connectors?.length ? { advanced_settings: { data_sources: { free: u.spec.connectors } } } : {}),
      metadata: { app: 'trial-check', job, disease: d.key, ...(u.spec.metadata ?? {}), unit: u.key },
      ...(rec0 ? { enable_events: true } : {}),
    }));
    try {
      await client.taskGroup.addRuns(gid, { inputs: batch as any }, { maxRetries: 0 });
    } catch (error) {
      log(d, `addRuns failed (${(error as Error).message}); reconciling from the group`);
    }
  }
  if (missing.length) await sync();
  const out: Record<string, RunRecord> = {};
  await pool(units, width, async (u) => {
    if (!rl.log[u.key]) return log(d, `no run for ${u.key}; re-run the script to add it`);
    out[u.key] = await runOnce(client, rl, u.key, u.spec, rec0);
  });
  return out;
}

/** Run many units with bounded concurrency. */
export async function pool<T, R>(items: T[], width: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (i < items.length) {
        const j = i++;
        out[j] = await fn(items[j]);
      }
    })
  );
  return out;
}

// ── JSON schema helpers ──────────────────────────────────────────────────────
export const S = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
export const N = (description: string) => ({ type: ['string', 'null'], description });
export const E = (values: string[], description?: string) => ({ type: 'string', enum: values, ...(description ? { description } : {}) });
export const A = (items: object, description?: string) => ({ type: 'array', items, ...(description ? { description } : {}) });
export const O = (properties: Record<string, object>, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const B = (description: string) => ({ type: 'boolean', description });
/** A text output schema: the run returns markdown with inline citations instead of JSON. */
export const TEXT = (description: string) => ({ type: 'text', description });
const isText = (schema: object) => (schema as { type?: string }).type === 'text';
const outputSchema = (schema: object) => (isText(schema) ? schema : { type: 'json', json_schema: schema as Record<string, unknown> });
