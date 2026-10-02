import { NextResponse } from 'next/server';
import { CACHED } from '@/lib/space/http';
import { basisFor } from '@/lib/space/load';

// Per-field citations, reasoning and confidence from the company's Task run.
export async function GET(_req: Request, ctx: RouteContext<'/api/d/[disease]/basis/[company]'>) {
  const { disease, company } = await ctx.params;
  const basis = await basisFor(disease, decodeURIComponent(company));
  if (!basis) return NextResponse.json({ error: 'No basis' }, { status: 404 });
  return NextResponse.json(basis, { headers: CACHED });
}
