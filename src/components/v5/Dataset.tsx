'use client';

// The dataset view: every researched field per company. Clicking a cell shows
// why it says what it says: the Task run's citations, reasoning and confidence.

import { useEffect, useState } from 'react';
import type { Cell, DatasetRow, DatasetView } from '@/lib/space/dataset';
import { Favicon } from './Favicon';
import { RunReplay } from './RunReplay';

type Basis = { field: string; citations: { title: string | null; url: string; excerpts: string[] | null }[]; reasoning: string; confidence: string | null };

export function Dataset({ view }: { view: DatasetView }) {
  const [open, setOpen] = useState<{ row: DatasetRow; cell: Cell } | null>(null);
  const [q, setQ] = useState('');
  const [watch, setWatch] = useState(false);
  const rows = q ? view.rows.filter((r) => `${r.name} ${Object.values(r.cells).map((c) => `${c.text} ${c.sub ?? ''}`).join(' ')}`.toLowerCase().includes(q.toLowerCase())) : view.rows;
  return (
    <main className="px-4 pb-12 sm:px-8">
      <section className="flex flex-wrap items-end justify-between gap-4 pt-8">
        <div>
          <h1 className="text-[36px] leading-tight tracking-[-0.01em]">{view.disease.name} dataset</h1>
          <p className="mt-1 max-w-[720px] text-[15px] text-muted">One row per company, researched by a Parallel Task run with the ClinicalTrials.gov and PubMed connectors. Click any cell to see its sources and how confident the run was.</p>
        </div>
        <div className="flex items-center gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter companies or drugs" aria-label="Filter" className="h-9 w-56 rounded-[4px] border border-line-strong bg-card px-3 text-[14px] placeholder:text-faint focus:border-ink focus:outline-none" />
          <a href={`/api/d/${view.disease.key}/export`} className="flex h-9 items-center rounded-[4px] border border-ink bg-ink px-3 font-mono text-[11px] uppercase tracking-[0.05em] text-page hover:bg-ink/90">
            Download CSV
          </a>
        </div>
      </section>

      <section className="mt-6 rounded-[4px] border border-line bg-card">
        <button type="button" onClick={() => setWatch((v) => !v)} aria-expanded={watch} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-wash">
          <span>
            <span className="text-[14px] font-medium">Watch the research</span>
            <span className="ml-2 text-[13px] text-muted">A recording of the Task Group that filled these columns, one run per company.</span>
          </span>
          <span aria-hidden="true" className="font-mono text-[12px] text-muted">
            {watch ? '▴' : '▾'}
          </span>
        </button>
        {watch ? (
          <div className="border-t border-line p-4">
            <RunReplay disease={view.disease.key} job="facts" names={Object.fromEntries(view.rows.map((r) => [r.key, r.name]))} />
          </div>
        ) : null}
      </section>

      <div className="mt-4 overflow-x-auto rounded-[4px] border border-line bg-card">
        <table className="w-full min-w-[1280px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-page font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
              <th className="sticky left-0 z-10 w-[220px] bg-page px-4 py-2.5 font-normal">Company</th>
              {view.columns.map((c) => (
                <th key={c.field} className="px-3 py-2.5 font-normal" title={c.help}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2.5 text-right font-normal">Trials</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line align-top last:border-b-0">
                <th scope="row" className="sticky left-0 z-10 bg-card px-4 py-3 font-normal">
                  <span className="flex items-center gap-2 text-[14px] font-medium">
                    <Favicon host={r.host} name={r.name} /> {r.name}
                  </span>
                  {r.webOnly ? <span className="mt-1 inline-block rounded-[2px] bg-orange-wash px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.05em]">Found on the web</span> : null}
                </th>
                {view.columns.map((c) => {
                  const cell = r.cells[c.field];
                  const empty = cell.text === '—';
                  return (
                    <td key={c.field} className="max-w-[240px] p-0">
                      <button type="button" onClick={() => setOpen({ row: r, cell })} className={`h-full w-full px-3 py-3 text-left hover:bg-wash ${open?.row.key === r.key && open.cell.field === c.field ? 'bg-orange-wash/60' : ''}`}>
                        <span className={`block text-[13px] ${empty ? 'text-faint' : ''}`}>{cell.text}</span>
                        {cell.sub ? <span className="mt-0.5 block text-[12px] text-muted">{cell.sub}</span> : null}
                      </button>
                    </td>
                  );
                })}
                <td className="px-3 py-3 text-right font-mono text-[13px]">{r.trials || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        {rows.length} of {view.rows.length} companies. Empty cells mean the run found no dated public source, not that nothing exists.
      </p>
      {open ? <BasisPanel disease={view.disease.key} row={open.row} cell={open.cell} label={view.columns.find((c) => c.field === open.cell.field)?.label ?? open.cell.field} onClose={() => setOpen(null)} /> : null}
    </main>
  );
}

const CONNECTOR: Record<string, string> = { clinical_trials: 'ClinicalTrials.gov', pubmed: 'PubMed', chembl: 'ChEMBL', npi_registry: 'NPI Registry', cms_coverage: 'CMS Coverage', biorxiv: 'bioRxiv' };
const CONF: Record<string, string> = { high: 'bg-ok-wash text-ok', medium: 'bg-wash text-ink', low: 'bg-orange-wash text-ink' };

function BasisPanel({ disease, row, cell, label, onClose }: { disease: string; row: DatasetRow; cell: Cell; label: string; onClose: () => void }) {
  const [basis, setBasis] = useState<{ key: string; items: Basis[] } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/d/${disease}/basis/${encodeURIComponent(row.key)}`)
      .then((r) => (r.ok ? r.json() : { basis: [] }))
      .then((b) => live && setBasis({ key: row.key, items: b.basis ?? [] }))
      .catch(() => live && setBasis({ key: row.key, items: [] }));
    return () => {
      live = false;
    };
  }, [disease, row.key]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  const items = basis?.key === row.key ? basis.items.filter((b) => b.field === cell.field || b.field.startsWith(`${cell.field}.`)) : null;
  const top = items?.find((b) => b.field === cell.field) ?? items?.[0];
  const cites = items ? [...new Map(items.flatMap((b) => b.citations).map((c) => [c.url, c])).values()] : [];
  return (
    <aside aria-label={`Basis for ${label}`} className="drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col overflow-y-auto border-l border-line bg-card shadow-[-8px_0_24px_rgba(29,27,22,0.06)]">
      <div className="sticky top-0 flex items-center justify-between border-b border-line bg-card px-6 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Basis</span>
        <button type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink">
          Close ✕
        </button>
      </div>
      <div className="px-6 pt-5">
        <p className="text-[13px] text-muted">{row.name}</p>
        <h2 className="mt-1 text-[22px] leading-tight">{label}</h2>
        <p className="mt-3 text-[15px]">{cell.text}</p>
        {cell.sub ? <p className="mt-0.5 text-[13px] text-muted">{cell.sub}</p> : null}
      </div>
      {!items ? (
        <div className="m-6 h-24 animate-pulse rounded bg-wash" />
      ) : (
        <>
          {top ? (
            <div className="mx-6 mt-5 rounded-[4px] border border-line p-4">
              <p className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Reasoning</span>
                {top.confidence ? <span className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em] ${CONF[top.confidence] ?? 'bg-wash'}`}>{top.confidence} confidence</span> : null}
              </p>
              <p className="mt-2 text-[14px]">{top.reasoning}</p>
            </div>
          ) : (
            <p className="mx-6 mt-5 text-[14px] text-muted">The run returned no basis for this field.</p>
          )}
          {cites.length ? (
            <section className="mt-5">
              <h3 className="px-6 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                {cites.length} source{cites.length === 1 ? '' : 's'}
              </h3>
              <ul className="mt-2">
                {cites.map((c) => (
                  <li key={c.url} className="border-t border-line px-6 py-3">
                    <a href={c.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-[14px] hover:underline">
                      <Favicon host={hostname(c.url)} name={hostname(c.url) ?? '?'} size={14} />
                      <span>{c.title || hostname(c.url)}</span>
                    </a>
                    {c.excerpts?.[0] ? <p className="mt-1 border-l-2 border-line pl-3 text-[13px] text-muted">{c.excerpts[0].slice(0, 320)}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      <div className="mt-auto border-t border-line px-6 py-4 font-mono text-[11px] text-muted">
        {row.run ? <p>Task run {row.run}</p> : null}
        <p className="mt-1">
          Connectors used:{' '}
          {Object.entries(row.connectors)
            .map(([k, n]) => `${CONNECTOR[k] ?? k} ×${n}`)
            .join(' · ') || 'none'}
          {row.seconds ? ` · ${Math.round(row.seconds)}s` : ''}
        </p>
      </div>
    </aside>
  );
}

const hostname = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
};
