import { NextResponse } from 'next/server';
import { CACHED } from '@/lib/space/http';
import { briefFor, loadSpace } from '@/lib/space/load';

// One issue of the weekly brief (the latest unless ?issue=YYYY-MM-DD names another).
export async function GET(req: Request, ctx: RouteContext<'/api/d/[disease]/brief'>) {
  const { disease } = await ctx.params;
  const space = await loadSpace(disease);
  if (!space?.briefs.length) return NextResponse.json({ error: 'No brief' }, { status: 404 });
  const asked = new URL(req.url).searchParams.get('issue');
  const issue = asked && space.briefs.includes(asked) ? asked : space.briefs[0];
  const brief = await briefFor(disease, issue);
  if (!brief) return NextResponse.json({ error: 'No brief' }, { status: 404 });
  return NextResponse.json(brief, { headers: CACHED });
}
