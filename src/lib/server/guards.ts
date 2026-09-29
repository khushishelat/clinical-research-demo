// Server-only. Spend and abuse guards. Viewers never see prices; these caps
// keep our key's daily spend bounded (BACKEND-DESIGN.md "Budget").

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Kv } from './kv';

const DAY_SECONDS = 26 * 60 * 60;
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Reserves `usd` against today's cap for a bucket. Returns false (and
 * reserves nothing) when the reservation would exceed the cap.
 */
export async function reserveBudget(kv: Kv, bucket: string, usd: number, capUsd: number, now = new Date()): Promise<boolean> {
  const key = `budget:${bucket}:${today(now)}`;
  const total = await kv.incrByFloat(key, usd, DAY_SECONDS);
  if (total > capUsd + 1e-9) {
    await kv.incrByFloat(key, -usd, DAY_SECONDS);
    return false;
  }
  return true;
}

/** Per-client daily limit. Returns false once `limit` requests were made today. */
export async function allowRequest(kv: Kv, bucket: string, client: string, limit: number, now = new Date()): Promise<boolean> {
  const count = await kv.incrByFloat(`rate:${bucket}:${client}:${today(now)}`, 1, DAY_SECONDS);
  return count <= limit;
}

/** Best-effort client identifier for rate limits. Never stored beyond the daily counter. */
export function clientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}

/**
 * Standard Webhooks verification, as Parallel signs webhooks
 * (docs.parallel.ai/resources/webhook-setup): HMAC-SHA256 over
 * `<webhook-id>.<webhook-timestamp>.<raw body>`, key = base64-decoded secret
 * without its `whsec_` prefix, header `v1,<base64>` (space-separated list).
 */
export function verifyWebhook(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  return signature.split(' ').some((part) => {
    const [, sig] = part.split(',', 2);
    if (!sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. */
export function isCronRequest(request: Request, cronSecret: string): boolean {
  return Boolean(cronSecret) && request.headers.get('authorization') === `Bearer ${cronSecret}`;
}
