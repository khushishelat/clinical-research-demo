import { isCronRequest } from '@/lib/server/guards';
import { context, json } from '@/lib/server/http';
import { refreshTick } from '@/lib/server/refresh';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Weekly re-run, one step per call (vercel.json runs it every 15 minutes on Mondays). */
export async function GET(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  if (!isCronRequest(request, c.settings.cronSecret)) return json({ error: 'unauthorized' }, { status: 401 });
  return json(await refreshTick(c));
}
