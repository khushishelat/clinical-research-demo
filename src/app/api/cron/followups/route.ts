import { drainFollowups } from '@/lib/server/followups';
import { isCronRequest } from '@/lib/server/guards';
import { context, json } from '@/lib/server/http';
import { sweepRequests } from '@/lib/server/research';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Every 15 minutes: Monitor follow-ups, then any research request nobody is watching. */
export async function GET(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  if (!isCronRequest(request, c.settings.cronSecret)) return json({ error: 'unauthorized' }, { status: 401 });
  const followups = await drainFollowups(c);
  const requests = await sweepRequests(c);
  return json({ followups, requests });
}
