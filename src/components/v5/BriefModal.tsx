'use client';

// The weekly brief, opened over the current view: past issues on the left, the
// selected issue on the right. Every claim links to its source.

import { useEffect, useRef, useState } from 'react';
import type { Brief } from '@/lib/space/types';
import { hostOf } from '@/lib/space/view';
import { BriefMarkdown } from './BriefMarkdown';
import { BriefReplay } from './BriefReplay';
import { Favicon } from './Favicon';

const fmt = (iso: string, month: 'long' | 'short' = 'long') => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month, day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function BriefModal({ disease, name, issues, issue, onIssue, onClose }: { disease: string; name: string; issues: string[]; issue: string; onIssue: (d: string) => void; onClose: () => void }) {
  const [brief, setBrief] = useState<{ issue: string; brief: Brief | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/d/${disease}/brief?issue=${issue}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => live && setBrief({ issue, brief: b }))
      .catch(() => live && setBrief({ issue, brief: null }));
    return () => {
      live = false;
    };
  }, [disease, issue]);
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  const b = brief?.issue === issue ? brief.brief : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <button type="button" aria-label="Close the brief" onClick={onClose} className="absolute inset-0 cursor-default bg-ink/40" />
      <div role="dialog" aria-modal="true" aria-label={`${name} weekly brief`} className="relative flex h-[min(88vh,920px)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[6px] border border-line bg-card shadow-[0_24px_64px_rgba(29,27,22,0.18)]">
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3">
          <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.06em]">
            <span className="h-1.5 w-1.5 bg-orange" /> {name} · Weekly brief
          </p>
          <button ref={closeRef} type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink">
            Close ✕
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav aria-label="Issues" className="hidden w-[220px] shrink-0 flex-col border-r border-line bg-page sm:flex">
            <p className="px-4 pb-2 pt-4 font-mono text-[10px] uppercase tracking-[0.06em] text-faint">Issues</p>
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {issues.map((d, i) => (
                <li key={d}>
                  <button type="button" onClick={() => onIssue(d)} aria-current={d === issue ? 'true' : undefined} className={`mb-1 w-full rounded-[4px] border px-3 py-2.5 text-left ${d === issue ? 'border-orange bg-card' : 'border-transparent hover:border-line hover:bg-card/70'}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{fmt(d, 'short')}</span>
                      {i === 0 ? <span className="rounded-[2px] border border-orange px-1 font-mono text-[8px] uppercase tracking-[0.06em] text-orange">Latest</span> : null}
                    </span>
                    {d === issue && b ? <span className="mt-1 line-clamp-2 block text-[11px] leading-snug text-muted">{b.title}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 font-mono text-[9px] leading-relaxed text-faint">A new issue each week, from that week&apos;s news and registry changes.</p>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {b === undefined ? (
              <div className="m-8 h-40 animate-pulse rounded bg-wash" />
            ) : !b ? (
              <p className="m-8 text-[14px] text-muted">This issue could not be loaded.</p>
            ) : (
              <article className="max-w-[720px] px-6 pb-10 pt-6 sm:px-8">
                <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  {fmt(b.from)} to {fmt(b.date)}
                </p>
                <h2 className="mt-2 text-[30px] leading-tight tracking-[-0.01em]">{b.title}</h2>
                <p className="mt-2 text-[13px] text-muted">
                  {b.markdown
                    ? 'Researched and written by one Parallel deep-research Task run, starting from the week’s registry changes and news and searching the web, ClinicalTrials.gov and PubMed for what they miss. Every claim cites its source.'
                    : 'Written by a Parallel Task run from the period’s news and registry changes only. Every claim links to its source; sources not in the input are dropped.'}
                </p>
                <BriefReplay disease={disease} issue={issue} />
                {b.markdown ? <BriefMarkdown markdown={b.markdown} references={b.references ?? []} /> : null}
                {(b.sections ?? []).map((s) => (
                  <section key={s.heading} className="mt-7 border-t border-line pt-5">
                    <h3 className="text-[19px]">{s.heading}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed">{s.body}</p>
                    <p className="mt-3 flex flex-wrap gap-2">
                      {s.sources.map((u) => (
                        <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:border-ink hover:text-ink">
                          <Favicon host={hostOf(u)} name={hostOf(u) ?? '?'} size={12} /> {hostOf(u)}
                        </a>
                      ))}
                    </p>
                  </section>
                ))}
              </article>
            )}
          </div>
        </div>
        <p className="shrink-0 border-t border-line px-5 py-2.5 font-mono text-[10px] text-faint">Research support from public sources. Not investment or medical advice. Task run {b?.run_id ?? '…'}</p>
      </div>
    </div>
  );
}
