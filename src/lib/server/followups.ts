// Server-only. Job 2: Monitor events → connector-backed follow-up checks.
//
// POST /api/webhooks/parallel verifies, de-duplicates and queues; it returns
// 200 at once, because anything else is retried for 48 hours. The payload is
// a nudge: a monitor webhook carries only `event_group_id`, so the events are
// fetched here. GET /api/cron/followups drains the queue:
//   1. fetch the event group, match each event to trials, store it
//   2. for a trial match, within the follow-up budget, start a `pro` trial
//      check with connectors, `previous_interaction_id` = the event ID
//   3. when that run finishes (webhook, or polled here if one was lost),
//      patch the row in latest.json and label it "Updated from a Monitor event"

import type { TaskRunCreateParams } from 'parallel-web/resources/task-run';
import { checkFrom } from '../domain/join';
import { mergeEvents, toStoredEvent, type StoredEvent } from '../domain/monitor';
import { patchCheck } from '../domain/patch';
import { PRICE_USD, TRIAL_CHECK_SPEC_V2, TRIAL_CONNECTORS, TRIAL_PROCESSOR, type AdvancedSettingsWithConnectors } from '../domain/specs';
import type { Pack } from '../domain/types';
import { companyByKey, loadPack, type Context } from './context';
import { reserveBudget, today, verifyWebhook } from './guards';
import { trialInput } from './runs';
import { paths } from './store';

export type QueueItem =
  | { type: 'monitor_event'; monitor_id: string; event_group_id: string; company: string; attempts?: number }
  | { type: 'run_done'; run_id: string; company: string; nct_id: string; event_id: string; attempts?: number };

const QUEUE = 'queue:followups';
const WEBHOOK_SEEN_TTL = 7 * 24 * 60 * 60;
const MAX_ATTEMPTS = 5;

type Headers = { get(name: string): string | null };

export async function handleWebhook(c: Context, headers: Headers, body: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = headers.get('webhook-id');
  const ok = verifyWebhook(
    c.settings.webhookSecret,
    { id, timestamp: headers.get('webhook-timestamp'), signature: headers.get('webhook-signature') },
    body,
    Math.floor(c.now().getTime() / 1000)
  );
  if (!ok) return { status: 401, body: { error: 'invalid signature' } };
  if (!(await c.kv.set(`wh:${id}`, '1', { nx: true, exSeconds: WEBHOOK_SEEN_TTL }))) return { status: 200, body: { duplicate: true } };

  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return { status: 200, body: { ignored: 'not json' } };
  }
  const data = payload?.data ?? {};
  const meta = data.metadata ?? {};
  if (meta.app !== 'trial-check') return { status: 200, body: { ignored: 'not ours' } };

  if (payload.type === 'monitor.event.detected' && data.event?.event_group_id && meta.company) {
    await enqueue(c, { type: 'monitor_event', monitor_id: data.monitor_id, event_group_id: data.event.event_group_id, company: meta.company });
    return { status: 200, body: { queued: 'monitor_event' } };
  }
  if (payload.type === 'task_run.status' && meta.kind === 'monitor_followup' && data.is_active === false) {
    await enqueue(c, { type: 'run_done', run_id: data.run_id, company: meta.company, nct_id: meta.nct_id, event_id: meta.event_id });
    return { status: 200, body: { queued: 'run_done' } };
  }
  return { status: 200, body: { ignored: payload.type ?? 'unknown' } };
}

const enqueue = (c: Context, item: QueueItem) => c.kv.lpush(QUEUE, JSON.stringify(item));

async function readEvents(c: Context, key: string): Promise<StoredEvent[]> {
  return (await c.store.get<StoredEvent[]>(paths.events(key))) ?? [];
}

/** Drains up to `max` queue items, then polls follow-ups still marked running. Safe to call concurrently (locked). */
export async function drainFollowups(c: Context, max = 25): Promise<{ processed: number; started: number; applied: number; requeued: number; skipped?: string }> {
  const out = { processed: 0, started: 0, applied: 0, requeued: 0 };
  if (!c.parallel) return { ...out, skipped: 'fixture mode' };
  if (!(await c.kv.set('lock:followups', '1', { nx: true, exSeconds: 240 }))) return { ...out, skipped: 'busy' };
  try {
    for (let i = 0; i < max; i += 1) {
      const raw = await c.kv.rpop(QUEUE);
      if (!raw) break;
      const item = JSON.parse(raw) as QueueItem;
      out.processed += 1;
      try {
        if (item.type === 'monitor_event') out.started += await ingestEventGroup(c, item);
        else if (await applyFollowup(c, item.company, item.nct_id, item.event_id, item.run_id)) out.applied += 1;
      } catch {
        if ((item.attempts ?? 0) + 1 < MAX_ATTEMPTS) {
          await enqueue(c, { ...item, attempts: (item.attempts ?? 0) + 1 });
          out.requeued += 1;
        }
      }
    }
    out.applied += await pollRunning(c);
    return out;
  } finally {
    await c.kv.del('lock:followups');
  }
}

