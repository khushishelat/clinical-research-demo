// The news Monitors for one indication (MONITOR in specs.ts: broad, by topic, and one per
// leading company; base, daily, $0.01 a run each).
//   npx tsx scripts/monitors.mts --disease mash --reconcile   create the missing ones, cancel unwanted ones
//   npx tsx scripts/monitors.mts --disease mash --trigger     run them all now ($0.01 each); --all for every indication
//   npx tsx scripts/monitors.mts --disease mash --collect     read new events now (free)
//   npx tsx scripts/monitors.mts --disease mash --report      what each monitor found, and what only it found
//   npx tsx scripts/monitors.mts --disease mash --cancel      stop them all
// The daily job reconciles and collects for indications with `monitor: true` in
// diseases.json. A monitor belongs to the workspace of the API key that created it.

import { readFileSync } from 'node:fs';
import { disease, flag, spacePath, store } from './lib/pipeline';
import { cancelMonitors, collectMonitorEvents, monitorReport, reconcileMonitors, triggerMonitors } from './lib/steps/monitors';

const config = JSON.parse(readFileSync('scripts/diseases.json', 'utf8')) as { diseases: { key: string; monitor?: boolean }[] };
const targets = flag('all') ? config.diseases.filter((x) => x.monitor).map((x) => disease(x.key)) : [disease()];
for (const d of targets) {
  if (!(await store.get(spacePath(d, 'trials.json')))) continue;
  if (flag('reconcile')) await reconcileMonitors(d);
  if (flag('trigger')) await triggerMonitors(d);
  if (flag('collect')) await collectMonitorEvents(d);
  if (flag('cancel')) await cancelMonitors(d);
  if (flag('report')) await report(d);
}

async function report(d: ReturnType<typeof disease>) {
  const r = await monitorReport(d);
  console.log(`[${d.key}] ${r.events} events since ${r.since?.slice(0, 10) ?? '—'}`);
  console.table(r.rows);
  // Set aside for review: a company found here but missing from the map may belong on it.
  for (const o of r.aside) console.log(`  aside · ${o.reason} · ${o.company ?? '—'} · ${o.headline}${o.source_url ? ` (${o.source_url})` : ''}`);
}
