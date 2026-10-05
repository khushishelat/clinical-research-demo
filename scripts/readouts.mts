// Check trials that have reached a readout point since their company was researched.
// The daily cron job runs this; it is here to run by hand too.
//   npx tsx scripts/readouts.mts --disease mash

import { disease } from './lib/pipeline';
import { readoutsStep } from './lib/steps/readouts';

await readoutsStep(disease());
