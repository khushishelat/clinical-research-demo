// Step 2: every active drug trial for a disease, from the ClinicalTrials.gov
// API (free, no key). Writes today's snapshot, the latest copy, and registry
// events (new trials, status and phase changes) from the diff with the last
// snapshot.
//   npx tsx scripts/02-registry.mts --disease mash

import { disease } from './lib/pipeline';
import { registryStep } from './lib/steps/registry';

await registryStep(disease());
