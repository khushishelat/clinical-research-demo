'use client';

// The disease map: one row per company, one dot per trial (placed at its
// first-posted date), orange squares for dated news, dashed diamonds for what
// the company says is next. Right rail: the clinicians most involved, and what
// changed. Clicking a dot or a clinician opens a drawer.

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Dot, FeedItem, MapView, Mark, Row } from '@/lib/space/view';
import { Drawer } from './Drawer';
import { Favicon } from './Favicon';

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const START = '2019-01-01';
const SHOWN = 12;
const onStorage = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
const readTipSeen = () => {
  try {
    return localStorage.getItem('tc-first-tip') === '1';
  } catch {
    return true;
  }
};

function useRange(today: string) {
  return useMemo(() => {
    const end = `${Number(today.slice(0, 4)) + 1}-12-31`;
    const a = Date.parse(START);
    const b = Date.parse(end);
    const x = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - a) / (b - a)) * 100));
    const years: { label: string; at: number }[] = [];
    for (let y = 2019; y <= Number(end.slice(0, 4)); y++) years.push({ label: y === 2019 ? '2019' : `'${String(y).slice(2)}`, at: x(`${y}-01-01`) });
    return { x, years, end };
  }, [today]);
}

// Stable vertical placement for dots in a row, so they don't stack.
const jitter = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 14 + (h % 26);
};
const dotSize = (phase: number) => [6, 7, 9, 11, 12][Math.max(0, Math.min(4, phase))];

type Tip = { x: number; y: number; title: string; body: string; foot?: string } | null;

