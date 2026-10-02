import { NextResponse } from 'next/server';
import { trialDetail } from '@/lib/space/detail';
import { loadSpace } from '@/lib/space/load';

export async function GET(_req: Request, ctx: RouteContext<'/api/d/[disease]/trial/[nct]'>) {
  const { disease, nct } = await ctx.params;
  const space = await loadSpace(disease);
  const trial = space ? trialDetail(space, nct.toUpperCase()) : null;
  if (!trial) return NextResponse.json({ error: 'Not on this map' }, { status: 404 });
  return NextResponse.json(trial, { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
