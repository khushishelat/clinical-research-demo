// Internal: how the news Monitors are doing, per indication. What they found since they
// started and how fast it reached the map, each monitor's finds and finds no other monitor
// had, what they set aside, and the latest weekly comparison with an independent research
// sweep (steps/monitor-eval.ts, Mondays). Prints Markdown; --out writes it to a file.
//   npx tsx --env-file=.env.vercel scripts/monitor-report.mts [--disease obesity] [--out report.md]

import { readFileSync, writeFileSync } from 'node:fs';
import { disease, flag, spacePath, store, type Disease } from './lib/pipeline';
import type { MonitorEval } from './lib/steps/monitor-eval';
import { monitorOf, type MonitorEvent } from './lib/steps/monitors';

type Aside = { reason: string; company: string | null; headline: string; source_url: string | null; monitor: string };
const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const fmt = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—');
const speed = (d: number | null) => (d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${d.toFixed(1)}d`);
const link = (headline: string, url: string | null | undefined) => (url ? `[${headline}](${url})` : headline);
const REASON: Record<string, string> = { other_indication: 'another disease', no_company_on_map: 'company not on the map', no_date: 'no date' };

async function report(d: Disease): Promise<string[]> {
  const doc = await monitorOf(d);
  if (!doc || !Object.keys(doc.monitors).length) return [`## ${d.name}`, '', 'No monitors.', ''];
  const kept = (await store.get<MonitorEvent[]>(spacePath(d, 'monitor-events.json'))) ?? [];
  const aside = (await store.get<Aside[]>(spacePath(d, 'monitor-unmatched.json'))) ?? [];
  const index = (await store.get<{ weeks: string[] }>(spacePath(d, 'monitor-eval/index.json'))) ?? { weeks: [] };
  const week = arg('week') ?? index.weeks[0];
  const ev = week ? await store.get<MonitorEval>(spacePath(d, `monitor-eval/${week}.json`)) : null;
  const since = Object.values(doc.monitors).map((e) => e.created).sort()[0];
  const label = (k: string) => doc.monitors[k]?.label ?? k;
  const found = kept.filter((e) => e.detected && e.detected >= since);
  // Speed counts news announced after the monitors started; their first run returns a sample of older news.
  const days = found.filter((e) => e.date >= since.slice(0, 10)).map((e) => Math.max(0, (Date.parse(e.detected) - Date.parse(`${e.date}T00:00:00Z`)) / 86_400_000)).sort((a, b) => a - b);
  const median = days.length ? days[Math.floor(days.length / 2)] : null;
  const out = [`## ${d.name}`, '', `${Object.keys(doc.monitors).length} monitors since ${fmt(since)} · last read ${doc.health?.last_collected?.slice(0, 16).replace('T', ' ') ?? '—'} UTC · ${found.length} developments found · median ${speed(median)} from announcement to the map (${days.length} announced since the monitors started)`, ''];

  if (ev) {
    const liveBoth = ev.both.filter((b) => !ev.monitors_since || b.reference.date >= ev.monitors_since).length;
    out.push(`### ${fmt(ev.start)}–${fmt(ev.end)}: Monitor vs an independent research sweep`, '');
    out.push(`Both ${ev.both.length} · only Monitor ${ev.monitor_only.length} · only the sweep ${ev.reference_only.length} · recall while live: ${ev.recall == null ? '—' : `${liveBoth} of ${ev.recall_n ?? liveBoth + ev.reference_only.length}`}`);
    out.push(`Not scored: ${ev.before_monitors?.length ?? 0} announced before the monitors started · ${ev.registry?.length ?? 0} from ClinicalTrials.gov (the registry pull's job) · ${ev.off_map.length} about companies not on the map`, '');
    for (const b of ev.both) out.push(`- both · ${fmt(b.reference.date)} · ${b.reference.company_name}: ${link(b.reference.headline, b.monitor.source_url ?? b.reference.source_url)} (${(b.monitor.found_by ?? []).map(label).join(', ')})`);
    for (const m of ev.monitor_only) out.push(`- **only Monitor** · ${fmt(m.date)} · ${m.company_name}: ${link(m.headline, m.source_url)} (${(m.found_by ?? []).map(label).join(', ')})`);
    for (const r of ev.reference_only) out.push(`- **missed** · ${fmt(r.date)} · ${r.company_name}: ${link(r.headline, r.source_url)}`);
    for (const o of ev.off_map) out.push(`- not on the map · ${fmt(o.date)} · ${o.company_name}: ${link(o.headline, o.source_url)}`);
    out.push('');
  }

  out.push('### Each monitor (found · found by no other monitor)', '');
  const rows = Object.entries(doc.monitors).map(([k, e]) => ({ label: e.label, kind: e.kind, found: found.filter((x) => x.found_by?.includes(k)).length, only: found.filter((x) => x.found_by?.length === 1 && x.found_by[0] === k).length }));
  for (const r of rows.sort((a, b) => b.found - a.found)) out.push(`- ${r.label} (${r.kind}): ${r.found} · ${r.only}`);
  out.push('');
  if (aside.length) {
    const counts = aside.reduce((m: Record<string, number>, a) => ((m[REASON[a.reason] ?? a.reason] = (m[REASON[a.reason] ?? a.reason] ?? 0) + 1), m), {});
    out.push(`### Set aside: ${Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(' · ')}`, '');
    for (const a of aside.filter((x) => x.reason !== 'no_date').slice(0, 8)) out.push(`- ${REASON[a.reason] ?? a.reason} · ${a.company ?? '—'}: ${link(a.headline, a.source_url)} (${label(a.monitor)})`);
    out.push('');
  }
  return out;
}

const config = JSON.parse(readFileSync('scripts/diseases.json', 'utf8')) as { diseases: { key: string; monitor?: boolean }[] };
const targets = flag('disease') ? [disease()] : config.diseases.filter((x) => x.monitor).map((x) => disease(x.key));
const lines = [`# News Monitors: internal report (${new Date().toISOString().slice(0, 10)})`, ''];
for (const d of targets) if (await store.get(spacePath(d, 'trials.json'))) lines.push(...(await report(d)));
const text = lines.join('\n');
if (arg('out')) writeFileSync(arg('out')!, text);
console.log(text);
