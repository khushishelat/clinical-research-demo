'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { fmtDate } from '@/lib/view/format';
import { cx, Label } from './ui';
import { useRegistry, useSecondsSince } from './useRegistry';

type Props = {
  keyName: string;
  name: string;
  recorded: string | null;
  nextRefresh: string;
  refreshIncluded: boolean;
  scopeLabel?: string;
  competitors: number;
  replay: boolean;
  reading?: boolean;
};

export function CompanyBar(p: Props) {
  const { data, loading } = useRegistry(p.keyName);
  const since = useSecondsSince(data?.checked_at);
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const base = `/c/${p.keyName}`;
  const tabs = [
    { href: base, label: 'Landscape' },
    { href: `${base}/competitive`, label: 'Competitive set', count: p.competitors },
    { href: `${base}/company`, label: 'Company' },
    { href: `${base}/hood`, label: 'Under the hood', mono: true },
  ];
  const run = search.get('run');
  const withRun = (href: string) => (run ? `${href}?run=${run}` : href);
  return (
    <div className="pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-tight tracking-[-0.01em] sm:text-[40px]">{p.name}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] uppercase tracking-[0.05em] text-muted">
            {p.recorded ? <span>Research recorded {fmtDate(p.recorded)}</span> : <span>Researching now</span>}
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1.5">
              <span className={cx('h-1.5 w-1.5 rounded-full', data ? 'bg-ok' : 'bg-line-strong', loading && 'pulse')} />
              {data ? `Registry checked live ${since ?? 0} s ago` : loading ? 'Checking the registry…' : 'Registry check unavailable'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{p.refreshIncluded ? `Rechecked weekly · next ${fmtDate(p.nextRefresh, { year: false })}` : 'Refreshes when requested'}</span>
            {p.scopeLabel ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-ink">{p.scopeLabel}</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {p.replay ? (
            <button
              type="button"
              onClick={() => router.push(`${base}?replay=1`, { scroll: false })}
              className="h-9 rounded-[4px] border border-ink bg-card px-3 font-mono text-[12px] uppercase tracking-[0.04em] hover:bg-wash"
            >
              ▶ Replay how this was researched · 30 s
            </button>
          ) : null}
          {p.recorded ? (
            <a href={`/api/export/${p.keyName}`} className="inline-flex h-9 items-center rounded-[4px] border border-line-strong bg-card px-3 font-mono text-[12px] uppercase tracking-[0.04em] hover:border-ink">
              Export CSV
            </a>
          ) : null}
        </div>
      </div>
      <nav className="mt-6 flex gap-6 overflow-x-auto border-b border-line" aria-label="Company views">
        {tabs.map((t) => {
          const active = t.href === base ? pathname === base || pathname.startsWith(`${base}/t/`) : pathname.startsWith(t.href);
          const disabled = p.reading && t.href !== base;
          return disabled ? (
            <span key={t.href} className="whitespace-nowrap pb-3 text-[15px] text-faint">
              {t.label} <Label>Reading…</Label>
            </span>
          ) : (
            <Link
              key={t.href}
              href={withRun(t.href)}
              className={cx('whitespace-nowrap border-b-2 pb-3 text-[15px]', active ? 'border-ink' : 'border-transparent text-muted hover:text-ink', t.mono && 'font-mono text-[12px] uppercase tracking-[0.06em]')}
            >
              {t.label}
              {t.count ? <span className="ml-1.5 font-mono text-[12px] text-muted">{t.count}</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
