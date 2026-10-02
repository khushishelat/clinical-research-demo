'use client';

// Plays back a recorded Task Group: one card per run, with its searches, the
// pages it read and its Data Connector calls, at 20× speed.

import { useEffect, useMemo, useRef, useState } from 'react';

type Ev = { k: 'state' | 'stats' | 'search' | 'tool' | 'extract'; run: string; t: number; status?: string; m?: string; connector?: string; tool?: string; url?: string; considered?: number; read?: number };
type Replay = { job: string; started: string; duration_s: number; events: Ev[] };
type Card = { status: string; searches: number; pages: number; tools: Record<string, number>; last: string | null };

const SPEED = 20;
const CONNECTOR: Record<string, string> = { clinical_trials: 'ClinicalTrials.gov', pubmed: 'PubMed', chembl: 'ChEMBL', npi_registry: 'NPI Registry', cms_coverage: 'CMS Coverage', biorxiv: 'bioRxiv' };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function RunReplay({ disease, job, names }: { disease: string; job: string; names: Record<string, string> }) {
  const [replay, setReplay] = useState<Replay | null | 'none'>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    fetch(`/api/d/${disease}/replay/${job}`)
      .then((r) => (r.ok ? r.json() : 'none'))
      .then(setReplay)
      .catch(() => setReplay('none'));
  }, [disease, job]);
  useEffect(() => {
    if (!playing || !replay || replay === 'none') return;
    let last = performance.now();
    const tick = (now: number) => {
      setT((x) => {
        const next = x + ((now - last) / 1000) * SPEED;
        if (next >= replay.duration_s) {
          setPlaying(false);
          return replay.duration_s;
        }
        return next;
      });
      last = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, replay]);

  const runs = useMemo(() => (replay && replay !== 'none' ? [...new Set(replay.events.map((e) => e.run))] : []), [replay]);
  const cards = useMemo(() => {
    const out = new Map<string, Card>(runs.map((r) => [r, { status: 'queued', searches: 0, pages: 0, tools: {}, last: null }]));
    if (!replay || replay === 'none') return out;
    for (const e of replay.events) {
      if (e.t > t) break;
      const c = out.get(e.run)!;
      if (e.k === 'state' && e.status) c.status = e.status;
      else if (e.k === 'search') {
        c.searches += 1;
        c.last = (e.m ?? '').replace(/^Query:\s*/, '');
        if (c.status === 'queued') c.status = 'running';
      } else if (e.k === 'extract') c.pages += 1;
      else if (e.k === 'tool' && e.connector) c.tools[e.connector] = (c.tools[e.connector] ?? 0) + 1;
    }
    return out;
  }, [replay, runs, t]);

  if (replay === null) return <div className="h-40 animate-pulse rounded-[4px] bg-wash" />;
  if (replay === 'none') return <p className="text-[14px] text-muted">No recording for this run yet. Replays are recorded live the first time the pipeline runs a step.</p>;
  const done = [...cards.values()].filter((c) => c.status === 'completed').length;
  const totals = [...cards.values()].reduce((a, c) => ({ searches: a.searches + c.searches, pages: a.pages + c.pages, tools: a.tools + Object.values(c.tools).reduce((x, y) => x + y, 0) }), { searches: 0, pages: 0, tools: 0 });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={() => (t >= replay.duration_s ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} className="flex h-9 items-center gap-2 rounded-[4px] bg-ink px-3 font-mono text-[11px] uppercase tracking-[0.05em] text-page">
          {playing ? 'Pause' : t >= replay.duration_s ? 'Replay' : t > 0 ? 'Resume' : `Play at ${SPEED}×`}
        </button>
        <input type="range" min={0} max={replay.duration_s} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} aria-label="Position" className="w-48 accent-[var(--color-orange)]" />
        <span className="font-mono text-[12px] text-muted">
          {clock(t)} of {clock(replay.duration_s)} · {done}/{runs.length} runs done · {totals.searches} searches · {totals.pages} pages read in full · {totals.tools} connector calls
        </span>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {runs.map((r) => {
          const c = cards.get(r)!;
          const key = r.split(':').slice(1).join(':');
          return (
            <li key={r} className={`rounded-[4px] border p-3 transition-colors ${c.status === 'completed' ? 'border-line bg-card' : c.status === 'running' ? 'border-orange bg-card' : 'border-line bg-page'}`}>
              <p className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{names[key] ?? key}</span>
                <span className={`shrink-0 font-mono text-[10px] uppercase tracking-[0.05em] ${c.status === 'completed' ? 'text-ok' : c.status === 'running' ? 'text-orange' : 'text-faint'}`}>{c.status === 'completed' ? '✓ done' : c.status}</span>
              </p>
              <p className="mt-1 truncate text-[12px] text-muted" title={c.last ?? ''}>
                {c.last ?? '—'}
              </p>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
                <span>{c.searches} searches</span>
                <span>{c.pages} pages</span>
                {Object.entries(c.tools).map(([k, n]) => (
                  <span key={k} className="text-ink">
                    {CONNECTOR[k] ?? k} ×{n}
                  </span>
                ))}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
