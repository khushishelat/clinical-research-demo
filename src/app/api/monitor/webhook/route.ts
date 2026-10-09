// Production monitors call this when a run finds something (monitor.event.detected), so
// news reaches the maps within minutes instead of at the next daily job.
//
// The request is a nudge, never a source: nothing in it is stored. The app finds which of
// its own monitors it names (from monitor.json, not from the payload's metadata), reads that
// monitor's events from the Parallel API with its own key, and refreshes the indication's
// pages if anything was new. A forged request can at most make it re-read one of its own
// monitors, and one that brings nothing new writes nothing. When PARALLEL_WEBHOOK_SECRET
// (the account's webhook secret, Settings → Webhooks) is set, unsigned requests are refused
// as well, per Standard Webhooks.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey } from '../../../../../scripts/lib/pipeline';
import { eventsStep } from '../../../../../scripts/lib/steps/events';
import { collectMonitorEvents, monitorOf } from '../../../../../scripts/lib/steps/monitors';
import { builtKeys } from '@/lib/cron';
import { signed } from '@/lib/webhook';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const ignored = () => NextResponse.json({ ok: true, ignored: true });

export async function POST(req: Request) {
  const body = await req.text();
  const secret = process.env.PARALLEL_WEBHOOK_SECRET;
  if (secret) {
    const timestamp = req.headers.get('webhook-timestamp') ?? '';
    // Signed, and sent within the last five minutes (a replayed request is refused).
    if (!signed(secret, req.headers.get('webhook-id') ?? '', timestamp, body, req.headers.get('webhook-signature') ?? '') || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return NextResponse.json({ error: 'bad signature' }, { status: 401 });
  }
  let payload: { type?: string; data?: { monitor_id?: string; event?: { event_group_id?: string } } };
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'not JSON' }, { status: 400 });
  }
  const monitor_id = payload.data?.monitor_id;
  if (payload.type !== 'monitor.event.detected' || typeof monitor_id !== 'string' || !/^monitor_[a-z0-9]+$/.test(monitor_id)) return ignored();
  const group = payload.data?.event?.event_group_id;
  const event_group_id = typeof group === 'string' && /^mevtgrp_[a-z0-9]+$/.test(group) ? group : null;

  for (const key of await builtKeys()) {
    const d = byKey(key);
    const doc = await monitorOf(d);
    if (!Object.values(doc?.monitors ?? {}).some((m) => m.monitor_id === monitor_id)) continue;
    const got = await collectMonitorEvents(d, { monitor_id, event_group_id });
    if (got.added) {
      await eventsStep(d);
      for (const p of [`/d/${key}`, `/d/${key}/data`, '/', '/api/status']) revalidatePath(p);
    }
    return NextResponse.json({ ok: true, indication: key, ...got });
  }
  return ignored();
}
