import { eventsFor } from '@/lib/server/followups';
import { context, isKey, json, notFound } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Monitor events for What's new, newest first. Pages read our store; only webhooks and cron touch the Monitor API. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = context();
  if (c instanceof Response) return c;
  if (!isKey(key)) return notFound();
  return json({ key, events: await eventsFor(c, key) });
}
