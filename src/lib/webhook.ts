// Standard Webhooks signatures, as Parallel signs webhooks (docs: Webhook Setup):
// HMAC-SHA256 over "<webhook-id>.<webhook-timestamp>.<body>", keyed by the account's
// secret Base64-decoded after its "whsec_" prefix; the header may hold several
// space-separated "v1,<signature>" entries while a secret is rotated.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function signed(secret: string, id: string, timestamp: string, body: string, header: string): boolean {
  if (!id || !timestamp || !header) return false;
  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const expected = Buffer.from(createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64'));
  return header.split(' ').some((part) => {
    const sig = Buffer.from(part.split(',', 2)[1] ?? '');
    return sig.length === expected.length && timingSafeEqual(sig, expected);
  });
}
