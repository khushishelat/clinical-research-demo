// Production monitors call this when a run finds something (monitor.event.detected), so
// news reaches the maps within minutes instead of at the next daily job. The payload names
// only the monitor and the execution; this reads that execution's events with the API key,
// adds them to the indication's feed and refreshes its pages. Requests are signed per
// Standard Webhooks with the Parallel account's webhook secret (PARALLEL_WEBHOOK_SECRET,
// from Settings → Webhooks); without it the route refuses, and the daily job still collects.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey } from '../../../../../scripts/lib/pipeline';
import { eventsStep } from '../../../../../scripts/lib/steps/events';
import { collectMonitorEvents } from '../../../../../scripts/lib/steps/monitors';
import { builtKeys } from '@/lib/cron';
import { signed } from '@/lib/webhook';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  const secret = process.env.PARALLEL_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'PARALLEL_WEBHOOK_SECRET is not set' }, { status: 503 });
  const body = await req.text();
  const id = req.headers.get('webhook-id') ?? '';
  const timestamp = req.headers.get('webhook-timestamp') ?? '';
  const signature = req.headers.get('webhook-signature') ?? '';
  // Signed, and sent within the last five minutes (a replayed request is refused).
  if (!signed(secret, id, timestamp, body, signature) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return NextResponse.json({ error: 'bad signature' }, { status: 401 });

  const payload = JSON.parse(body) as { type?: string; data?: { monitor_id?: string; event?: { event_group_id?: string }; metadata?: Record<string, string> } };
  const monitor_id = payload.data?.monitor_id;
  const event_group_id = payload.data?.event?.event_group_id;
  const key = payload.data?.metadata?.disease;
  if (payload.type !== 'monitor.event.detected' || !monitor_id || !event_group_id || !key || !(await builtKeys()).includes(key)) return NextResponse.json({ ok: true, ignored: true });

  const d = byKey(key);
  const got = await collectMonitorEvents(d, { monitor_id, event_group_id });
  if (got.added) {
    await eventsStep(d);
    for (const p of [`/d/${key}`, `/d/${key}/data`, '/', '/api/status']) revalidatePath(p);
  }
  return NextResponse.json({ ok: true, ...got });
}
