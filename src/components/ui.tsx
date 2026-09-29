// Shared presentational pieces (HANDOFF-v2.1 section 9). Server-safe: no hooks.

import type { ReactNode } from 'react';
import type { ConnectorLogEntry, Flag, HandCheck, RunBy } from '@/lib/domain/types';
import { publicUrl } from '@/lib/domain/links';
import { domainOf, fmtDate, milestoneLabel, roleLabel, sourceType } from '@/lib/view/format';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('mono-label text-muted', className)}>{children}</span>;
}

export function Chip({ children, tone = 'plain', title, className }: { children: ReactNode; tone?: 'plain' | 'ink' | 'wash' | 'orange' | 'dashed' | 'ok'; title?: string; className?: string }) {
  const tones = {
    plain: 'border border-line-strong bg-card text-ink',
    ink: 'bg-ink text-page',
    wash: 'bg-wash text-ink',
    orange: 'bg-orange-wash text-ink',
    dashed: 'border border-dashed border-line-strong text-muted',
    ok: 'bg-ok-wash text-ok',
  } as const;
  return (
    <span title={title} className={cx('inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.05em]', tones[tone], className)}>
      {children}
    </span>
  );
}

const FLAG_TEXT: Record<Flag, string> = { conflict: 'Conflict', registry_lagging: 'Registry lagging', news: 'News', no_news: 'No news' };

/** Only lags and conflicts get a badge; orange wash is reserved for them. */
export function FlagBadge({ flag, pending }: { flag: Flag | undefined; pending?: boolean }) {
  if (pending) return <Chip tone="dashed" title="The registry status changed since this was recorded. The weekly re-run settles it.">Registry changed · in next check</Chip>;
  if (flag === 'conflict') return <Chip className="bg-orange text-ink">Conflict</Chip>;
  if (flag === 'registry_lagging') return <Chip tone="orange">{FLAG_TEXT[flag]}</Chip>;
  return <span className="font-mono text-[11px] text-faint">None</span>;
}

export function MilestoneTag({ type, approved }: { type: string; approved?: string }) {
  if (approved) return <Chip tone="ink">✓ Approved · {approved}</Chip>;
  return <Chip>{milestoneLabel(type)}</Chip>;
}

export function RoleBadge({ role }: { role: RunBy }) {
  return <Chip tone={role === 'investigator_led' ? 'wash' : 'plain'}>{roleLabel[role]}</Chip>;
}

function PlugIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 1v4M11 1v4M3 5h10v3a5 5 0 0 1-10 0V5zM8 13v2" />
    </svg>
  );
}

const CONNECTOR_NAME: Record<string, string> = {
  clinical_trials: 'ClinicalTrials.gov',
  pubmed: 'PubMed',
  chembl: 'ChEMBL',
  biorxiv: 'bioRxiv',
  npi_registry: 'NPI Registry',
};
export const connectorName = (c: string) => CONNECTOR_NAME[c] ?? c;

/**
 * "Via connector" marker: only where a connector, not the web, produced the
 * fact. One per section. Hover lists the tool calls behind it.
 */
export function ConnectorMarker({ connector, calls = [], dark }: { connector: string; calls?: Pick<ConnectorLogEntry, 'tool' | 'arguments'>[]; dark?: boolean }) {
  const title = calls.length ? calls.slice(0, 8).map((c) => `${connector}.${c.tool} ${c.arguments}`).join('\n') : `Produced by the ${connectorName(connector)} data connector`;
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 font-mono text-[10px] uppercase leading-none tracking-[0.05em]',
        dark ? 'border-page text-page' : 'border-ink text-ink'
      )}
    >
      <PlugIcon /> Via {connectorName(connector)} connector
    </span>
  );
}

/** Plain source chip for web news and filings: type · domain · date ↗ */
export function SourceChip({ url, date, nctId }: { url: string | null | undefined; date?: string | null; nctId?: string }) {
  if (!url) return null;
  // Connector server URLs are not public pages; map them or drop the chip.
  const href = publicUrl(url, { nctId });
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-muted hover:border-ink hover:text-ink">
      <span>{sourceType(href)}</span>
      <span className="normal-case">· {domainOf(href)}</span>
      {date ? <span>· {fmtDate(date)}</span> : null}
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function HandChecked({ checks }: { checks: HandCheck[] }) {
  if (!checks.length) return null;
  const confirmed = checks.filter((c) => c.verdict === 'confirmed');
  const partly = checks.filter((c) => c.verdict === 'partly');
  if (!confirmed.length && !partly.length) return null;
  const c = confirmed[0] ?? partly[0];
  const title = `Checked by a person on ${fmtDate(c.checked)}: ${c.claim}${c.note ? `. ${c.note}` : ''}`;
  return (
    <Chip tone="ink" title={title}>
      {confirmed.length ? '✓ Hand-checked' : '✓ Partly'}
    </Chip>
  );
}

export function Unconfirmed({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <span className="text-faint" title={note}>
      {children} <Chip tone="dashed">Unconfirmed</Chip>
    </span>
  );
}

export function Card({ children, className, dark }: { children: ReactNode; className?: string; dark?: boolean }) {
  return <div className={cx('rounded-[4px] border', dark ? 'border-machine-line bg-machine text-page' : 'border-line bg-card', className)}>{children}</div>;
}

export function Logo({ className }: { className?: string }) {
  // Official lockup (never redrawn), from designs/v2.1.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/parallel-lockup.svg" alt="Parallel" className={cx('h-4 w-auto', className)} />;
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <footer className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-line py-6 text-[13px] text-muted">
      <p>Research support from public sources. Not investment or medical advice. Coverage of trials and disclosures is not complete.</p>
      {children}
    </footer>
  );
}
