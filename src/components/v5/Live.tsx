'use client';

// What keeps an open page current between daily refreshes: the countdown to the next
// check, relative days, what is new since the last visit, and a quiet poll that reloads
// the page's data once the daily job has written something newer. None of it runs a
// Parallel task; the poll reads a cached status route.

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useSyncExternalStore } from 'react';

/** The daily job (vercel.json) starts at 12:00 UTC and takes a few minutes per indication. */
const REFRESH_HOUR_UTC = 12;
const CHECKING_MINUTES = 30;
const POLL_MS = 2 * 60_000;
/** Reopening within this gap is the same visit, so "new" items stay marked on a reload. */
const VISIT_GAP_MS = 30 * 60_000;

const everyMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};
const minute = () => Math.floor(Date.now() / 60_000);
const useMinute = () => useSyncExternalStore(everyMinute, minute, () => 0);
const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Next check in 5h 12m", or "Checking sources now…" while today's job runs. */
export function NextCheck({ updated }: { updated: string | null }) {
  const m = useMinute();
  if (!m) return <>Checked daily</>;
  const now = m * 60_000;
  const d = new Date(now);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), REFRESH_HOUR_UTC);
  const next = now < today ? today : today + 86_400_000;
  const last = next - 86_400_000;
  if (now - last < CHECKING_MINUTES * 60_000 && (!updated || Date.parse(updated) < last)) return <>Checking sources now…</>;
  const mins = Math.ceil((next - now) / 60_000);
  return <>Next check in {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}</>;
}

/** "Today", "Yesterday", "3 days ago" (or "3d ago"), then the date; the server renders the date. */
export function RelDay({ iso, short = false }: { iso: string; short?: boolean }) {
  const m = useMinute();
  const date = fmt(iso);
  if (!m) return <>{date}</>;
  const now = new Date(m * 60_000);
  const local = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((local - Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
  return <span title={date}>{days === 0 ? 'Today' : days === 1 ? 'Yesterday' : days > 1 && days < 7 ? (short ? `${days}d ago` : `${days} days ago`) : date}</span>;
}

// The ids seen on the previous visit, read once per page load and kept for its lifetime.
const baselines = new Map<string, string[] | null>();
function baseline(scope: string): string[] | null {
  if (!baselines.has(scope)) {
    let base: string[] | null = null;
    try {
      const s = JSON.parse(localStorage.getItem(`tc-seen:${scope}`) ?? 'null') as { at: number; ids: string[]; base: string[] | null } | null;
      if (s) base = Date.now() - s.at < VISIT_GAP_MS ? s.base : s.ids;
    } catch {
      // storage blocked or unreadable: treat as a first visit
    }
    baselines.set(scope, base);
  }
  return baselines.get(scope)!;
}
const noSubscribe = () => () => {};

/** Which of `ids` arrived since this browser's last visit; null on a first visit or before hydration. */
export function useSinceLastVisit(scope: string, ids: string[]): Set<string> | null {
  const base = useSyncExternalStore(noSubscribe, () => baseline(scope), () => undefined);
  const key = ids.join('|');
  useEffect(() => {
    if (base === undefined) return;
    try {
      localStorage.setItem(`tc-seen:${scope}`, JSON.stringify({ at: Date.now(), ids: key ? key.split('|') : [], base }));
    } catch {
      // private mode: every visit is a first visit
    }
  }, [scope, key, base]);
  return useMemo(() => {
    if (!base) return null;
    const seen = new Set(base);
    return new Set(key ? key.split('|').filter((id) => !seen.has(id)) : []);
  }, [base, key]);
}

/** Reloads the page's data, keeping scroll and open panels, once the daily job has run. */
export function LiveRefresh({ updated, scope }: { updated: string | null; scope?: string }) {
  const router = useRouter();
  useEffect(() => {
    if (!updated) return;
    let live = true;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await fetch('/api/status', { cache: 'no-store' });
        const s = (await r.json()) as { updated: Record<string, string> };
        const latest = scope ? s.updated[scope] : Object.values(s.updated).sort().at(-1);
        if (live && latest && latest > updated) router.refresh();
      } catch {
        // offline or between deploys: try again next time
      }
    };
    const id = window.setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      live = false;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [updated, scope, router]);
  return null;
}