export function DiseaseMap({ view, today }: { view: MapView; today: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const scope: 'companies' | 'all' = params.get('scope') === 'all' ? 'all' : 'companies';
  const { x, years } = useRange(today);
  const [more, setMore] = useState(false);
  const [tab, setTab] = useState<'clinicians' | 'changed'>('clinicians');
  const [tip, setTip] = useState<Tip>(null);
  const [tipDismissed, setTipDismissed] = useState(false);
  // A mark not tied to one trial opens this card in the app; its source is a secondary link.
  const [card, setCard] = useState<{ mark: Mark; company: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!card) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCard(null);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [card]);
  const drawer = params.get('trial') ? ({ kind: 'trial', id: params.get('trial')! } as const) : params.get('clinician') ? ({ kind: 'clinician', id: params.get('clinician')! } as const) : null;
  const open = (kind: 'trial' | 'clinician', id: string) => {
    const p = new URLSearchParams(params.toString());
    p.delete('trial');
    p.delete('clinician');
    p.set(kind, id);
    setCard(null);
    router.push(`?${p}`, { scroll: false });
  };
  const close = () => {
    const p = new URLSearchParams(params.toString());
    p.delete('trial');
    p.delete('clinician');
    router.push(p.size ? `?${p}` : '?', { scroll: false });
  };
  const setScope = (s: 'companies' | 'all') => {
    const p = new URLSearchParams(params.toString());
    if (s === 'all') p.set('scope', 'all');
    else p.delete('scope');
    router.push(p.size ? `?${p}` : '?', { scroll: false });
  };
  // The first-visit tip shows until dismissed; remembered per browser when storage allows.
  const tipSeen = useSyncExternalStore(onStorage, readTipSeen, () => true);
  const firstTip = !tipSeen && !tipDismissed;
  const dismissTip = () => {
    setTipDismissed(true);
    try {
      localStorage.setItem('tc-first-tip', '1');
    } catch {
      // private mode: the tip simply returns next visit
    }
  };

  const all = scope === 'all' ? view.rows : view.rows.filter((r) => r.key !== '_unassigned');
  const rows = more ? all : all.slice(0, SHOWN);
  const s = view.stats;
  const newCount = view.feed.length;
  const todayAt = x(today);

  return (
    <main className="px-4 pb-12 sm:px-8">
      <section className="flex flex-wrap items-end justify-between gap-6 pt-8">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{view.disease.area ? `${view.disease.area} · ` : ''}Competitive landscape</p>
          <h1 className="mt-1 text-[36px] leading-tight tracking-[-0.01em]">{view.disease.name}</h1>
          <p className="mt-1 text-[15px] text-muted">{view.disease.subtitle ?? 'Every company developing drugs for this indication, their active trials and investigators'}</p>
        </div>
        <dl className="grid grid-cols-2 gap-x-10 gap-y-3 sm:grid-cols-4">
          <Stat value={String(s.trials)} label="Active trials" sub={`Drug and biologic${view.scope?.min_phase ? `, Phase ${view.scope.min_phase}+` : ''}, all sponsors${s.completed ? ` · +${s.completed} completed since ${view.scope?.completed_since?.slice(0, 4) ?? ''}` : ''}`} />
          <Stat value={String(s.companies)} label="Companies" sub={`${s.sponsors} registry sponsors${s.webCompanies ? ` · ${s.webCompanies} via web research` : ''}`} />
          <Stat value={String(s.investigators)} label="Investigators" sub="PIs and study chairs in the registry" />
          <Stat value={s.dealDollars ? `≈$${(s.dealDollars / 1e9).toFixed(s.dealDollars >= 1e10 ? 0 : 1)}B` : String(s.deals)} label={s.dealDollars ? 'Licensing and M&A since May 2025' : 'Licensing and M&A deals since May 2025'} sub={s.dealDollars ? `${s.deals} deals · disclosed headline value, USD` : undefined} accent />
        </dl>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <section aria-label="Companies and their trials over time" className="min-w-0 rounded-[4px] border border-line bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-ink" /> Industry-sponsored trial
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-[#adadac]" /> Investigator-sponsored trial (IST)
              </li>
              <li className="flex items-center gap-1.5">
                <span className="flex items-end gap-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink" />
                  <span className="h-2 w-2 rounded-full bg-ink" />
                  <span className="h-2.5 w-2.5 rounded-full bg-ink" />
                </span>
                Phase 1 · 2 · 3
              </li>
              {s.completed ? (
                <li className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full border-2 border-ink bg-card" /> Completed since {view.scope?.completed_since?.slice(0, 4)}
                </li>
              ) : null}
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-ink ring-2 ring-orange ring-offset-1" /> Acquired asset
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-orange" /> Disclosure
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rotate-45 border border-dashed border-orange" /> Guided catalyst
              </li>
            </ul>
            <div role="group" aria-label="Which trials to show" className="inline-flex rounded-[4px] border border-line-strong bg-page p-0.5 font-mono text-[11px] uppercase tracking-[0.04em]">
              <button type="button" onClick={() => setScope('companies')} aria-pressed={scope === 'companies'} className={`rounded-[3px] px-3 py-1.5 ${scope === 'companies' ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}>
                Company assets · {s.onMap}
              </button>
              <button type="button" onClick={() => setScope('all')} aria-pressed={scope === 'all'} className={`rounded-[3px] px-3 py-1.5 ${scope === 'all' ? 'bg-ink text-page' : 'text-muted hover:text-ink'}`}>
                {s.completed ? 'All trials' : 'All active trials'} · {s.all}
              </button>
            </div>
          </div>

          <p className="border-b border-line px-4 py-2 text-center font-mono text-[10px] uppercase tracking-[0.05em] text-faint sm:hidden">
            Best experienced on desktop · scroll sideways to explore
          </p>
          <div className="relative overflow-x-auto" onMouseLeave={() => setTip(null)}>
            <div className="min-w-[860px]">
              <div className="grid grid-cols-[260px_minmax(0,1fr)_64px] border-b border-line bg-page px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                <span>Company · lead assets</span>
                <span className="relative">
                  {years.map((y) => (
                    <span key={y.label} className="absolute" style={{ left: `${y.at}%` }}>
                      {y.label}
                    </span>
                  ))}
                  <span className="absolute -translate-x-1/2 text-ink" style={{ left: `${todayAt}%` }}>
                    Today
                  </span>
                </span>
                <span className="text-right">Trials</span>
              </div>
              {rows.map((r, i) => (
                <MapRow key={r.key} row={r} x={x} years={years} todayAt={todayAt} onDot={(d) => open('trial', d.nct)} onCard={(mark, at) => (setTip(null), setCard({ mark, company: r.name, ...at }))} setTip={setTip} showFirstTip={firstTip && i === 0} dismissTip={dismissTip} />
              ))}
              {all.length > SHOWN ? (
                <button type="button" onClick={() => setMore((v) => !v)} className="w-full border-t border-line px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-muted hover:bg-wash hover:text-ink">
                  {more ? 'Show fewer ▴' : `${all.length - SHOWN} more ${scope === 'all' ? 'rows' : 'companies'} ▾`}
                </button>
              ) : null}
            </div>
            {card ? <MarkCard card={card} onTrial={(n) => open('trial', n)} onClose={() => setCard(null)} /> : null}
            {tip ? (
              <div className="pointer-events-none absolute z-20 w-[280px] rounded-[4px] bg-ink/95 px-3 py-2 text-[12px] text-page" style={{ left: Math.max(8, tip.x - 140), top: tip.y + 14 }}>
                <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[#adadac]">{tip.title}</p>
                <p className="mt-0.5">{tip.body}</p>
                {tip.foot ? <p className="mt-1 font-mono text-[10px] text-[#adadac]">{tip.foot}</p> : null}
              </div>
            ) : null}
          </div>
        </section>

        <aside className="min-w-0 rounded-[4px] border border-line bg-card">
          <div role="tablist" className="flex gap-6 border-b border-line px-4">
            <button type="button" role="tab" aria-selected={tab === 'clinicians'} onClick={() => setTab('clinicians')} className={`border-b-2 py-3 text-[14px] ${tab === 'clinicians' ? 'border-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              Investigators
            </button>
            <button type="button" role="tab" aria-selected={tab === 'changed'} onClick={() => setTab('changed')} className={`flex items-center gap-2 border-b-2 py-3 text-[14px] ${tab === 'changed' ? 'border-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              Recent activity
              {newCount ? <span title="Events in the last 60 days" className="rounded-full bg-orange-wash px-1.5 font-mono text-[10px] text-ink">{newCount}</span> : null}
            </button>
          </div>
          {tab === 'clinicians' ? <ClinicianRail view={view} onOpen={(k) => open('clinician', k)} /> : <ChangeRail view={view} onTrial={(n) => open('trial', n)} />}
        </aside>
      </div>

      <p className="mt-10 border-t border-line pt-6 text-[12px] text-muted">
        Research support from public sources. Not investment or medical advice. Coverage of trials and disclosures is not complete. Investigator details are professional facts only, never contact details or opinions.
      </p>

      {drawer ? <Drawer disease={view.disease.key} kind={drawer.kind} id={drawer.id} onClose={close} onOpen={open} /> : null}
    </main>
  );
}


function Stat({ value, label, sub, accent }: { value: string; label: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <dd className="text-[28px] leading-none">{value}</dd>
      <dt className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
        {accent ? <span className="h-1.5 w-1.5 bg-orange" /> : null}
        {label}
      </dt>
      {sub ? <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-faint">{sub}</p> : null}
    </div>
  );
}

function MapRow({ row, x, years, todayAt, onDot, onCard, setTip, showFirstTip, dismissTip }: { row: Row; x: (iso: string) => number; years: { at: number }[]; todayAt: number; onDot: (d: Pick<Dot, 'nct'>) => void; onCard: (m: Mark, at: { x: number; y: number }) => void; setTip: (t: Tip) => void; showFirstTip: boolean; dismissTip: () => void }) {
  const firstAcquired = row.dots.find((d) => d.acquiredFrom);
  const tipFor = (e: React.MouseEvent, t: NonNullable<Tip>) => {
    const box = (e.currentTarget as HTMLElement).closest('.relative.overflow-x-auto')!.getBoundingClientRect();
    setTip({ ...t, x: e.clientX - box.left, y: e.clientY - box.top });
  };
  const firstDot = row.dots.slice().sort((a, b) => b.x.localeCompare(a.x))[0];
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)_64px] items-stretch border-b border-line px-4 last:border-b-0 hover:bg-page/60">
      <div className="min-w-0 py-2.5 pr-3">
        <p className="flex items-center gap-2 text-[14px] font-medium">
          <Favicon host={row.host} name={row.name} />
          <span className="truncate">{row.name}</span>
        </p>
        {row.lead ? <p className="mt-0.5 truncate text-[12px] text-muted">{row.lead}</p> : null}
        <p className="mt-1 flex flex-wrap gap-1">
          {row.stage ? <span className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] ${row.approved ? 'bg-ink text-page' : 'border border-line-strong text-muted'}`}>{row.stage}</span> : null}
          {row.mechanisms.map((m) => (
            <span key={m} className="rounded-[2px] border border-line px-1.5 py-0.5 font-mono text-[9px] tracking-[0.03em] text-muted">
              {m}
            </span>
          ))}
          {row.designations.map((d) => (
            <span key={d} title="Regulatory designation" className="rounded-[2px] border border-orange px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em] text-ink">
              {d}
            </span>
          ))}
          {row.webOnly ? <span className="rounded-[2px] bg-orange-wash px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em]">No active trials</span> : null}
        </p>
      </div>
      <div className="relative min-h-[64px]">
        {years.map((y) => (
          <span key={y.at} className="absolute inset-y-0 border-l border-dashed border-line" style={{ left: `${y.at}%` }} />
        ))}
        <span className="absolute inset-y-0 border-l border-ink" style={{ left: `${todayAt}%` }} />
        {firstAcquired ? (
          <span className="absolute font-mono text-[10px] text-orange" style={{ left: `${Math.max(0, x(firstAcquired.x) - 8)}%`, top: 2 }}>
            acquired from {firstAcquired.acquiredFrom!.split(' ')[0]}
          </span>
        ) : null}
        {row.news.map((m, i) => (
          <MarkLink key={`n${i}`} m={m} onTrial={onDot} onCard={onCard} label={`${fmt(m.date)}: ${m.headline}`} onMouseEnter={(e) => tipFor(e, { x: 0, y: 0, title: `${fmt(m.date)} · ${labelOf(m)}`, body: m.headline, foot: m.nct ? 'Click to open the trial' : 'Click for details' })} className="absolute h-2 w-2 -translate-x-1/2 bg-orange hover:scale-150" style={{ left: `${x(m.date)}%`, top: 6 + (i % 2) * 6 }} />
        ))}
        {row.next.map((m, i) => (
          <MarkLink key={`x${i}`} m={m} onTrial={onDot} onCard={onCard} label={`Guided catalyst: ${m.headline}`} onMouseEnter={(e) => tipFor(e, { x: 0, y: 0, title: `Guided · ${m.window ?? fmt(m.date)}`, body: m.headline, foot: m.nct ? 'Click to open the trial' : 'Click for details' })} className="absolute h-2.5 w-2.5 -translate-x-1/2 rotate-45 border border-dashed border-orange bg-card hover:scale-150" style={{ left: `${x(m.date)}%`, top: 26 }} />
        ))}
        {row.dots.map((d) => {
          const size = dotSize(d.phase);
          return (
            <button
              key={d.nct}
              type="button"
              aria-label={`${d.label}, phase ${d.phase || 'not set'}, ${d.kind === 'company' ? 'industry-sponsored' : 'investigator-sponsored'}`}
              onClick={() => onDot(d)}
              onMouseEnter={(e) => tipFor(e, { x: 0, y: 0, title: `${d.label} · ${d.phase ? `Phase ${d.phase}` : 'Phase n/a'}`, body: `${d.kind === 'company' ? 'Industry-sponsored' : "Investigator-sponsored, testing this company's asset"}${d.done ? ' · completed' : ''} · first posted ${fmt(d.x)}`, foot: d.acquiredFrom ? `Acquired with ${d.acquiredFrom}` : 'Click for investigators and disclosures' })}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform hover:scale-150 ${d.done ? `border-2 bg-card ${d.kind === 'company' ? 'border-ink' : 'border-[#adadac]'}` : d.kind === 'company' ? 'bg-ink' : 'bg-[#adadac]'} ${d.acquiredFrom ? 'ring-2 ring-orange ring-offset-1' : ''}`}
              style={{ left: `${x(d.x)}%`, top: jitter(d.nct) + 10, width: size, height: size }}
            />
          );
        })}
        {showFirstTip && firstDot ? (
          <div className="absolute z-10 w-[220px] rounded-[4px] bg-ink px-3 py-2.5 text-[12px] text-page shadow-lg" style={{ left: `min(calc(${x(firstDot.x)}% + 14px), calc(100% - 230px))`, top: 8 }}>
            <p className="font-medium">Each dot is a trial. Click one for its investigators and disclosures.</p>
            <p className="mt-1 font-mono text-[10px] text-[#adadac]">
              {firstDot.label} · {row.name}
            </p>
            <button type="button" onClick={dismissTip} className="mt-2 rounded-[3px] bg-page px-2 py-1 font-mono text-[10px] uppercase text-ink">
              Got it
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end font-mono text-[13px]">{row.trials || '—'}</div>
    </div>
  );
}

// A mark the research run tied to a trial opens that trial; any other mark opens its card in the app.
function MarkLink({ m, onTrial, onCard, label, onMouseEnter, className, style }: { m: Mark; onTrial: (d: Pick<Dot, 'nct'>) => void; onCard: (m: Mark, at: { x: number; y: number }) => void; label: string; onMouseEnter: (e: React.MouseEvent) => void; className: string; style: React.CSSProperties }) {
  const openCard = (e: React.MouseEvent) => {
    const box = (e.currentTarget as HTMLElement).closest('.relative.overflow-x-auto')!.getBoundingClientRect();
    onCard(m, { x: e.clientX - box.left, y: e.clientY - box.top });
  };
  return <button type="button" aria-label={label} onClick={(e) => (m.nct ? onTrial({ nct: m.nct }) : openCard(e))} onMouseEnter={onMouseEnter} className={className} style={style} />;
}

function MarkCard({ card, onTrial, onClose }: { card: { mark: Mark; company: string; x: number; y: number }; onTrial: (nct: string) => void; onClose: () => void }) {
  const m = card.mark;
  return (
    <>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 z-20 cursor-default" />
      <div role="dialog" aria-label={m.headline} className="absolute z-30 w-[320px] rounded-[4px] border border-line bg-card p-3 text-[13px] shadow-lg" style={{ left: `min(max(8px, ${card.x - 160}px), calc(100% - 330px))`, top: card.y + 12 }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
          {m.type === 'next' ? 'Guided catalyst' : labelOf(m)} · {m.type === 'next' ? (m as Mark & { window?: string | null }).window ?? fmt(m.date) : fmt(m.date)} · {card.company}
        </p>
        <p className="mt-1 text-[14px] font-medium leading-snug">{m.headline}</p>
        {m.detail ? <p className="mt-1 text-muted">{m.detail}</p> : null}
        {m.drug ? <p className="mt-1 text-[12px] text-muted">Asset: {m.drug}</p> : null}
        {m.trials.length ? (
          <div className="mt-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Trials of this asset</p>
            <p className="mt-1 flex flex-wrap gap-1.5">
              {m.trials.map((t) => (
                <button key={t.nct} type="button" onClick={() => onTrial(t.nct)} className="rounded-[3px] border border-line-strong px-2 py-0.5 text-[12px] hover:border-ink">
                  {t.label}
                </button>
              ))}
            </p>
          </div>
        ) : null}
        <p className="mt-2 flex items-center justify-between">
          {m.source ? (
            <a href={m.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-ink">
              <Favicon host={m.host} name={m.host ?? '?'} size={12} /> {m.host ?? 'Source'} ↗
            </a>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted hover:text-ink">
            Close
          </button>
        </p>
      </div>
    </>
  );
}

const LABEL: Record<string, string> = { data: 'Data readout', approval: 'Approval', regulatory: 'Regulatory', designation: 'Designation', filing: 'Filing', publication: 'Publication', presentation: 'Presentation', financing: 'Financing', deal: 'Deal', trial_start: 'Trial initiation', enrollment_complete: 'Enrollment complete', discontinuation: 'Discontinuation', exit: 'Exit', other: 'Disclosure' };
const labelOf = (m: Mark) => LABEL[m.type] ?? 'Disclosure';

function ClinicianRail({ view, onOpen }: { view: MapView; onOpen: (key: string) => void }) {
  return (
    <div>
      <div className="px-4 pb-2 pt-4">
        <h2 className="text-[15px] font-medium">Most active {view.disease.name} investigators</h2>
        <p className="mt-1 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-ink" /> Registry role (PI, study chair)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 bg-orange" /> Disclosed role (data presentation, publication)
          </span>
        </p>
      </div>
      <ul>
        {view.rail.map((c) => (
          <li key={c.key}>
            <button type="button" onClick={() => onOpen(c.key)} className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line px-4 py-3 text-left hover:bg-wash">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-wash font-mono text-[11px] text-muted">{c.initials}</span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium">{c.name}</span>
                <span className="block truncate text-[12px] text-muted">
                  {c.specialty ?? 'Specialty not listed'} · {c.place}
                </span>
                <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.04em] text-faint">{c.papers != null ? `${c.papers} publications` : 'Publications not verified'}</span>
              </span>
              <span className="text-right">
                <span className="flex justify-end gap-0.5">
                  {Array.from({ length: Math.min(8, c.registryRoles) }, (_, i) => (
                    <span key={`r${i}`} className="h-2 w-2 bg-ink" />
                  ))}
                  {Array.from({ length: Math.min(4, c.webRoles) }, (_, i) => (
                    <span key={`w${i}`} className="h-2 w-2 bg-orange" />
                  ))}
                </span>
                <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.04em] text-muted">{c.registryRoles + c.webRoles} roles</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-3 text-[12px] text-muted">US investigators verified against the NPI Registry. Ex-US investigators appear by name on their trials.</p>
    </div>
  );
}

function ChangeRail({ view, onTrial }: { view: MapView; onTrial: (nct: string) => void }) {
  const [origin, setOrigin] = useState<'all' | 'registry' | 'web'>('all');
  const items = view.feed.filter((f: FeedItem) => origin === 'all' || (origin === 'web' ? f.origin !== 'registry' : f.origin === 'registry'));
  const max = Math.max(1, ...view.monthly.map((m) => m.count));
  return (
    <div>
      <div className="flex gap-2 px-4 pt-4">
        {(['all', 'registry', 'web'] as const).map((o) => (
          <button key={o} type="button" aria-pressed={origin === o} onClick={() => setOrigin(o)} className={`rounded-full border px-3 py-1 text-[12px] ${origin === o ? 'border-ink bg-ink text-page' : 'border-line-strong text-muted hover:border-ink hover:text-ink'}`}>
            {o === 'all' ? 'All' : o === 'registry' ? 'Registry' : 'Disclosures'}
          </button>
        ))}
      </div>
      <div className="px-4 pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">New trial registrations by month</p>
        <div className="mt-2 flex h-16 items-end gap-1" role="img" aria-label={`New trial registrations by month: ${view.monthly.map((m) => `${m.month} ${m.count}`).join(', ')}`}>
          {view.monthly.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[9px] text-muted">{m.count || ''}</span>
              <span className="w-full rounded-t-[2px] bg-ink" style={{ height: `${Math.max(2, (m.count / max) * 44)}px` }} />
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1 font-mono text-[9px] text-faint">
          {view.monthly.map((m) => (
            <span key={m.month} className="flex-1 text-center">
              {fmt(`${m.month}-01`, { month: 'narrow' })}
            </span>
          ))}
        </div>
      </div>
      <ul className="mt-3">
        {items.map((f) => (
          <li key={f.id} className="grid grid-cols-[54px_minmax(0,1fr)] gap-3 border-t border-line px-4 py-3">
            <span className="flex items-start gap-1.5 font-mono text-[11px] text-muted">
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 ${f.origin === 'registry' ? 'bg-ink' : 'bg-orange'}`} />
              {fmt(f.date, { month: 'short', day: 'numeric' })}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <Favicon host={f.host} name={f.company} size={14} /> {f.company}
              </span>
              <span className="mt-0.5 block text-[14px]">{f.headline}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2">
                {f.nct ? (
                  <button type="button" onClick={() => onTrial(f.nct!)} className="rounded-[3px] border border-line-strong px-1.5 py-0.5 font-mono text-[10px] hover:border-ink">
                    {f.nct}
                  </button>
                ) : f.source ? (
                  <a href={f.source} target="_blank" rel="noreferrer" className="rounded-[3px] border border-line-strong px-1.5 py-0.5 font-mono text-[10px] hover:border-ink">
                    {new URL(f.source).hostname.replace(/^www\./, '')} ↗
                  </a>
                ) : null}
                {f.webEarlier ? <span className="rounded-[3px] bg-orange-wash px-1.5 py-0.5 font-mono text-[10px] uppercase">Disclosed {f.webEarlier.days} days before registry</span> : null}
              </span>
            </span>
          </li>
        ))}
        {!items.length ? <li className="border-t border-line px-4 py-6 text-[13px] text-muted">Nothing in the last two months.</li> : null}
      </ul>
    </div>
  );
}
