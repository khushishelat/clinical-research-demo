import { context, notFound, sse } from '@/lib/server/http';
import { streamRun } from '@/lib/server/stream';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Live run events as server-sent events. EventSource reconnects with Last-Event-ID; the stream resumes there. */
export async function GET(request: Request, { params }: { params: Promise<{ gid: string }> }) {
  const { gid } = await params;
  const c = context();
  if (c instanceof Response) return c;
  if (!c.parallel || !/^tgrp_[a-z0-9]{8,64}$/.test(gid)) return notFound();
  const group = await c.parallel.taskGroup.retrieve(gid).catch(() => null);
  const meta = (group?.metadata ?? {}) as Record<string, unknown>;
  if (!group || meta.app !== 'trial-check' || typeof meta.company !== 'string') return notFound();
  const lastEventId = request.headers.get('last-event-id') ?? new URL(request.url).searchParams.get('last_event_id');
  const client = c.parallel;
  return sse((send, signal) => streamRun(c, client, gid, meta.company as string, lastEventId, send, signal), request.signal);
}
