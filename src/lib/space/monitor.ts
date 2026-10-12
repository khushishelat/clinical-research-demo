// The Monitor scorecard for one indication: what the news Monitors found since they
// started, how fast it reached the map, what each monitor contributed, what was set
// aside, and the latest weekly comparison with an independent research run.
// Server-only: reads the pipeline's monitor documents from storage.

import 'server-only';
import { hostOf } from './view';
import { appStore } from './load';

type Kept = { id: string; date: string; company: string; company_name: string; type: string; headline: string; source_url: string | null; found_by?: string[]; detected?: string };
type Aside = { reason: string; company: string | null; headline: string; date: string | null; source_url: string | null; monitor: string };
type Entry = { label: string; kind: string; created: string };
type Item = { date: string; company_name: string; type: string; headline: string; source_url: string | null; found_by?: string[]; detected?: string };
type Eval = { start: string; end: string; monitors_since: string | null; reference_total: number; off_map: Item[]; both: { monitor: Item; reference: Item }[]; monitor_only: Item[]; reference_only: Item[]; registry?: Item[]; before_monitors?: Item[]; recall: number | null; recall_n?: number; latency: { median: number | null; n: number } };

const days = (e: Kept) => (e.detected ? Math.max(0, (Date.parse(e.detected) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000) : null);
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export async function monitorScorecard(key: string) {
  const store = appStore();
  const get = <T>(f: string) => store.get<T>(`spaces/${key}/${f}`);
  const [doc, kept, aside, index] = await Promise.all([
    get<{ monitors: Record<string, Entry>; health?: { last_collected: string; last_new: string | null } }>('monitor.json'),
    get<Kept[]>('monitor-events.json'),
    get<Aside[]>('monitor-unmatched.json'),
    get<{ weeks: string[] }>('monitor-eval/index.json'),
  ]);
  if (!doc?.monitors) return null;
  const since = Object.values(doc.monitors).map((e) => e.created).sort()[0] ?? null;
  const label = (k: string) => doc.monitors[k]?.label ?? k;
  // Found by the current monitors: read since they started (earlier events came from v1).
  const found = (kept ?? []).filter((e) => e.detected && since && e.detected >= since);
  // Speed counts news announced after the monitors started (their first run returns a sample of older news).
  const forward = found.filter((e) => since && e.date >= since.slice(0, 10));
  const latency = median(forward.map(days).filter((x): x is number => x != null));
  const monitors = Object.entries(doc.monitors)
    .map(([k, e]) => ({ key: k, label: e.label, kind: e.kind, found: found.filter((x) => x.found_by?.includes(k)).length, only: found.filter((x) => x.found_by?.length === 1 && x.found_by[0] === k).length }))
    .sort((a, b) => b.found - a.found || a.label.localeCompare(b.label));
  const reasons = (aside ?? []).reduce((m: Record<string, number>, a) => ((m[a.reason] = (m[a.reason] ?? 0) + 1), m), {});
  const evalDoc = index?.weeks?.[0] ? await get<Eval>(`monitor-eval/${index.weeks[0]}.json`) : null;
  const card = (e: Item) => ({ date: e.date, company: e.company_name, headline: e.headline, source: e.source_url, host: hostOf(e.source_url), by: (e.found_by ?? []).map(label) });
  return {
    since,
    checked: doc.health?.last_collected ?? null,
    count: Object.keys(doc.monitors).length,
    kinds: Object.values(doc.monitors).reduce((m: Record<string, number>, e) => ((m[e.kind] = (m[e.kind] ?? 0) + 1), m), {}),
    found: found.length,
    latency,
    latencyN: forward.length,
    monitors,
    latest: [...found].sort((a, b) => (b.detected ?? '').localeCompare(a.detected ?? '')).slice(0, 8).map((e) => ({ ...card(e), detected: e.detected!, after: days(e) })),
    aside: { reasons, examples: (aside ?? []).filter((a) => a.reason !== 'no_date').slice(0, 6).map((a) => ({ reason: a.reason, company: a.company, headline: a.headline, source: a.source_url, host: hostOf(a.source_url), monitor: label(a.monitor) })) },
    week: evalDoc
      ? {
          start: evalDoc.start,
          end: evalDoc.end,
          partial: Boolean(evalDoc.monitors_since && evalDoc.monitors_since > evalDoc.start),
          recall: evalDoc.recall,
          recallN: evalDoc.recall_n ?? 0,
          both: evalDoc.both.map((b) => card({ ...b.monitor, source_url: b.monitor.source_url ?? b.reference.source_url })),
          monitorOnly: evalDoc.monitor_only.map(card),
          missed: evalDoc.reference_only.map(card),
          offMap: evalDoc.off_map.length,
          registry: evalDoc.registry?.length ?? 0,
          before: (evalDoc.before_monitors ?? []).map(card),
          since: evalDoc.monitors_since,
        }
      : null,
  };
}

export type MonitorScorecard = NonNullable<Awaited<ReturnType<typeof monitorScorecard>>>;
