// Remove a clinician who asked: drops them from every built disease now, and
// records a hash of their key so future builds skip them too.
//   npm run remove-clinician -- "Jane Roe"            (lists matches)
//   npm run remove-clinician -- "Jane Roe" --yes      (removes them)

import { cleanName, sameName } from './lib/clinicians';
import { store } from './lib/pipeline';
import { addRemoved } from './lib/removed';

const name = process.argv[2];
if (!name || name.startsWith('--')) throw new Error('Usage: npm run remove-clinician -- "First Last" [--yes]');
const yes = process.argv.includes('--yes');
const { diseases } = JSON.parse((await import('node:fs')).readFileSync('scripts/diseases.json', 'utf8'));
const keys: string[] = [];
for (const d of diseases) {
  const path = `spaces/${d.key}/clinicians.json`;
  const doc = await store.get<{ clinicians: { key: string; aliases?: string[]; name: string; city: string | null; state: string | null; country: string | null }[] }>(path);
  if (!doc) continue;
  const hits = doc.clinicians.filter((c) => sameName(c.name, cleanName(name)));
  for (const c of hits) console.log(`[${d.key}] ${c.name} · ${[c.city, c.state, c.country].filter(Boolean).join(', ')}`);
  if (!yes || !hits.length) continue;
  keys.push(...hits.flatMap((c) => [c.key, ...(c.aliases ?? [])]));
  await store.put(path, { ...doc, clinicians: doc.clinicians.filter((c) => !hits.includes(c)) });
}
if (!yes) console.log('Nothing removed. Add --yes to remove everyone listed.');
else if (keys.length) {
  addRemoved(keys);
  console.log(`Removed ${keys.length} record key(s); scripts/removed.json now skips them in future builds. Commit that file.`);
} else console.log('No match.');
