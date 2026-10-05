// One Monitor per indication for daily news (base, ~$0.01 a day each).
//   npx tsx scripts/monitors.mts --disease mash --create     start it (backfills recent news)
//   npx tsx scripts/monitors.mts --disease mash --collect    read new events now (free)
//   npx tsx scripts/monitors.mts --disease mash --cancel     stop it
// The daily cron job collects events; it never creates or cancels monitors.

import { disease, flag } from './lib/pipeline';
import { cancelMonitor, collectMonitorEvents, createMonitor } from './lib/steps/monitors';

const d = disease();
if (flag('create')) await createMonitor(d);
if (flag('collect')) await collectMonitorEvents(d);
if (flag('cancel')) await cancelMonitor(d);
