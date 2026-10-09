// Daily refresh for every built indication:
// - today's ClinicalTrials.gov snapshot and diff (free);
// - the indication's news Monitor, created here when its config turns it on and
//   none exists (~$0.01 a day), and its new events (free to read);
// - the event feed and the first-disclosure check for newly registered trials;
// - a readout check for trials newly at a readout point, and a monthly re-check of
//   those with no results yet (core runs, usually none or a few).
// Every step resumes from its run log, so a run that outlives this invocation is
// picked up by the next one.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey } from '../../../../../scripts/lib/pipeline';
import { eventsStep } from '../../../../../scripts/lib/steps/events';
import { firstSeenStep } from '../../../../../scripts/lib/steps/first-seen';
import { collectMonitorEvents, createMonitor } from '../../../../../scripts/lib/steps/monitors';
import { readoutsStep } from '../../../../../scripts/lib/steps/readouts';
import { registryStep } from '../../../../../scripts/lib/steps/registry';
import { builtKeys, unauthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const started = Date.now();
  const done: Record<string, string[]> = {};
  const failed: Record<string, string> = {};
  for (const key of await builtKeys()) {
    const d = byKey(key);
    done[key] = [];
    // One indication's failure is logged and reported; the rest still refresh.
    try {
      await registryStep(d);
      done[key].push('registry');
      // A monitor is created with this deployment's API key, so this job can read its events.
      if (d.monitor) await createMonitor(d);
      if ((await collectMonitorEvents(d)) < 0 && d.monitor) await createMonitor(d);
      done[key].push('monitor');
      await eventsStep(d);
      done[key].push('events');
      // Leave time for the rest; an unfinished check resumes tomorrow.
      if (Date.now() - started < 9 * 60_000) {
        await firstSeenStep(d);
        await eventsStep(d);
        done[key].push('first-seen');
      }
      // Trials that reached a readout point since the last check (core runs; usually none or a few).
      if (Date.now() - started < 10 * 60_000) {
        await readoutsStep(d);
        done[key].push('readouts');
      }
    } catch (error) {
      failed[key] = (error as Error).message.slice(0, 300);
      console.error(`[${key}] daily refresh failed after ${done[key].join(', ') || 'start'}:`, error);
    }
    revalidatePath(`/d/${key}`);
    revalidatePath(`/d/${key}/data`);
    revalidatePath('/api/status');
  }
  revalidatePath('/');
  return NextResponse.json({ ok: Object.keys(failed).length === 0, seconds: Math.round((Date.now() - started) / 1000), done, failed }, { status: Object.keys(failed).length ? 500 : 200 });
}
