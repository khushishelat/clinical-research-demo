// The weekly brief: each call writes the next indication still missing this
// week's issue (one ultra2x run, about 5–10 minutes, recorded for the replay),
// so the Monday schedule covers every indication in turn.

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { disease as byKey, spacePath, store, today } from '../../../../../scripts/lib/pipeline';
import { briefStep } from '../../../../../scripts/lib/steps/brief';
import { builtKeys, unauthorized } from '@/lib/cron';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  // An indication whose brief fails is reported and skipped, so it can't hold up the others.
  const failed: Record<string, string> = {};
  for (const key of await builtKeys()) {
    const d = byKey(key);
    const index = (await store.get<{ issues: string[] }>(spacePath(d, 'briefs/index.json'))) ?? { issues: [] };
    if (index.issues.includes(today())) continue;
    try {
      await briefStep(d);
    } catch (error) {
      failed[key] = (error as Error).message.slice(0, 300);
      console.error(`[${key}] brief failed:`, error);
      continue;
    }
    revalidatePath(`/d/${key}`);
    return NextResponse.json({ ok: true, wrote: key, failed });
  }
  return NextResponse.json({ ok: Object.keys(failed).length === 0, wrote: null, failed, note: 'every other indication has this week’s brief' }, { status: Object.keys(failed).length ? 500 : 200 });
}
