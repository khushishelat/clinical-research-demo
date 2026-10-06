// Step 9: the weekly brief, a deep-research Task run (ultra2x, text output, the
// ClinicalTrials.gov and PubMed connectors). It starts from the week's known
// events (registry changes, the pipeline's disclosures, catalysts due in the
// next 30 days), keeps the material ones, and researches what they miss. The
// run is recorded live, so the brief can show how it was made.
//   npx tsx scripts/09-brief.mts --disease mash [--days 14]

import { disease } from './lib/pipeline';
import { briefStep } from './lib/steps/brief';

const i = process.argv.indexOf('--days');
await briefStep(disease(), i > 0 ? Number(process.argv[i + 1]) : 7);
