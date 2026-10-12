// The Monitor scorecard: what the news Monitors found, how fast, which monitor found
// what, what they set aside, and how last week compares with an independent research
// sweep. Every item links to its source.

import type { MonitorScorecard as View } from '@/lib/space/monitor';
import { Favicon } from './Favicon';
import { RelDay } from './Live';

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const speed = (d: number | null) => (d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))}h` : `${d.toFixed(1)}d`);
const REASON: Record<string, string> = { other_indication: 'Another disease', no_company_on_map: 'Company not on the map', no_date: 'No date' };
const KIND: Record<string, string> = { broad: 'Broad', topic: 'Topic', company: 'Company' };

type Card = { date: string; company: string; headline: string; source: string | null; host: string | null; by: string[] };

function Item({ c, tone }: { c: Card; tone: 'ink' | 'orange' | 'muted' }) {
  const Tag = c.source ? 'a' : 'div';
  return (
    <li className="border-t border-line first:border-t-0">
      <Tag {...(c.source ? { href: c.source, target: '_blank', rel: 'noreferrer' } : {})} className="flex gap-2.5 px-3 py-2 hover:bg-wash">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 ${tone === 'ink' ? 'bg-ink' : tone === 'orange' ? 'bg-orange' : 'border border-muted'}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[11px] text-muted">
            <Favicon host={c.host} name={c.company} size={12} />
            <span className="truncate">{c.company}</span>
            <span className="ml-auto shrink-0 font-mono text-[10px]">{fmt(c.date)}</span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[13px] leading-snug">{c.headline}</span>
        </span>
      </Tag>
    </li>
  );
}

export function MonitorScorecard({ name, view }: { name: string; view: View }) {
  const w = view.week;
  const total = w ? w.both.length + w.monitorOnly.length + w.missed.length : 0;
  const max = Math.max(1, ...view.monitors.map((m) => m.found));
  return (
    <main className="px-4 pb-12 sm:px-8">
      <section className="flex flex-wrap items-end justify-between gap-6 pt-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{name} · Parallel Monitor</p>
          <h1 className="mt-1 text-[30px] leading-tight tracking-[-0.01em]">News, as it happens</h1>
        </div>
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          <Stat value={String(view.count)} label="Monitors" hint={Object.entries(view.kinds).map(([k, n]) => `${n} ${KIND[k]?.toLowerCase() ?? k}`).join(' · ')} />
          <Stat value={String(view.found)} label={`Found since ${view.since ? fmt(view.since) : '—'}`} />
          <Stat value={speed(view.latency)} label="Announcement → map" hint={`Median over ${view.latencyN} developments announced after the monitors started`} />
          <Stat value={w?.recall == null ? '—' : w.recallN < 5 ? `${Math.round(w.recall * w.recallN)} of ${w.recallN}` : `${Math.round(w.recall * 100)}%`} label="Of the sweep's finds" hint="Of the news an independent research sweep of the week found about companies on the map, while the monitors were live, the share the monitors had found too (registry items and news from before the monitors started are not scored)" accent />
        </dl>
      </section>

      {w ? (
        <section aria-label="Last week against an independent sweep" className="mt-6 rounded-[4px] border border-line bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 className="text-[14px] font-medium">
              {fmt(w.start)}–{fmt(w.end)} · Monitor vs an independent research sweep
            </h2>
            {w.partial ? <span className="rounded-[2px] bg-orange-wash px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em]">Monitors started mid-week</span> : null}
          </div>
          <div className="px-4 pt-4">
            <div className="flex h-3 w-full overflow-hidden rounded-[2px] border border-line" role="img" aria-label={`${w.both.length} found by both, ${w.monitorOnly.length} only by Monitor, ${w.missed.length} only by the sweep`}>
              <span className="bg-ink" style={{ width: `${(w.both.length / Math.max(1, total)) * 100}%` }} />
              <span className="bg-orange" style={{ width: `${(w.monitorOnly.length / Math.max(1, total)) * 100}%` }} />
              <span className="bg-[repeating-linear-gradient(45deg,var(--color-line-strong)_0_2px,transparent_2px_6px)]" style={{ width: `${(w.missed.length / Math.max(1, total)) * 100}%` }} />
            </div>
          </div>
          <div className="grid gap-4 p-4 md:grid-cols-3">
            <Column title="Both found" n={w.both.length} tone="ink" items={w.both} />
            <Column title="Only Monitor" n={w.monitorOnly.length} tone="orange" items={w.monitorOnly} />
            <Column title="Only the sweep" n={w.missed.length} tone="muted" items={w.missed} />
          </div>
          {w.offMap || w.registry || w.before.length ? (
            <p className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
              {w.before.length ? <span title={w.before.map((b) => `${fmt(b.date)} ${b.company}: ${b.headline}`).join('\n')}>{w.before.length} announced before the monitors started{w.since ? ` (${fmt(w.since)})` : ''}, not scored</span> : null}
              {w.registry ? <span>{w.registry} from ClinicalTrials.gov, on the map by the daily registry pull</span> : null}
              {w.offMap ? <span>{w.offMap} about companies not on the map</span> : null}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section aria-label="Each monitor" className="rounded-[4px] border border-line bg-card">
          <h2 className="border-b border-line px-4 py-3 text-[14px] font-medium">Each monitor</h2>
          <ul>
            {view.monitors.map((m) => (
              <li key={m.key} className="grid grid-cols-[minmax(0,220px)_minmax(0,1fr)_64px] items-center gap-3 border-t border-line px-4 py-2 first:border-t-0">
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{m.label}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.06em] text-faint">{KIND[m.kind] ?? m.kind}</span>
                </span>
                <span className="relative h-2 rounded-[1px] bg-wash" title={`${m.found} found · ${m.only} found by no other monitor`}>
                  <span className="absolute inset-y-0 left-0 bg-ink" style={{ width: `${(m.found / max) * 100}%` }} />
                  <span className="absolute inset-y-0 left-0 bg-orange" style={{ width: `${(m.only / max) * 100}%` }} />
                </span>
                <span className="text-right font-mono text-[11px]">
                  {m.found}
                  {m.only ? <span className="text-orange"> · {m.only}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="flex gap-4 border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 bg-ink" /> Found</span>
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-3 bg-orange" /> Only this monitor</span>
          </p>
        </section>

        <div className="space-y-6">
          <section aria-label="Latest catches" className="rounded-[4px] border border-line bg-card">
            <h2 className="flex items-center justify-between border-b border-line px-4 py-3 text-[14px] font-medium">
              Latest catches
              <span className="live-dot h-2 w-2 rounded-full bg-ok" />
            </h2>
            <ul>
              {view.latest.map((c) => (
                <li key={`${c.date}-${c.headline}`} className="border-t border-line first:border-t-0">
                  <a href={c.source ?? '#'} target="_blank" rel="noreferrer" className="block px-4 py-2.5 hover:bg-wash">
                    <span className="flex items-center gap-1.5 text-[11px] text-muted">
                      <Favicon host={c.host} name={c.company} size={12} />
                      <span className="truncate">{c.company}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px]">
                        <RelDay iso={c.detected} short /> · {c.after == null ? 'first run' : `${speed(c.after)} after`}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug">{c.headline}</span>
                    <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.05em] text-orange">{c.by.join(' · ')}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          {view.aside.examples.length ? (
            <section aria-label="Set aside" className="rounded-[4px] border border-line bg-card">
              <h2 className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3 text-[14px] font-medium">
                Set aside
                {Object.entries(view.aside.reasons).map(([r, n]) => (
                  <span key={r} className="rounded-[2px] border border-line px-1.5 font-mono text-[10px] font-normal text-muted">
                    {REASON[r] ?? r} {n}
                  </span>
                ))}
              </h2>
              <ul>
                {view.aside.examples.map((a, i) => (
                  <li key={i} className="border-t border-line px-4 py-2 text-[12px] first:border-t-0">
                    <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-faint">{REASON[a.reason] ?? a.reason} · {a.company ?? '—'}</span>
                    <span className="block text-muted">{a.headline}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <p className="mt-8 border-t border-line pt-4 text-[12px] text-muted">
        {view.count} Parallel Monitors (base, daily) watch this indication: one broad, one per topic, one per leading company. A development reaches the map when a monitor finds it, by webhook within minutes. Each Monday an independent research sweep of the past week (Task API, ultra, sources from that week) checks what they caught and missed.
      </p>
    </main>
  );
}

function Stat({ value, label, hint, accent }: { value: string; label: string; hint?: string; accent?: boolean }) {
  return (
    <div title={hint}>
      <dd className="text-[28px] leading-none">{value}</dd>
      <dt className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
        {accent ? <span className="h-1.5 w-1.5 bg-orange" /> : null}
        {label}
      </dt>
    </div>
  );
}

function Column({ title, n, tone, items }: { title: string; n: number; tone: 'ink' | 'orange' | 'muted'; items: Card[] }) {
  return (
    <div>
      <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-muted">
        <span className={`h-1.5 w-1.5 ${tone === 'ink' ? 'bg-ink' : tone === 'orange' ? 'bg-orange' : 'border border-muted'}`} />
        {title} <span className="text-ink">{n}</span>
      </p>
      <ul className="mt-2 rounded-[3px] border border-line">
        {items.slice(0, 8).map((c, i) => (
          <Item key={i} c={c} tone={tone} />
        ))}
        {!items.length ? <li className="px-3 py-3 text-[12px] text-faint">None</li> : null}
      </ul>
    </div>
  );
}
