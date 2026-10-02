// Server-only JSON documents. Private Vercel Blob when BLOB_READ_WRITE_TOKEN is
// set (production), a local folder (.data/, gitignored) otherwise, memory in
// tests. The pipeline writes here and the app reads from here; the repo ships
// no generated data.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface Store {
  get<T>(path: string): Promise<T | null>;
  put(path: string, data: unknown): Promise<void>;
}

export function memoryStore(seed: Record<string, unknown> = {}): Store & { dump(): Record<string, unknown> } {
  const docs = new Map<string, string>(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    async get<T>(path: string) {
      const raw = docs.get(path);
      return raw ? (JSON.parse(raw) as T) : null;
    },
    async put(path, data) {
      docs.set(path, JSON.stringify(data));
    },
    dump: () => Object.fromEntries([...docs].map(([k, v]) => [k, JSON.parse(v)])),
  };
}

export function folderStore(root: string): Store {
  return {
    async get<T>(path: string) {
      try {
        return JSON.parse(await readFile(join(root, path), 'utf8')) as T;
      } catch {
        return null;
      }
    },
    async put(path, data) {
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(data));
    },
  };
}

export function blobStore(token: string): Store {
  return {
    async get<T>(path: string) {
      const { get } = await import('@vercel/blob');
      try {
        const res = await get(path, { access: 'private', token, useCache: false });
        if (!res || res.statusCode !== 200) return null;
        return JSON.parse(await new Response(res.stream).text()) as T;
      } catch (error) {
        if ((error as { name?: string }).name === 'BlobNotFoundError') return null;
        throw error;
      }
    },
    async put(path, data) {
      const { put } = await import('@vercel/blob');
      await put(path, JSON.stringify(data), { access: 'private', token, allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
    },
  };
}
