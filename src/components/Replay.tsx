'use client';

// "Replay how this was researched" (HANDOFF-v2.1 section 8): the recorded
// run's real event log (searches, pages read, connector calls), played back
// in about 30 seconds. No API calls.

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompactEvent } from '@/lib/domain/events';
import { fmtDate } from '@/lib/view/format';
import { connectorName, cx, Label } from './ui';

type ReplayFile = { duration_s: number; runs: { run: string; kind: string; nct_id?: string; start: number; end: number; status: string }[]; events: CompactEvent[] };

const TARGET_SECONDS = 30;

export function Replay({ keyName, company, recorded }: { keyName: string; company: string; recorded: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReplayFile | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [boost, setBoost] = useState(1);
  const last = useRef<number | null>(null);

  useEffect(() => {
    fetch(`/api/replay/${keyName}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [keyName]);

  const speed = data ? (data.duration_s / TARGET_SECONDS) * boost : 1;
  useEffect(() => {
    if (!data || !playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== null) {
        const dt = ((now - last.current) / 1000) * speed;
        setT((x) => {
          const next = Math.min(data.duration_s, x + dt);
          if (next >= data.duration_s) setPlaying(false);
          return next;
        });
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [data, playing, speed]);

  const close = () => router.replace(`/c/${keyName}`, { scroll: false });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const shown = useMemo(() => (data ? data.events.filter((e) => e.t <= t) : []), [data, t]);
  const checks = data?.runs.filter((r) => r.kind === 'trial_check') ?? [];
  const checksDone = shown.filter((e) => e.k === 'state' && e.run.startsWith('trial_check:') && e.status === 'completed').length;
  const calls: Record<string, number> = {};
  const lastRead = new Map<string, number>();
  let pages = 0;
  for (const e of shown) {
    if (e.k === 'tool') calls[e.connector] = (calls[e.connector] ?? 0) + 1;
    if (e.k === 'stats') lastRead.set(e.run, e.read);
    if (e.k === 'extract') pages += 1;
  }
  const read = [...lastRead.values()].reduce((a, b) => a + b, 0);
  const log = shown.filter((e) => e.k === 'tool' || e.k === 'extract' || (e.k === 'search' && !e.m.startsWith('Query:'))).slice(-14).reverse();
  const recentConnector = shown.filter((e) => e.k === 'tool').at(-1);
  const snapDone = shown.some((e) => e.k === 'state' && e.run === 'snapshot:');
  const mechDone = shown.some((e) => e.k === 'state' && e.run === 'mechanism:');
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div role="dialog" aria-modal="true" aria-label={`Replay of how ${company} was researched`} className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-ink/40 p-4 sm:p-10">
      <div className="w-full max-w-[880px] rounded-[4px] bg-machine text-machine-text">
        <div className="flex items-start justify-between gap-4 border-b border-machine-line px-6 py-5">
          <div>
            <Label className="text-[#adadac]">Replay · recorded {fmtDate(recorded)}</Label>
            <h2 className="mt-1 text-[22px] text-page">How {company} was researched</h2>
            <p className="text-[14px] text-[#adadac]">
              The real {data ? Math.round(data.duration_s / 60) : '…'}-minute run, replayed in 30 seconds. Every search, page read and connector call below happened.
            </p>
          </div>
          <button type="button" onClick={close} aria-label="Close replay" className="text-[22px] leading-none text-[#adadac] hover:text-page">
            ×
          </button>
        </div>
        {!data ? (
          <p className="px-6 py-10 text-[#adadac]">Loading the recording…</p>
        ) : (
          <div className="px-6 py-5">
            <div className="flex flex-wrap gap-2 font-mono text-[10px] uppercase">
              <Stage on label="Registry" />
              <Stage on={checksDone > 0} label="Checks" />
              <Stage on={mechDone} label="Competitors" />
              <Stage on={snapDone} label="Pipeline" />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" onClick={() => (t >= data.duration_s ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} className="h-8 w-10 rounded-[4px] border border-machine-line font-mono text-[12px]" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? '❚❚' : '▶'}
              </button>
              <button type="button" onClick={() => setBoost((b) => (b === 1 ? 2 : b === 2 ? 0.5 : 1))} className="h-8 rounded-[4px] border border-machine-line px-2 font-mono text-[12px]">
                {boost}×
              </button>
              <input type="range" min={0} max={data.duration_s} step={1} value={Math.floor(t)} onChange={(e) => setT(Number(e.target.value))} aria-label="Scrub" className="min-w-0 flex-1 accent-[#fb631b]" />
              <button type="button" onClick={() => setT(data.duration_s)} className="h-8 rounded-[4px] border border-machine-line px-2 font-mono text-[11px] uppercase">
                Skip to end
              </button>
            </div>
            <p className="mt-2 font-mono text-[11px] text-[#adadac]">
              {mmss(t / (data.duration_s / TARGET_SECONDS))} replay · {mmss(t)} real
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['clinical_trials', 'pubmed', 'chembl', 'biorxiv'].map((c) => (
                <span key={c} className={cx('rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase', recentConnector?.k === 'tool' && recentConnector.connector === c && t - recentConnector.t < 4 ? 'border-orange text-page' : calls[c] ? 'border-page text-page' : 'border-machine-line text-[#858483]')}>
                  {connectorName(c)} · {calls[c] ?? 0}
                </span>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-3 gap-4">
              <Counter value={`${checksDone} / ${checks.length}`} label="Trial checks" />
              <Counter value={String(pages)} label="Pages read" />
              <Counter value={String(read)} label="Sources read" />
            </div>
            <div className="mt-5 border-t border-machine-line pt-4">
              <Label className="text-[#adadac]">What happened</Label>
              <ul className="mt-2 h-[260px] space-y-1.5 overflow-hidden font-mono text-[12px]">
                {log.map((e, i) => (
                  <li key={`${e.t}-${i}`} className="flex gap-3">
                    <span className="w-10 shrink-0 text-[#858483]">{mmss(e.t)}</span>
                    <span className="shrink-0 text-[#858483]">{e.run.replace(/^(trial_check|found_check):/, '').replace(':', '') || e.run}</span>
                    {e.k === 'tool' ? (
                      <span className="text-page">
                        {e.connector}.{e.tool}
                      </span>
                    ) : e.k === 'extract' ? (
                      <span className="truncate text-[#adadac]">Read {e.url.replace(/^https?:\/\//, '')}</span>
                    ) : e.k === 'search' ? (
                      <span className="truncate text-[#adadac]">{e.m}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-machine-line pt-4">
              <span className="font-mono text-[11px] uppercase text-[#adadac]">{Object.values(calls).reduce((a, b) => a + b, 0)} connector calls so far</span>
              <a href={`/c/${keyName}/hood`} className="font-mono text-[11px] uppercase text-page underline">
                Under the hood →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stage({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={cx('inline-flex h-6 items-center rounded-[3px] border px-2 font-mono text-[10px] uppercase tracking-[0.05em]', on ? 'border-page bg-page text-ink' : 'border-machine-line text-[#858483]')}>
      {label}
    </span>
  );
}

function Counter({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="text-[28px] leading-none text-page">{value}</p>
      <p className="mt-1 font-mono text-[10px] uppercase text-[#adadac]">{label}</p>
    </div>
  );
}
