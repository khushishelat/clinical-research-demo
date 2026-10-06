// One Monitor per indication for daily news (base, ~$0.01 a day each).
//   npx tsx scripts/monitors.mts --disease mash --create     start it (backfills recent news)
//   npx tsx scripts/monitors.mts --disease mash --collect    read new events now (free)
//   npx tsx scripts/monitors.mts --disease mash --cancel     stop it
// The daily job creates the monitor for indications with `monitor: true` in
// diseases.json and collects events; it never cancels one. A monitor belongs to
// the workspace of the API key that created it.

import { disease, flag } from './lib/pipeline';
import { cancelMonitor, collectMonitorEvents, createMonitor } from './lib/steps/monitors';

const d = disease();
if (flag('create')) await createMonitor(d);
if (flag('collect')) await collectMonitorEvents(d);
if (flag('cancel')) await cancelMonitor(d);
