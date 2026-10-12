// Weekly monitor evaluation: the news Monitors' finds for a week against an independent
// reference (REFERENCE, ultra, sources published that week only). For each indication
// and week it stores what both found, what only the monitors found, what only the
// reference found, each monitor's finds, and how fast monitor news reached the map.
// It is how we say what Monitor catches, what it misses, and which monitors to keep.
//   spaces/<d>/monitor-eval/<start>.json, and monitor-eval/index.json

import type { Company } from '../../../src/lib/space/types';
import { log, parallel, runLog, runOnce, spacePath, store, type Disease } from '../pipeline';
import { REFERENCE } from '../specs';
import { companyMatcher, monitorOf, sameEvent, type MonitorEvent } from './monitors';

export type EvalItem = { date: string; company: string; company_name: string; type: string; headline: string; source_url: string | null; drug?: string | null; found_by?: string[]; detected?: string };
export type MonitorEval = {
  start: string;
  end: string;
  built: string;
  reference_run: string;
  /** Monitors live for the whole week? The first week includes their creation. */
  monitors_since: string | null;
  reference_total: number;
  /** Reference finds about companies not on the map (a gap in the map, not in the monitors). */
  off_map: EvalItem[];
  both: { monitor: EvalItem; reference: EvalItem }[];
  monitor_only: EvalItem[];
  reference_only: EvalItem[];
  /** Reference finds from ClinicalTrials.gov (registrations, status changes): the daily registry pull's job, not the monitors'. */
  registry: EvalItem[];
  /** Reference finds announced before the monitors started (their first run returns only a sample of older news). */
  before_monitors: EvalItem[];
  /** Of the reference's finds about companies on the map, announced while the monitors were live and not from the registry, the share the monitors also found. */
  recall: number | null;
  /** What recall is out of: reference finds scored. */
  recall_n: number;
  /** Days from announcement to the app reading it, for news announced after the monitors started. */
  latency: { median: number | null; n: number };
  by_monitor: { key: string; label: string; kind: string; found: number; only_monitor: number }[];
};

const quantile = (xs: number[], q: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);
const item = (e: Omit<EvalItem, 'company_name'> & { company_name?: string }, name: string): EvalItem => ({ date: e.date, company: e.company, company_name: e.company_name ?? name, type: e.type, headline: e.headline, source_url: e.source_url, drug: e.drug ?? null, ...(e.found_by ? { found_by: e.found_by } : {}), ...(e.detected ? { detected: e.detected } : {}) });

/** Evaluates the week from `start` to `end` (inclusive). Returns null without an API key. */
export async function monitorEvalStep(d: Disease, start: string, end: string): Promise<MonitorEval | null> {
  const client = parallel(d, 'monitor evaluation');
  if (!client) return null;
  const doc = await monitorOf(d);
  const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
  const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
  const included = new Set(review.filter((r) => r.include).map((r) => r.company));
  const rows = companies.filter((c) => !c.web_only || included.has(c.name));
  const kept = (await store.get<MonitorEvent[]>(spacePath(d, 'monitor-events.json'))) ?? [];
  const inWeek = (date: string) => date >= start && date <= end;

  // The reference: one deep research run over the week, sources published from its first day.
  const rl = await runLog(d, 'monitor-eval');
  const leaders = [...rows].sort((a, b) => b.trials.length - a.trials.length).slice(0, 30).map((c) => c.name);
  const rec = await runOnce(client, rl, `${REFERENCE.key}:${start}`, { processor: REFERENCE.processor, schema: REFERENCE.schema, input: REFERENCE.input(d, start, end, leaders), metadata: { job: 'monitor-eval', disease: d.key, week: start }, source_policy: { after_date: start } });
  if (!rec.content) {
    log(d, `monitor evaluation: reference run ${rec.run_id} ${rec.status}`);
    return null;
  }
  const match = companyMatcher(rows);
  const reference = ((rec.content as { events?: any[] }).events ?? []).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '') && inWeek(e.date));
  const onMap: EvalItem[] = [];
  const offMap: EvalItem[] = [];
  for (const e of reference) {
    const c = match(e.company ?? null, e.drug ?? null);
    (c ? onMap : offMap).push(item({ date: e.date, company: c?.key ?? '', type: e.type ?? 'other', headline: String(e.headline ?? ''), source_url: e.source_url ?? null, drug: e.drug ?? null }, c?.name ?? e.company ?? ''));
  }

  const monitor = kept.filter((e) => inWeek(e.date)).map((e) => item(e, e.company_name));
  const since = Object.values(doc?.monitors ?? {}).map((e) => e.created.slice(0, 10)).sort()[0] ?? null;
  const both: MonitorEval['both'] = [];
  const unmatched = new Set(monitor);
  const referenceOnly: EvalItem[] = [];
  const registry: EvalItem[] = [];
  const before: EvalItem[] = [];
  for (const r of onMap) {
    if (/clinicaltrials\.gov/.test(r.source_url ?? '')) {
      registry.push(r);
      continue;
    }
    const m = monitor.find((x) => unmatched.has(x) && sameEvent(x, r));
    if (m) {
      unmatched.delete(m);
      both.push({ monitor: m, reference: r });
    } else if (since && r.date < since) before.push(r);
    else referenceOnly.push(r);
  }
  const monitorOnly = monitor.filter((m) => unmatched.has(m));
  // Recall over the days the monitors were live.
  const live = (e: EvalItem) => !since || e.date >= since;
  const liveBoth = both.filter((b) => live(b.reference)).length;
  const days = kept.filter((e) => e.detected && since && e.date >= since && inWeek(e.date)).map((e) => Math.max(0, (Date.parse(e.detected) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000));
  const result: MonitorEval = {
    start,
    end,
    built: new Date().toISOString(),
    reference_run: rec.run_id,
    monitors_since: since,
    reference_total: reference.length,
    off_map: offMap,
    both,
    monitor_only: monitorOnly,
    reference_only: referenceOnly,
    registry,
    before_monitors: before,
    recall: liveBoth + referenceOnly.length ? liveBoth / (liveBoth + referenceOnly.length) : null,
    recall_n: liveBoth + referenceOnly.length,
    latency: { median: quantile(days, 0.5), n: days.length },
    by_monitor: Object.entries(doc?.monitors ?? {}).map(([key, e]) => ({ key, label: e.label, kind: e.kind, found: monitor.filter((m) => m.found_by?.includes(key)).length, only_monitor: monitorOnly.filter((m) => m.found_by?.includes(key)).length })),
  };
  await store.put(spacePath(d, `monitor-eval/${start}.json`), result);
  const index = (await store.get<{ weeks: string[] }>(spacePath(d, 'monitor-eval/index.json'))) ?? { weeks: [] };
  await store.put(spacePath(d, 'monitor-eval/index.json'), { weeks: [...new Set([...index.weeks, start])].sort().reverse() });
  log(d, `monitor evaluation ${start}…${end}: reference ${reference.length} (${offMap.length} off the map, ${registry.length} from the registry, ${before.length} before the monitors started) · both ${both.length} · only monitors ${monitorOnly.length} · only reference ${referenceOnly.length} · recall while live ${result.recall == null ? '—' : `${Math.round(result.recall * 100)}%`} · median ${result.latency.median?.toFixed(1) ?? '—'} days to the map`);
  return result;
}

/** The seven days ending yesterday: on a Monday, last Monday to Sunday. */
export function lastWeek(now = new Date()): { start: string; end: string } {
  const day = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
  return { start: day(7), end: day(1) };
}
