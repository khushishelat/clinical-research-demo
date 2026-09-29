'use client';

// Company typeahead (HANDOFF-v2.1 section 7). Recorded companies open
// instantly; others show their live registry count and time. Research is
// free for viewers: no prices, a confirm step, and "you can leave".

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Suggestion } from '@/lib/server/typeahead';
import { cx } from './ui';

type Props = { compact?: boolean; autoFocus?: boolean; initial?: string };

export function Typeahead({ compact, autoFocus, initial = '' }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<Suggestion | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/typeahead?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { suggestions: Suggestion[] };
        setItems(body.suggestions ?? []);
        setActive(0);
        setOpen(true);
      } catch {
        // aborted or offline
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const listId = useId();
  const visible = useMemo(() => (q.trim().length >= 2 ? items : []), [items, q]);
  const ready = useMemo(() => visible.filter((i) => i.state === 'recorded' || i.state === 'researched'), [visible]);
  const others = useMemo(() => visible.filter((i) => i.state !== 'recorded' && i.state !== 'researched'), [visible]);
  const ordered = [...ready, ...others];

  async function choose(s: Suggestion) {
    setOpen(false);
    setMessage(null);
    if (s.state === 'recorded' || s.state === 'researched') return router.push(`/c/${s.key}`);
    if (s.state === 'narrow') return router.push(`/c/${s.key}/narrow?name=${encodeURIComponent(s.name)}`);
    if (s.state === 'in_progress') return start(s);
    setConfirm(s);
  }

  async function start(s: Suggestion) {
    setMessage('Starting…');
    const res = await fetch('/api/research', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: s.name }) });
    const body = await res.json();
    if (body.status === 'started' || body.status === 'joined') return router.push(`/c/${body.key}?run=${body.taskgroup_id}`);
    if (body.status === 'narrow') return router.push(`/c/${body.key}/narrow?name=${encodeURIComponent(s.name)}`);
    setConfirm(null);
    setMessage(body.message ?? body.error ?? 'Could not start research.');
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open || !ordered.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, ordered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(ordered[active]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => visible.length > 0 && setOpen(true)}
        onKeyDown={onKey}
        autoFocus={autoFocus}
        placeholder={compact ? 'Search a company' : 'Type a company, e.g. Summit'}
        aria-label="Company"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={cx(
          'w-full rounded-[4px] border border-line-strong bg-card text-ink placeholder:text-faint focus:border-ink focus:outline-none',
          compact ? 'h-9 px-3 text-[14px]' : 'h-14 px-4 text-[20px]'
        )}
      />
      {loading ? <span className="pulse absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-orange" /> : null}
      {open && ordered.length > 0 ? (
        <div id={listId} role="listbox" className={cx('absolute z-40 mt-1 w-full overflow-hidden rounded-[4px] border border-line bg-card shadow-[0_8px_24px_rgba(29,27,22,0.08)]', compact && 'min-w-[360px] right-0')}>
          {ready.length ? <Group label="Ready now" /> : null}
          {ordered.map((s, i) => (
            <div key={s.key}>
              {i === ready.length && others.length ? <Group label="Not researched yet · live registry count" /> : null}
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={cx('flex w-full items-center justify-between gap-4 px-4 py-3 text-left', i === active && 'bg-wash')}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{s.name}</span>
                  <span className="block text-[13px] text-muted">{describe(s)}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{badge(s)}</span>
              </button>
            </div>
          ))}
          <div className="border-t border-line px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">Counts from ClinicalTrials.gov · ↑↓ to choose · Enter</div>
        </div>
      ) : null}
      {open && q.trim().length >= 2 && !loading && ordered.length === 0 ? (
        <div className="absolute z-40 mt-1 w-full rounded-[4px] border border-line bg-card px-4 py-3 text-[14px] text-muted">No sponsor matches. Try the drug name or another spelling.</div>
      ) : null}
      {confirm ? (
        <div className={cx('z-40 mt-2 rounded-[4px] border border-ink bg-card p-4', compact && 'absolute right-0 w-[360px]')}>
          <p className="text-[15px]">
            Research {confirm.name}: {confirm.trials} active trials, about {confirm.estimated_minutes ?? 8} minutes.
          </p>
          <p className="mt-1 text-[13px] text-muted">Every trial is checked against the company&apos;s news, filings and papers. You can leave; the link keeps working, and the result is shared.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => start(confirm)} className="h-9 rounded-[4px] bg-ink px-4 font-mono text-[13px] uppercase text-page">
              Research {confirm.trials} trials
            </button>
            <button type="button" onClick={() => setConfirm(null)} className="h-9 rounded-[4px] border border-line-strong px-4 font-mono text-[13px] uppercase">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {message ? <p className={cx('mt-2 text-[13px] text-muted', compact && 'absolute right-0 w-[360px] rounded-[4px] border border-line bg-card p-3')}>{message}</p> : null}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return <div className="border-b border-line bg-page px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{label}</div>;
}

function describe(s: Suggestion) {
  if (s.state === 'recorded') return s.scope_label ? `Recorded · ${s.scope_label}` : 'Recorded research';
  if (s.state === 'researched') return `Researched ${s.recorded ?? ''}`;
  if (s.state === 'narrow') return `${s.trials} active trials · too many for one run`;
  if (s.state === 'in_progress') return 'Being researched now';
  return `${s.trials} active trials in the registry · about ${s.estimated_minutes ?? 8} min`;
}

function badge(s: Suggestion) {
  return { recorded: 'Recorded · instant', researched: 'Researched · instant', narrow: 'Narrow first →', in_progress: 'In progress · join', not_researched: 'Not researched' }[s.state];
}
