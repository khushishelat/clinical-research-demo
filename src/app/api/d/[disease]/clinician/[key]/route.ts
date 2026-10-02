import { NextResponse } from 'next/server';
import { clinicianDetail } from '@/lib/space/detail';
import { loadSpace } from '@/lib/space/load';

// Profiles exist only for US clinicians verified in the NPI Registry.
export async function GET(_req: Request, ctx: RouteContext<'/api/d/[disease]/clinician/[key]'>) {
  const { disease, key } = await ctx.params;
  const space = await loadSpace(disease);
  const clinician = space ? clinicianDetail(space, decodeURIComponent(key)) : null;
  if (!clinician) return NextResponse.json({ error: 'No profile' }, { status: 404 });
  return NextResponse.json(clinician, { headers: { 'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
}
