import { layoutLandscape, whatsNew } from '@/lib/domain/programs';
import { context, isKey, json, notFound } from '@/lib/server/http';
import { companyView } from '@/lib/server/pages';
import { requestState } from '@/lib/server/research';

export const dynamic = 'force-dynamic';

/** Latest pack for a company (storage, else the recorded fixture), with the derived landscape. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = context();
  if (c instanceof Response) return c;
  if (!isKey(key)) return notFound();
  const view = await companyView(c, key, { countView: true });
  if (!view) {
    const job = await requestState(c, key).catch(() => null);
    return job ? json({ key, pack: null, job: { phase: job.phase, taskgroup_id: job.taskgroup_id, started_at: job.started_at } }) : notFound('No research for this company yet.');
  }
  return json({ ...view, layout: layoutLandscape(view.pack), whats_new: whatsNew(view.pack, 8) });
}
