// Server-only. Counters, locks, caches and the follow-up queue. Upstash Redis
// over its REST API in production (no extra dependency); an in-memory store
// for local development, fixture mode and tests.

export interface Kv {
  get(key: string): Promise<string | null>;
  /** Returns false when `nx` is set and the key already exists. */
  set(key: string, value: string, opts?: { exSeconds?: number; nx?: boolean }): Promise<boolean>;
  incrByFloat(key: string, amount: number, exSeconds: number): Promise<number>;
  del(key: string): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  rpop(key: string): Promise<string | null>;
}

export function memoryKv(now: () => number = Date.now): Kv {
  const data = new Map<string, { value: string; expires: number | null }>();
  const lists = new Map<string, string[]>();
  const live = (key: string) => {
    const hit = data.get(key);
    if (hit && hit.expires !== null && hit.expires <= now()) data.delete(key);
    return data.get(key) ?? null;
  };
  return {
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, opts = {}) {
      if (opts.nx && live(key)) return false;
      data.set(key, { value, expires: opts.exSeconds ? now() + opts.exSeconds * 1000 : null });
      return true;
    },
    async incrByFloat(key, amount, exSeconds) {
      const current = Number(live(key)?.value ?? 0) + amount;
      const expires = live(key)?.expires ?? now() + exSeconds * 1000;
      data.set(key, { value: String(current), expires });
      return current;
    },
    async del(key) {
      data.delete(key);
      lists.delete(key);
    },
    async lpush(key, value) {
      lists.set(key, [value, ...(lists.get(key) ?? [])]);
    },
    async rpop(key) {
      const list = lists.get(key) ?? [];
      const value = list.pop() ?? null;
      lists.set(key, list);
      return value;
    },
  };
}

export function upstashKv(url: string, token: string, fetchImpl: typeof fetch = fetch): Kv {
  const pipeline = async (commands: (string | number)[][]): Promise<any[]> => {
    const res = await fetchImpl(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    const failed = out.find((o) => o.error);
    if (failed) throw new Error(`Upstash: ${failed.error}`);
    return out.map((o) => o.result);
  };
  return {
    async get(key) {
      const [v] = await pipeline([['GET', key]]);
      return (v as string | null) ?? null;
    },
    async set(key, value, opts = {}) {
      const cmd: (string | number)[] = ['SET', key, value];
      if (opts.exSeconds) cmd.push('EX', opts.exSeconds);
      if (opts.nx) cmd.push('NX');
      const [v] = await pipeline([cmd]);
      return v === 'OK';
    },
    async incrByFloat(key, amount, exSeconds) {
      const [v] = await pipeline([
        ['INCRBYFLOAT', key, amount],
        ['EXPIRE', key, exSeconds, 'NX'],
      ]);
      return Number(v);
    },
    async del(key) {
      await pipeline([['DEL', key]]);
    },
    async lpush(key, value) {
      await pipeline([['LPUSH', key, value]]);
    },
    async rpop(key) {
      const [v] = await pipeline([['RPOP', key]]);
      return (v as string | null) ?? null;
    },
  };
}
