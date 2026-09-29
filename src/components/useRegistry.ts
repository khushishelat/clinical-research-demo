'use client';

// Today's registry, fetched once per page view and shared by every
// component that shows it (the company bar, the table, trial detail).

import { useEffect, useState } from 'react';
import type { Freshness } from '@/lib/domain/freshness';
import type { TrialRow } from '@/lib/domain/types';

export type RegistryNow = {
  checked_at: string;
  trials: number;
  changed: number;
  freshness: Record<string, Freshness>;
  new_trials: Omit<TrialRow, 'check'>[];
  stage1?: Omit<TrialRow, 'check'>[];
};

const inflight = new Map<string, Promise<RegistryNow | null>>();

function load(key: string): Promise<RegistryNow | null> {
  if (!inflight.has(key)) {
    inflight.set(
      key,
      fetch(`/api/registry/${key}`)
        .then((r) => (r.ok ? (r.json() as Promise<RegistryNow>) : null))
        .catch(() => null)
    );
  }
  return inflight.get(key)!;
}

export function useRegistry(key: string): { data: RegistryNow | null; loading: boolean } {
  const [data, setData] = useState<RegistryNow | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    load(key).then((d) => {
      if (!live) return;
      setData(d);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return { data, loading };
}

/** Seconds since a timestamp, ticking. */
export function useSecondsSince(iso: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null;
}
