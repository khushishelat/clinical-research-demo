// Server-only. GET /api/research/:gid/stream: the live run as a landscape
// state (HANDOFF-v2.1 section 6). Same mechanics as the validation runner:
// follow group events with last_event_id, open run event streams for a few
// runs at a time (they name connector calls live), fetch each result as its
// run finishes, and let the browser's EventSource reconnect before the
// function's time limit. When the snapshot finishes and when the group
// finishes, the request job advances (found-trial checks, then the pack).

import type Parallel from 'parallel-web';
import { compactRunEvent, runKey } from '../domain/events';
import { checkFrom } from '../domain/join';
import type { Context } from './context';
import { advanceRequest, requestState } from './research';
import type { RunMeta } from './runs';

export type StreamMessage =
  | { type: 'hello'; key: string; taskgroup_id: string; phase: string | null; started_at: string | null; trials: number; estimated_minutes: number | null }
  | { type: 'runs'; runs: { run: string; run_id: string; status: string }[] }
  | { type: 'group'; is_active: boolean; counts: Record<string, number>; message: string | null }
  | { type: 'event'; event: NonNullable<ReturnType<typeof compactRunEvent>> }
  | { type: 'result'; run: string; kind: RunMeta['kind']; nct_id?: string; status: string; content: unknown }
  | { type: 'phase'; phase: string; recorded?: string }
  | { type: 'reconnect' }
  | { type: 'error'; message: string };

const POOL = 4;
const PRIORITY: Record<string, number> = { snapshot: 0, mechanism: 1, trial_check: 2, found_check: 3 };

export async function streamRun(
  c: Context,
  client: Parallel,
  gid: string,
  key: string,
  lastEventId: string | null,
  send: (m: StreamMessage, id?: string) => void,
  signal: AbortSignal,
  deadlineMs = 270_000
): Promise<void> {
  const T0 = Date.now();
  const t = () => Math.round((Date.now() - T0) / 100) / 10;
  const alive = () => !signal.aborted && Date.now() - T0 < deadlineMs;
  const job = await requestState(c, key);
  const statusOf = new Map((job?.stage1 ?? []).map((r) => [r.nct_id, r.status]));
  for (const [id, r] of Object.entries(job?.found ?? {})) statusOf.set(id, r.status);
  send({ type: 'hello', key, taskgroup_id: gid, phase: job?.phase ?? null, started_at: job?.started_at ?? null, trials: job?.stage1?.length ?? 0, estimated_minutes: null });

  // Current runs, so a (re)connecting page knows what is done and what is running.
  const meta = new Map<string, Partial<RunMeta>>();
  const active: { id: string; kind: string }[] = [];
  const listRuns = async () => {
    const runs: { run: string; run_id: string; status: string }[] = [];
    for await (const e of await client.taskGroup.getRuns(gid, { include_output: false })) {
      if (e.type !== 'task_run.state') continue;
      const m = (e.run.metadata ?? {}) as Partial<RunMeta>;
      if (!meta.has(e.run.run_id) && e.run.is_active) active.push({ id: e.run.run_id, kind: m.kind ?? '' });
      meta.set(e.run.run_id, m);
      runs.push({ run: runKey(m), run_id: e.run.run_id, status: e.run.status });
    }
    send({ type: 'runs', runs });
  };
  await listRuns();

  const streamed = new Set<string>();
  const worker = async () => {
    while (alive()) {
      active.sort((a, b) => (PRIORITY[a.kind] ?? 9) - (PRIORITY[b.kind] ?? 9));
      const next = active.find((r) => !streamed.has(r.id));
      if (!next) {
        await new Promise((r) => setTimeout(r, 1500));
        if (!groupActive) return;
        continue;
      }
      streamed.add(next.id);
      const run = runKey(meta.get(next.id));
      try {
        for await (const ev of await client.taskRun.events(next.id, { signal })) {
          const compact = compactRunEvent(ev, run, t());
          if (compact && compact.k !== 'state') send({ type: 'event', event: compact });
          if (!alive()) break;
        }
      } catch {
        // A dropped run stream only loses live detail; the result still arrives via the group stream.
      }
    }
  };

  const onTerminal = async (runId: string, status: string) => {
    const m = meta.get(runId) ?? {};
    const kind = m.kind as RunMeta['kind'];
    let content: unknown = null;
    if (status === 'completed') {
      try {
        const result = await client.taskRun.result(runId, { timeout: 30 });
        if (kind === 'trial_check' || kind === 'found_check') {
          content = checkFrom(statusOf.get(m.nct_id ?? '') ?? '', { run: { run_id: runId, status }, output: result.output });
        } else content = (result.output as any)?.content ?? null;
      } catch {
        content = null;
      }
    }
    send({ type: 'result', run: runKey(m), kind, ...(m.nct_id ? { nct_id: m.nct_id } : {}), status, content });
    if (kind === 'snapshot') {
      // Adds found-by-research checks to this group; list again so their events stream too.
      await advanceRequest(c, key).catch(() => null);
      await listRuns().catch(() => null);
    }
  };

  let groupActive = true;
  let cursor = lastEventId;
  const groupWorker = async () => {
    while (alive() && groupActive) {
      try {
        const events = await client.taskGroup.events(gid, cursor ? { last_event_id: cursor } : {}, { signal });
        for await (const e of events) {
          const id = 'event_id' in e && e.event_id ? e.event_id : undefined;
          if (id) cursor = id;
          if (e.type === 'task_group_status') {
            groupActive = e.status.is_active;
            send({ type: 'group', is_active: e.status.is_active, counts: e.status.task_run_status_counts ?? {}, message: e.status.status_message ?? null }, id);
          } else if (e.type === 'task_run.state' && !e.run.is_active) {
            if (!meta.has(e.run.run_id)) meta.set(e.run.run_id, (e.run.metadata ?? {}) as Partial<RunMeta>);
            await onTerminal(e.run.run_id, e.run.status);
            send({ type: 'event', event: { k: 'state', run: runKey(meta.get(e.run.run_id)), t: t(), status: e.run.status } }, id);
          }
          if (!alive()) break;
        }
      } catch {
        if (!alive()) break;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (alive() && groupActive) groupActive = (await client.taskGroup.retrieve(gid)).status.is_active;
    }
  };

  await Promise.all([groupWorker(), ...Array.from({ length: POOL }, worker)]);
  if (!groupActive) {
    // The group is idle: build and write the pack (or add found checks, then keep going).
    const next = await advanceRequest(c, key).catch(() => null);
    const state = next ?? (await requestState(c, key));
    send({ type: 'phase', phase: state?.phase ?? 'unknown', ...(state?.phase === 'finalized' ? { recorded: state.finalized_at?.slice(0, 10) } : {}) });
    if (state?.phase === 'finalized' || state?.phase === 'failed') return;
  }
  send({ type: 'reconnect' });
}
