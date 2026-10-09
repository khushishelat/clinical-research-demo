// The news Monitors for one indication (MONITOR in specs.ts: broad, by topic, and one per
// leading company; base, daily, $0.01 a run each).
//   npx tsx scripts/monitors.mts --disease mash --reconcile   create the missing ones, cancel unwanted ones
//   npx tsx scripts/monitors.mts --disease mash --collect     read new events now (free)
//   npx tsx scripts/monitors.mts --disease mash --report      what each monitor found, and what only it found
//   npx tsx scripts/monitors.mts --disease mash --cancel      stop them all
// The daily job reconciles and collects for indications with `monitor: true` in
// diseases.json. A monitor belongs to the workspace of the API key that created it.

import { disease, flag } from './lib/pipeline';
import { cancelMonitors, collectMonitorEvents, monitorReport, reconcileMonitors } from './lib/steps/monitors';

const d = disease();
if (flag('reconcile')) await reconcileMonitors(d);
if (flag('collect')) await collectMonitorEvents(d);
if (flag('cancel')) await cancelMonitors(d);
if (flag('report')) {
  const r = await monitorReport(d);
  console.log(`[${d.key}] ${r.events} events since ${r.since?.slice(0, 10) ?? '—'}`);
  console.table(r.rows);
  // Set aside for review: a company found here but missing from the map may belong on it.
  for (const o of r.aside) console.log(`  aside · ${o.reason} · ${o.company ?? '—'} · ${o.headline}${o.source_url ? ` (${o.source_url})` : ''}`);
}
