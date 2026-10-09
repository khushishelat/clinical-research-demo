'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { REQUEST_URL } from '@/lib/links';
import { Ago } from './Ago';

type Indication = { key: string; name: string; area: string | null; trials: number; companies: number; investigators: number };

export function Header({ current, diseases, updated }: { current: string; diseases: Indication[]; updated: string | null }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const cur = diseases.find((d) => d.key === current);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);
  const max = Math.max(1, ...diseases.map((d) => d.trials));
  // Grouped by therapeutic area, in the order the config lists them.
  const areas = [...new Set(diseases.map((d) => d.area ?? 'Other'))];
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-page/95 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-8">
        <Link href="/" className="flex items-center gap-4" aria-label="Trial Check home">
          {/* Official lockup, never redrawn. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/parallel-lockup.svg" alt="Parallel" className="h-4 w-auto" />
          <span className="hidden h-6 w-px bg-line sm:block" />
          <span className="hidden font-mono text-[12px] tracking-[0.08em] sm:block">TRIAL CHECK</span>
        </Link>
        <div ref={ref} className="relative">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox" className="flex h-9 items-center gap-2 rounded-[4px] border border-line-strong bg-card px-3 hover:border-ink">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Indication</span>
            <span className="text-[14px] font-medium">{cur?.name ?? 'Pick one'}</span>
            <span aria-hidden="true" className="text-muted">▾</span>
          </button>
          {open ? (
            <div role="listbox" className="absolute left-0 top-11 w-[min(600px,90vw)] rounded-[4px] border border-line bg-card shadow-[0_8px_24px_rgba(29,27,22,0.08)]">
              <div className="grid grid-cols-[minmax(0,1fr)_150px_70px_80px] gap-3 border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                <span>Indication</span>
                <span>Active trials</span>
                <span>Companies</span>
                <span>Investigators</span>
              </div>
              {areas.map((area) => (
                <div key={area} role="group" aria-label={area}>
                  <p className="bg-page px-4 pb-1 pt-2.5 font-mono text-[10px] uppercase tracking-[0.06em] text-faint">{area}</p>
                  {diseases
                    .filter((d) => (d.area ?? 'Other') === area)
                    .map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        role="option"
                        aria-selected={d.key === current}
                        onClick={() => {
                          setOpen(false);
                          router.push(`/d/${d.key}`);
                        }}
                        className="grid w-full grid-cols-[minmax(0,1fr)_150px_70px_80px] items-center gap-3 px-4 py-2.5 text-left hover:bg-wash"
                      >
                        <span className="text-[14px] font-medium">
                          {d.key === current ? '✓ ' : ''}
                          {d.name}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 rounded-full bg-ink" style={{ width: `${Math.max(6, (d.trials / max) * 90)}px` }} />
                          <span className="font-mono text-[12px]">{d.trials}</span>
                        </span>
                        <span className="font-mono text-[12px]">{d.companies}</span>
                        <span className="font-mono text-[12px]">{d.investigators}</span>
                      </button>
                    ))}
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2">
                <p className="text-[12px] text-muted">Trial counts from ClinicalTrials.gov.</p>
                <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="shrink-0 rounded-[4px] border border-line-strong px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.04em] hover:border-ink">
                  Request an indication ↗
                </a>
              </div>
            </div>
          ) : null}
        </div>
        {updated ? (
          <span className="ml-auto hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.05em] text-muted md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> <Ago iso={updated} /> · refreshed daily
          </span>
        ) : null}
      </div>
    </header>
  );
}
