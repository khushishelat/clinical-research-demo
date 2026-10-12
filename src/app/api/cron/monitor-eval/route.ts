// The weekly monitor evaluation: each call scores the next indication still missing
// last week's evaluation (one ultra reference run, a few minutes), so the Monday
// schedule covers every indication with monitors in turn.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey, spacePath, store } from '../../../../../scripts/lib/pipeline';
import { lastWeek, monitorEvalStep } from '../../../../../scripts/lib/steps/monitor-eval';
import { builtKeys, unauthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const { start, end } = lastWeek();
  const failed: Record<string, string> = {};
  for (const key of await builtKeys()) {
    const d = byKey(key);
    if (!d.monitor) continue;
    const index = (await store.get<{ weeks: string[] }>(spacePath(d, 'monitor-eval/index.json'))) ?? { weeks: [] };
    if (index.weeks.includes(start)) continue;
    try {
      await monitorEvalStep(d, start, end);
    } catch (error) {
      failed[key] = (error as Error).message.slice(0, 300);
      console.error(`[${key}] monitor evaluation failed:`, error);
      continue;
    }
    revalidatePath(`/d/${key}/monitor`);
    return NextResponse.json({ ok: true, wrote: key, week: start, failed });
  }
  return NextResponse.json({ ok: Object.keys(failed).length === 0, wrote: null, week: start, failed }, { status: Object.keys(failed).length ? 500 : 200 });
}
