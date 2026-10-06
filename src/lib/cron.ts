// Shared by the scheduled routes: Vercel Cron sends `Authorization: Bearer
// $CRON_SECRET`. Without the secret set, the routes refuse every request, so a
// public deployment can't be made to spend on Parallel runs.

import { NextResponse } from 'next/server';
import { builtDiseases } from './space/load';

export function unauthorized(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET is not set' }, { status: 503 });
  return req.headers.get('authorization') === `Bearer ${secret}` ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export const builtKeys = async () => (await builtDiseases()).map((d) => d.key);
