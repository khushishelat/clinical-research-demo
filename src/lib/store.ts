// Server-only JSON documents. Private Vercel Blob when a Blob store is connected
// (production), a local folder (.data/, gitignored) otherwise, memory in tests.
// The pipeline writes here and the app reads from here; the repo ships no
// generated data.
//
// A connected store gives the project BLOB_STORE_ID, and Vercel supplies an OIDC
// token at runtime, so no secret is stored; an older store gives
// BLOB_READ_WRITE_TOKEN instead. Either one selects Blob.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

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

/** With no token, the Blob SDK uses BLOB_STORE_ID with Vercel's OIDC token. */
export function blobStore(token?: string): Store {
  const auth = token ? { token } : {};
  return {
    async get<T>(path: string) {
      const { get } = await import('@vercel/blob');
      try {
        const res = await get(path, { access: 'private', ...auth, useCache: false });
        if (!res || res.statusCode !== 200) return null;
        return JSON.parse(await new Response(res.stream).text()) as T;
      } catch (error) {
        if ((error as { name?: string }).name === 'BlobNotFoundError') return null;
        throw error;
      }
    },
    async put(path, data) {
      const { put } = await import('@vercel/blob');
      await put(path, JSON.stringify(data), { access: 'private', ...auth, allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json' });
    },
  };
}
