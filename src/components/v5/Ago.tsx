'use client';

// "Updated 3 hours ago", kept current while the page is open. The server renders the date,
// so pages cached for an hour never show a stale relative time.

import { useSyncExternalStore } from 'react';

const subscribe = (cb: () => void) => {
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};
const minute = () => Math.floor(Date.now() / 60_000);

export function Ago({ iso, prefix = 'Updated' }: { iso: string; prefix?: string }) {
  const now = useSyncExternalStore(subscribe, minute, () => 0);
  const date = new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  if (!now) return <>{`${prefix} ${date}`}</>;
  const mins = Math.max(0, now - Math.floor(Date.parse(iso) / 60_000));
  const ago = mins < 2 ? 'just now' : mins < 60 ? `${mins} minutes ago` : mins < 48 * 60 ? `${Math.round(mins / 60)} hours ago` : `${Math.round(mins / 1440)} days ago`;
  return <span title={date}>{`${prefix} ${ago}`}</span>;
}