async function ingestEventGroup(c: Context, item: Extract<QueueItem, { type: 'monitor_event' }>): Promise<number> {
  const loaded = await loadPack(item.company, c);
  if (!loaded) return 0;
  const page = await c.parallel!.monitor.events(item.monitor_id, { event_group_id: item.event_group_id });
  const received = c.now().toISOString();
  const incoming = (page.events as any[])
    .filter((e) => e.event_type === 'event_stream' || (e.event_id && e.output && !e.changed_output))
    .map((e) => toStoredEvent(loaded.pack, e, received));
  const events = mergeEvents(await readEvents(c, item.company), incoming);
  let started = 0;
  for (const e of events) {
    if (e.match !== 'trial' || e.followup || !incoming.some((x) => x.event_id === e.event_id)) continue;
    e.followup = await startFollowup(c, loaded.pack, item.company, e);
    if (e.followup.status === 'running') started += 1;
  }
  await c.store.put(paths.events(item.company), events);
  return started;
}

async function startFollowup(c: Context, pack: Pack, key: string, e: StoredEvent): Promise<NonNullable<StoredEvent['followup']>> {
  const nct = e.trials[0];
  if (!(await reserveBudget(c.kv, 'followup', PRICE_USD.pro, c.settings.budgets.followup, c.now()))) {
    return { run_id: '', nct_id: nct, status: 'skipped', reason: 'daily follow-up budget reached' };
  }
  const company = companyByKey(key, c) ?? { key, name: pack.about.company, match: pack.about.company.toLowerCase(), aliases: [], lead_asset: '' };
  const row = pack.rows.find((r) => r.nct_id === nct);
  const found = pack.found_beyond_registry_search.find((f) => f.nct_id === nct);
  const base = row
    ? trialInput(company, today(c.now()), row)
    : { company: company.name, today: today(c.now()), nct_id: nct, title: found?.registry?.title ?? '', sponsor_role: 'partner_led', lead_sponsor: found?.registry?.lead_sponsor ?? '', registry_status: found?.registry?.status ?? '' };
  const params: Omit<TaskRunCreateParams, 'advanced_settings'> & { advanced_settings: AdvancedSettingsWithConnectors } = {
    processor: TRIAL_PROCESSOR,
    input: { ...base, monitor_update: e.summary },
    task_spec: TRIAL_CHECK_SPEC_V2,
    // Lets the check build on what the monitor already read (docs: monitor → task).
    previous_interaction_id: e.event_id,
    metadata: { app: 'trial-check', kind: 'monitor_followup', company: key, nct_id: nct, event_id: e.event_id },
    advanced_settings: { data_sources: { free: [...TRIAL_CONNECTORS] } },
    ...(c.settings.publicBaseUrl ? { webhook: { url: `${c.settings.publicBaseUrl}/api/webhooks/parallel`, event_types: ['task_run.status' as const] } } : {}),
  };
  // Retries off: a lost response can still have created the run.
  const run = await c.parallel!.taskRun.create(params as TaskRunCreateParams, { maxRetries: 0 });
  return { run_id: run.run_id, nct_id: nct, status: 'running' };
}

/** Patches the finished follow-up into latest.json. Returns true if the pack changed. */
async function applyFollowup(c: Context, key: string, nct: string, eventId: string, runId: string): Promise<boolean> {
  const events = await readEvents(c, key);
  const event = events.find((e) => e.event_id === eventId);
  if (event?.followup?.status === 'applied') return false;
  const run = await c.parallel!.taskRun.retrieve(runId);
  if (run.is_active) return false;
  const loaded = await loadPack(key, c);
  let changed = false;
  if (run.status === 'completed' && loaded) {
    const result = await c.parallel!.taskRun.result(runId, { timeout: 30 });
    const status = loaded.pack.rows.find((r) => r.nct_id === nct)?.status ?? loaded.pack.found_beyond_registry_search.find((f) => f.nct_id === nct)?.registry?.status ?? '';
    const check = checkFrom(status, { run, output: result.output });
    if (check) {
      check.updated_by = { source: 'monitor', event_id: eventId, date: today(c.now()), summary: event?.summary ?? '' };
      const next = patchCheck(loaded.pack, nct, check);
      if (next) {
        await c.store.put(paths.latestPack(key), next);
        changed = true;
      }
    }
  }
  if (event) {
    event.followup = { run_id: runId, nct_id: nct, status: changed ? 'applied' : 'failed', finished: c.now().toISOString(), ...(changed ? {} : { reason: run.status }) };
    await c.store.put(paths.events(key), events);
  }
  return changed;
}

/** Catches follow-ups whose completion webhook never arrived. */
async function pollRunning(c: Context): Promise<number> {
  let applied = 0;
  for (const co of c.companies) {
    const running = (await readEvents(c, co.key)).filter((e) => e.followup?.status === 'running');
    for (const e of running) if (await applyFollowup(c, co.key, e.followup!.nct_id, e.event_id, e.followup!.run_id)) applied += 1;
  }
  return applied;
}

/** Monitor events for What's new (GET /api/events/:key). */
export async function eventsFor(c: Context, key: string): Promise<StoredEvent[]> {
  try {
    return await readEvents(c, key);
  } catch {
    return [];
  }
}
