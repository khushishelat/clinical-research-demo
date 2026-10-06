// Step 6: one event list per indication, built in code (no model): disclosures
// from step 4 (milestones, deals, financings, approvals, regulatory events),
// registry events from the daily diffs, and Monitor events when they arrive.
// Plus guided catalysts and monthly registration counts. Events keep the trial
// ID the research run gave, so the map and drawers join on it exactly.
//   npx tsx scripts/06-events.mts --disease mash

import { disease } from './lib/pipeline';
import { eventsStep } from './lib/steps/events';

await eventsStep(disease());
