import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appRoot } from '@/lib/server/context';
import { isKey, json, notFound } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

/** The recorded run's compact event log (fixtures/replay/<key>.json). No API calls. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!isKey(key)) return notFound();
  try {
    const body = await readFile(join(appRoot, 'fixtures/replay', `${key}.json`), 'utf8');
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
  } catch {
    return json({ error: 'No recorded replay for this company.' }, { status: 404 });
  }
}
