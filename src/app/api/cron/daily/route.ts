// Daily refresh for every built indication: today's ClinicalTrials.gov snapshot
// and diff (free), the indication's news Monitor (created here when its config
// turns it on and none exists; ~$0.01 a day) and its new events (free to read), the event feed, and the
// first-disclosure check for newly registered trials (a few core runs). Every
// step resumes from its run log, so a run that outlives this invocation is
// picked up by the next one.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey } from '../../../../../scripts/lib/pipeline';
import { eventsStep } from '../../../../../scripts/lib/steps/events';
import { firstSeenStep } from '../../../../../scripts/lib/steps/first-seen';
import { collectMonitorEvents, createMonitor } from '../../../../../scripts/lib/steps/monitors';
import { registryStep } from '../../../../../scripts/lib/steps/registry';
import { builtKeys, unauthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const started = Date.now();
  const done: Record<string, string[]> = {};
  for (const key of await builtKeys()) {
    const d = byKey(key);
    done[key] = [];
    await registryStep(d);
    done[key].push('registry');
    // A monitor is created with this deployment's API key, so this job can read its events.
    if (d.monitor) await createMonitor(d);
    await collectMonitorEvents(d);
    done[key].push('monitor');
    await eventsStep(d);
    done[key].push('events');
    // Leave time for the rest; an unfinished check resumes tomorrow.
    if (Date.now() - started < 9 * 60_000) {
      await firstSeenStep(d);
      await eventsStep(d);
      done[key].push('first-seen');
    }
    revalidatePath(`/d/${key}`);
    revalidatePath(`/d/${key}/data`);
  }
  return NextResponse.json({ ok: true, seconds: Math.round((Date.now() - started) / 1000), done });
}
