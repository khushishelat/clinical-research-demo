// Daily, after the refresh: companies the news Monitors found that the map lacks join it
// (scripts/lib/steps/expand.ts). It runs three times, 20 minutes apart, so a run that
// outlives one call finishes in the next; each call resumes from the run logs.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey } from '../../../../../scripts/lib/pipeline';
import { eventsStep } from '../../../../../scripts/lib/steps/events';
import { expandStep } from '../../../../../scripts/lib/steps/expand';
import { builtKeys, unauthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const done: Record<string, { added: string[]; researched: string[]; rejoined: number }> = {};
  const failed: Record<string, string> = {};
  for (const key of await builtKeys()) {
    const d = byKey(key);
    if (!d.monitor) continue;
    try {
      done[key] = await expandStep(d);
      const { added, researched, rejoined } = done[key];
      if (!added.length && !researched.length && !rejoined) continue;
      await eventsStep(d);
      revalidatePath(`/d/${key}`);
      revalidatePath(`/d/${key}/data`);
    } catch (error) {
      failed[key] = (error as Error).message.slice(0, 300);
      console.error(`[${key}] map expansion failed:`, error);
    }
  }
  revalidatePath('/');
  return NextResponse.json({ ok: Object.keys(failed).length === 0, done, failed }, { status: Object.keys(failed).length ? 500 : 200 });
}
