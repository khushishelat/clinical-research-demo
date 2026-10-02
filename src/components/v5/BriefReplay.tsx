'use client';

// How one brief was made: the Task run's searches, the pages it read and its
// Data Connector calls, played back in about half a minute. Recorded live by
// the pipeline (step 9); a brief without a recording shows nothing.

import { useEffect, useMemo, useState } from 'react';
import { Favicon } from './Favicon';

type Ev = { k: 'state' | 'stats' | 'search' | 'tool' | 'extract'; t: number; status?: string; m?: string; connector?: string; tool?: string; url?: string; considered?: number; read?: number; sample?: string[] };
type Replay = { duration_s: number; events: Ev[] };

const PLAY_SECONDS = 30;
const CONNECTOR: Record<string, string> = { clinical_trials: 'ClinicalTrials.gov', pubmed: 'PubMed', chembl: 'ChEMBL', npi_registry: 'NPI Registry', cms_coverage: 'CMS Coverage' };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};

export function BriefReplay({ disease, issue }: { disease: string; issue: string }) {
  const [replay, setReplay] = useState<{ issue: string; data: Replay | null } | null>(null);
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(`/api/d/${disease}/replay/brief-${issue}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => live && setReplay({ issue, data }))
      .catch(() => live && setReplay({ issue, data: null }));
    return () => {
      live = false;
    };
  }, [disease, issue]);
  const r = replay?.issue === issue ? replay.data : null;
  const speed = r ? Math.max(5, r.duration_s / PLAY_SECONDS) : 1;
  // A timer rather than animation frames, so playback keeps time in a background tab.
  useEffect(() => {
    if (!playing || !r) return;
    let last = Date.now();
    const id = window.setInterval(() => {
      const now = Date.now();
      setT((x) => {
        const next = x + ((now - last) / 1000) * speed;
        if (next >= r.duration_s) {
          setPlaying(false);
          return r.duration_s;
        }
        return next;
      });
      last = now;
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, r, speed]);
  // Pages read: each page once, from read events and the stats' sample of pages read, in time order.
  const events = useMemo(() => {
    const all = r?.events ?? [];
    const urls = new Set<string>();
    const out: Ev[] = [];
    for (const e of all) {
      if (e.k === 'extract') {
        if (urls.has(e.url!)) continue;
        urls.add(e.url!);
      }
      out.push(e);
      if (e.k === 'stats') for (const url of e.sample ?? []) if (!urls.has(url)) (urls.add(url), out.push({ k: 'extract', t: e.t, url }));
    }
    return out;
  }, [r]);
  const totals = useMemo(() => {
    const last = [...events].reverse().find((e) => e.k === 'stats');
    return { searches: events.filter((e) => e.k === 'search').length, considered: last?.considered ?? 0, pages: Math.max(last?.read ?? 0, events.filter((e) => e.k === 'extract').length), tools: events.filter((e) => e.k === 'tool').length };
  }, [events]);
  if (!r || !r.events.length) return null;

  const seen = events.filter((e) => e.t <= t);
  const steps = seen.filter((e) => e.k === 'search' || e.k === 'extract' || e.k === 'tool').slice(-7).reverse();
  const stats = [...seen].reverse().find((e) => e.k === 'stats');
  const tools = seen.filter((e) => e.k === 'tool').reduce((m: Record<string, number>, e) => ((m[e.connector!] = (m[e.connector!] ?? 0) + 1), m), {});
  const finished = t >= r.duration_s;
  const play = () => {
    setOpen(true);
    if (finished) setT(0);
    setPlaying((p) => (finished ? true : !p));
  };

  return (
    <div className="mt-5 rounded-[4px] border border-line bg-page">
      <button type="button" onClick={() => (open ? setOpen(false) : play())} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-wash">
        <span className="min-w-0">
          <span className="block text-[14px] font-medium">Watch how this brief was made</span>
          <span className="mt-0.5 block font-mono text-[11px] text-muted">
            One Task run · {clock(r.duration_s)} · {totals.searches} searches · {totals.considered.toLocaleString('en-US')} sources considered · {totals.pages} read in full{totals.tools ? ` · ${totals.tools} connector calls` : ''}
          </span>
        </span>
        <span aria-hidden="true" className="font-mono text-[12px] text-muted">
          {open ? '▴' : '▶'}
        </span>
      </button>
      {open ? (
        <div className="border-t border-line px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={play} className="flex h-8 items-center rounded-[4px] bg-ink px-3 font-mono text-[11px] uppercase tracking-[0.05em] text-page">
              {playing ? 'Pause' : finished ? 'Replay' : t > 0 ? 'Resume' : 'Play'}
            </button>
            <input type="range" min={0} max={r.duration_s} value={t} onChange={(e) => (setPlaying(false), setT(Number(e.target.value)))} aria-label="Position" className="w-40 accent-[var(--color-orange)]" />
            <span className="font-mono text-[11px] text-muted">
              {clock(t)} of {clock(r.duration_s)} · {Math.round(speed)}×
            </span>
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
            <span>{seen.filter((e) => e.k === 'search').length} searches</span>
            <span title="Sources whose search excerpts the run weighed">{(stats?.considered ?? 0).toLocaleString('en-US')} sources considered</span>
            <span title="Pages the run fetched and read in full">{Math.max(stats?.read ?? 0, seen.filter((e) => e.k === 'extract').length)} read in full</span>
            {Object.entries(tools).map(([k, n]) => (
              <span key={k} className="text-orange">
                {CONNECTOR[k] ?? k} ×{n}
              </span>
            ))}
            {finished ? <span className="text-ok">✓ brief written</span> : null}
          </p>
          <ul className="mt-3 space-y-1.5" aria-live="polite">
            {steps.map((e, i) => (
              <li key={`${e.t}-${i}-${e.k}`} className={`grid grid-cols-[64px_minmax(0,1fr)] items-start gap-2 text-[12px] ${i === 0 && playing ? 'text-ink' : 'text-muted'}`}>
                <span className={`font-mono text-[9px] uppercase tracking-[0.05em] ${e.k === 'tool' ? 'text-orange' : ''}`}>{e.k === 'search' ? 'Search' : e.k === 'extract' ? 'Read' : 'Connector'}</span>
                {e.k === 'search' ? (
                  <span className="truncate">{(e.m ?? '').replace(/^Query:\s*/, '')}</span>
                ) : e.k === 'extract' ? (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Favicon host={host(e.url!)} name={host(e.url!) ?? '?'} size={12} />
                    <span className="truncate">{e.url!.replace(/^https?:\/\/(www\.)?/, '')}</span>
                  </span>
                ) : (
                  <span className="truncate">
                    {CONNECTOR[e.connector!] ?? e.connector} · {e.tool}
                  </span>
                )}
              </li>
            ))}
            {!steps.length ? <li className="text-[12px] text-muted">Starting…</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
