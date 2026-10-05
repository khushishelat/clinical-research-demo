// Step 8: "on the web N days earlier". For trials registered in the last 90
// days, one base run finds the first public announcement that refers to that
// trial (a plan to run "a Phase 3" doesn't count); the tag shows only when it
// came before the registry.
//   npx tsx scripts/08-first-seen.mts --disease mash

import { disease } from './lib/pipeline';
import { firstSeenStep } from './lib/steps/first-seen';

await firstSeenStep(disease());
