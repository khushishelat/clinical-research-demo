// Score the news Monitors for a week against an independent reference run (ultra, $0.30).
//   npx tsx scripts/monitor-eval.mts --disease obesity [--start 2026-10-05 --end 2026-10-11]
//   npx tsx scripts/monitor-eval.mts --all
// Without dates: the seven days ending yesterday. The weekly cron does the same on Mondays.

import { readFileSync } from 'node:fs';
import { disease, flag } from './lib/pipeline';
import { lastWeek, monitorEvalStep } from './lib/steps/monitor-eval';

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const week = lastWeek();
const start = arg('start') ?? week.start;
const end = arg('end') ?? week.end;
const config = JSON.parse(readFileSync('scripts/diseases.json', 'utf8')) as { diseases: { key: string; monitor?: boolean }[] };
const targets = flag('all') ? config.diseases.filter((x) => x.monitor).map((x) => disease(x.key)) : [disease()];
await Promise.all(targets.map((d) => monitorEvalStep(d, start, end).catch((e) => console.error(`[${d.key}] ${(e as Error).message}`))));
