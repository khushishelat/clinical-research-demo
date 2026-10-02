import { datasetCsv, datasetView } from '@/lib/space/dataset';
import { loadSpace } from '@/lib/space/load';

export async function GET(_req: Request, ctx: RouteContext<'/api/d/[disease]/export'>) {
  const { disease } = await ctx.params;
  const space = await loadSpace(disease);
  if (!space) return new Response('Not built', { status: 404 });
  return new Response(datasetCsv(datasetView(space)), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="trial-check-${disease}.csv"`, 'cache-control': 'public, s-maxage=3600' },
  });
}
