'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

type Disease = { key: string; name: string; trials: number; companies: number; clinicians: number };

const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function Header({ current, diseases, updated }: { current: string; diseases: Disease[]; updated: string | null }) {
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
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Disease</span>
            <span className="text-[14px] font-medium">{cur?.name ?? 'Pick one'}</span>
            <span aria-hidden="true" className="text-muted">▾</span>
          </button>
          {open ? (
            <div role="listbox" className="absolute left-0 top-11 w-[min(560px,90vw)] rounded-[4px] border border-line bg-card shadow-[0_8px_24px_rgba(29,27,22,0.08)]">
              <div className="grid grid-cols-[minmax(0,1fr)_150px_60px_70px] gap-3 border-b border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                <span>Disease</span>
                <span>Active drug trials</span>
                <span>Companies</span>
                <span>Clinicians</span>
              </div>
              {diseases.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  role="option"
                  aria-selected={d.key === current}
                  onClick={() => {
                    setOpen(false);
                    router.push(`/d/${d.key}`);
                  }}
                  className="grid w-full grid-cols-[minmax(0,1fr)_150px_60px_70px] items-center gap-3 px-4 py-2.5 text-left hover:bg-wash"
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
                  <span className="font-mono text-[12px]">{d.clinicians}</span>
                </button>
              ))}
              <p className="border-t border-line px-4 py-2 text-[12px] text-muted">Counted from the ClinicalTrials.gov API. Add a disease with the pipeline in scripts/.</p>
            </div>
          ) : null}
        </div>
        {updated ? (
          <span className="ml-auto hidden items-center gap-2 font-mono text-[11px] uppercase tracking-[0.05em] text-muted md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Updated {fmt(updated)}
          </span>
        ) : null}
      </div>
    </header>
  );
}
