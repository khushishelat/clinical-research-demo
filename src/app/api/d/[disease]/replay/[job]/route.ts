import { NextResponse } from 'next/server';
import { replayFor } from '@/lib/space/load';

// A recorded research run (searches, pages read, connector calls), for playback.
export async function GET(_req: Request, ctx: RouteContext<'/api/d/[disease]/replay/[job]'>) {
  const { disease, job } = await ctx.params;
  if (!/^[a-z-]+$/.test(job)) return NextResponse.json({ error: 'Unknown job' }, { status: 400 });
  const replay = await replayFor(disease, job);
  if (!replay) return NextResponse.json({ error: 'No replay' }, { status: 404 });
  return NextResponse.json(replay, { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
