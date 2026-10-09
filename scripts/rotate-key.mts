// After the Parallel API key changes. Finished research is stored, so nothing needs
// the old key except monitors: one created with the old key keeps running (and
// billing) where the new key can't see or read it. This cancels each indication's
// old monitors with the old key and makes sure every indication with `monitor: true`
// has one the new key can read. Keys come from your shell, never from a file:
//   export OLD_PARALLEL_API_KEY=…   PARALLEL_API_KEY=…   (the new key)
//   npx tsx --env-file=.env.vercel scripts/rotate-key.mts [--dry-run]

import { readFileSync } from 'node:fs';
import Parallel from 'parallel-web';
import { disease, spacePath, store } from './lib/pipeline';
import { createMonitor, monitorOf } from './lib/steps/monitors';

const dry = process.argv.includes('--dry-run');
const oldKey = process.env.OLD_PARALLEL_API_KEY?.trim();
const newKey = process.env.PARALLEL_API_KEY?.trim();
if (!newKey) throw new Error('Set PARALLEL_API_KEY to the new key.');
const fresh = new Parallel({ apiKey: newKey, maxRetries: 0 });
const old = oldKey ? new Parallel({ apiKey: oldKey, maxRetries: 0 }) : null;
const visible = async (client: Parallel, id: string) => client.monitor.retrieve(id).then(() => true, (e: { status?: number }) => (e.status === 404 ? false : Promise.reject(e)));

const config = JSON.parse(readFileSync('scripts/diseases.json', 'utf8')) as { diseases: { key: string; monitor?: boolean }[] };
for (const { key, monitor } of config.diseases) {
  if (!monitor || !(await store.get(spacePath(disease(key), 'trials.json')))) continue;
  const d = disease(key);
  const doc = await monitorOf(d);
  const current = doc && !doc.cancelled ? doc.monitor_id : null;
  const currentOk = current ? await visible(fresh, current) : false;
  // Old monitors: replaced ones, plus the current one if the new key can't see it.
  const stale = [...new Set([...(doc?.previous ?? []), ...(current && !currentOk ? [current] : [])])].filter((id) => !(doc as any)?.cancelled_previous?.includes(id));
  const cancelled: string[] = [];
  for (const id of stale) {
    if (!old) {
      console.log(`[${key}] ${id} needs cancelling with the old key (set OLD_PARALLEL_API_KEY)`);
      continue;
    }
    if (!(await visible(old, id))) {
      console.log(`[${key}] ${id} isn't visible to the old key either; skipped`);
      continue;
    }
    if (dry) console.log(`[${key}] would cancel ${id} with the old key`);
    else {
      await old.monitor.cancel(id);
      cancelled.push(id);
      console.log(`[${key}] cancelled ${id} with the old key`);
    }
  }
  if (cancelled.length) {
    const latest = await monitorOf(d);
    await store.put(spacePath(d, 'monitor.json'), { ...latest, cancelled_previous: [...((latest as any)?.cancelled_previous ?? []), ...cancelled] });
  }
  if (currentOk) console.log(`[${key}] current monitor ${current} is readable with the new key`);
  else if (dry) console.log(`[${key}] would create a monitor with the new key`);
  else {
    if (doc && current) await store.put(spacePath(d, 'monitor.json'), { ...(await monitorOf(d)), lost: new Date().toISOString() });
    const made = await createMonitor(d);
    console.log(`[${key}] monitor ${made?.monitor_id} created with the new key`);
  }
}
