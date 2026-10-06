// Copy indications built locally (.data/spaces/<key>/) into private Vercel Blob,
// where a deployment reads them. Run logs and lookup caches go too, so a later
// pipeline run against Blob reuses finished runs instead of paying for them again.
// Local backups (facts.v0.json and the like) stay behind.
// Credentials come from the project: `vercel env pull .env.vercel --environment=production`
// gives BLOB_STORE_ID and a short-lived OIDC token (or BLOB_READ_WRITE_TOKEN on older stores).
//   npm run sync-blob                    (every built indication)
//   npm run sync-blob -- --disease mash

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { blobConfigured, blobStore } from '../src/lib/store';
import { pool } from './lib/pipeline';

if (!blobConfigured()) throw new Error('No Blob store: run `vercel env pull .env.vercel --environment=production` in a linked checkout first.');
const root = join(process.cwd(), '.data');
const i = process.argv.indexOf('--disease');
const only = i > 0 ? process.argv[i + 1] : null;
const keys = only ? [only] : (await readdir(join(root, 'spaces'), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.name.endsWith('.json') && !/\.[a-z0-9]+\.json$/i.test(e.name)) out.push(p);
  }
  return out;
}

const blob = blobStore(process.env.BLOB_READ_WRITE_TOKEN);
for (const key of keys) {
  const files = await walk(join(root, 'spaces', key));
  let bytes = 0;
  await pool(files, 8, async (file) => {
    const raw = await readFile(file, 'utf8');
    bytes += raw.length;
    await blob.put(relative(root, file), JSON.parse(raw));
  });
  console.log(`[${key}] ${files.length} documents, ${(bytes / 1e6).toFixed(1)} MB → Vercel Blob`);
}
