// Server-only. Small helpers shared by the route handlers.

import { ctx, type Context } from './context';
import { SettingsError } from './settings';

export const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, { ...init, headers: { 'cache-control': 'no-store', ...(init.headers ?? {}) } });

export const notFound = (what = 'Not found') => json({ error: what }, { status: 404 });
export const badRequest = (what: string) => json({ error: what }, { status: 400 });

/** Builds the context, turning a configuration error into a clear 500 instead of a stack trace. */
export function context(): Context | Response {
  try {
    return ctx();
  } catch (error) {
    if (error instanceof SettingsError) return json({ error: error.message }, { status: 500 });
    throw error;
  }
}

export const isKey = (key: string) => /^[a-z0-9-]{1,60}$/.test(key);

/** Server-sent events from an async iterable. Each item becomes one `data:` message; `id` sets the resume cursor. */
export function sse(source: (send: (data: unknown, id?: string) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (data: unknown, id?: string) => {
        if (!open) return;
        controller.enqueue(encoder.encode(`${id ? `id: ${id}\n` : ''}data: ${JSON.stringify(data)}\n\n`));
      };
      // Keeps proxies from closing an idle stream while runs are working.
      const ping = setInterval(() => open && controller.enqueue(encoder.encode(': ping\n\n')), 15_000);
      try {
        await source(send, signal);
      } catch (error) {
        send({ type: 'error', message: String((error as Error).message ?? error).slice(0, 200) });
      } finally {
        open = false;
        clearInterval(ping);
        controller.close();
      }
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
