// Put trials that are on no company row onto the right one (steps/attach.ts). The daily
// job runs this after the registry pull; run it by hand after changing the rules.
//   npx tsx scripts/attach.mts --disease obesity [--dry-run]   --all for every built indication

import { readFileSync } from 'node:fs';
import { disease, flag, spacePath, store } from './lib/pipeline';
import { attachStep } from './lib/steps/attach';

const config = JSON.parse(readFileSync('scripts/diseases.json', 'utf8')) as { diseases: { key: string }[] };
for (const d of flag('all') ? config.diseases.map((x) => disease(x.key)) : [disease()]) {
  if (await store.get(spacePath(d, 'trials.json'))) await attachStep(d, { dry: flag('dry-run') });
}
