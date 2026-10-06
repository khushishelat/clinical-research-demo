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
  for (const key of await builtKeys()) {
    const d = byKey(key);
    const index = (await store.get<{ issues: string[] }>(spacePath(d, 'briefs/index.json'))) ?? { issues: [] };
    if (index.issues.includes(today())) continue;
    await briefStep(d);
    revalidatePath(`/d/${key}`);
    return NextResponse.json({ ok: true, wrote: key });
  }
  return NextResponse.json({ ok: true, wrote: null, note: 'every indication has this week’s brief' });
}
