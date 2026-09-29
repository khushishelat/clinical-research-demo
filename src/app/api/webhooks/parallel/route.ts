import { handleWebhook } from '@/lib/server/followups';
import { context, json } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** Monitor and Task webhooks, signed (Standard Webhooks). Verifies, de-duplicates, queues, and returns at once. */
export async function POST(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  const body = await request.text();
  const res = await handleWebhook(c, request.headers, body);
  return json(res.body, { status: res.status });
}
