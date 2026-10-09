'use client';

// The dataset view: every researched field per company. Clicking a cell shows
// why it says what it says: the Task run's citations, reasoning and confidence.

import { useEffect, useMemo, useState } from 'react';
import type { Cell, DatasetRow, DatasetView } from '@/lib/space/dataset';
import { Favicon } from './Favicon';
import { RunReplay } from './RunReplay';

type Basis = { field: string; citations: { title: string | null; url: string; excerpts: string[] | null }[]; reasoning: string; confidence: string | null };

// Column filters. `one`: pick a value. `tokens`: pick one item of a list ("United States" in
// "United States, Japan"). `has`: reported or not. `text`: contains. "—" is an empty cell.
type Kind = 'text' | 'one' | 'tokens' | 'has';
const KIND: Record<string, Kind> = { furthest_along: 'one', lead_assets: 'text', how_given: 'one', pivotal: 'one', latest_readout: 'has', regulatory: 'tokens', deals: 'has', approvals: 'tokens' };
const NONE = '__none';
const SOME = '__some';
const EMPTY = '—';
const tokens = (text: string) => (text === EMPTY ? [] : text.split(', ').map((t) => t.trim()).filter(Boolean));

function options(rows: DatasetRow[], field: string, kind: Kind): { value: string; label: string }[] {
  const texts = rows.map((r) => r.cells[field]?.text ?? EMPTY);
  const empty = texts.some((t) => t === EMPTY) ? [{ value: NONE, label: 'None' }] : [];
  if (kind === 'has') return [{ value: SOME, label: field === 'deals' ? 'Has deals' : 'Reported' }, ...empty];
  if (kind === 'tokens') {
    const n = new Map<string, number>();
    for (const t of texts.flatMap(tokens)) n.set(t, (n.get(t) ?? 0) + 1);
    return [...[...n].sort((a, b) => b[1] - a[1]).map(([t, c]) => ({ value: t, label: `${t} (${c})` })), ...empty];
  }
  // Rows arrive furthest-along first, so first appearance keeps phases in order.
  return [...[...new Set(texts.filter((t) => t !== EMPTY))].map((t) => ({ value: t, label: t })), ...empty];
}

function matches(text: string, kind: Kind, want: string): boolean {
  if (!want) return true;
  if (want === NONE) return text === EMPTY;
  if (want === SOME) return text !== EMPTY;
  if (kind === 'text') return text.toLowerCase().includes(want.toLowerCase());
  if (kind === 'tokens') return tokens(text).includes(want);
  return text === want;
}

export function Dataset({ view }: { view: DatasetView }) {
  const [open, setOpen] = useState<{ row: DatasetRow; cell: Cell; label: string } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [watch, setWatch] = useState(false);
  const active = Object.values(filters).filter(Boolean).length;
  const setFilter = (field: string, value: string) => setFilters((f) => ({ ...f, [field]: value }));
  const opts = useMemo(() => Object.fromEntries(view.columns.map((c) => [c.field, options(view.rows, c.field, KIND[c.field] ?? 'text')])), [view]);
  const rows = view.rows.filter((r) => matches(r.name, 'text', filters._company ?? '') && view.columns.every((c) => matches(r.cells[c.field]?.text ?? EMPTY, KIND[c.field] ?? 'text', filters[c.field] ?? '')));
  const control = 'h-7 w-full min-w-0 rounded-[3px] border border-line-strong bg-card px-1.5 font-sans text-[12px] normal-case tracking-normal text-ink placeholder:text-faint focus:border-ink focus:outline-none';
  return (
    <main className="px-4 pb-12 sm:px-8">
      <section className="flex flex-wrap items-center justify-between gap-3 pt-6">
        <h1 className="sr-only">{view.disease.name} landscape table</h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-muted">
          {rows.length === view.rows.length ? `${rows.length} companies` : `${rows.length} of ${view.rows.length} companies`} · click a cell for its sources
        </p>
        <div className="flex items-center gap-2">
          {active ? (
            <button type="button" onClick={() => setFilters({})} className="flex h-9 items-center rounded-[4px] border border-line-strong px-3 font-mono text-[11px] uppercase tracking-[0.05em] text-muted hover:border-ink hover:text-ink">
              Clear {active} filter{active === 1 ? '' : 's'}
            </button>
          ) : null}
          <button type="button" onClick={() => setWatch((v) => !v)} aria-expanded={watch} title="A recording of the Task Group that filled these columns, one run per company" className="flex h-9 items-center gap-2 rounded-[4px] border border-line-strong bg-card px-3 font-mono text-[11px] uppercase tracking-[0.05em] hover:border-ink">
            <span aria-hidden="true" className="text-orange">{watch ? '■' : '▶'}</span> Watch the research
          </button>
          <a href={`/api/d/${view.disease.key}/export`} className="flex h-9 items-center rounded-[4px] border border-ink bg-ink px-3 font-mono text-[11px] uppercase tracking-[0.05em] text-page hover:bg-ink/90">
            Download CSV
          </a>
        </div>
      </section>

      {watch ? (
        <section className="mt-4 rounded-[4px] border border-line bg-card p-4">
          <RunReplay disease={view.disease.key} job="facts" names={Object.fromEntries(view.rows.map((r) => [r.key, r.name]))} />
        </section>
      ) : null}

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
            <tr className="border-b border-line bg-page">
              <th className="sticky left-0 z-10 bg-page px-4 pb-2.5 font-normal">
                <input value={filters._company ?? ''} onChange={(e) => setFilter('_company', e.target.value)} placeholder="Company" aria-label="Filter by company" className={control} />
              </th>
              {view.columns.map((c) => {
                const kind = KIND[c.field] ?? 'text';
                return (
                  <th key={c.field} className="px-3 pb-2.5 font-normal">
                    {kind === 'text' ? (
                      <input value={filters[c.field] ?? ''} onChange={(e) => setFilter(c.field, e.target.value)} placeholder="Contains" aria-label={`Filter by ${c.label}`} className={control} />
                    ) : (
                      <select value={filters[c.field] ?? ''} onChange={(e) => setFilter(c.field, e.target.value)} aria-label={`Filter by ${c.label}`} className={`${control} ${filters[c.field] ? 'border-ink' : 'text-muted'}`}>
                        <option value="">All</option>
                        {opts[c.field].map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </th>
                );
              })}
              <th />
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
                      <button type="button" onClick={() => setOpen({ row: r, cell, label: c.label })} className={`h-full w-full px-3 py-3 text-left hover:bg-wash ${open?.row.key === r.key && open.cell.field === cell.field ? 'bg-orange-wash/60' : ''}`}>
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
      {!rows.length ? <p className="mt-3 text-[13px] text-muted">No company matches these filters.</p> : null}
      <p className="mt-3 text-[12px] text-muted">
        {rows.length} of {view.rows.length} companies. Empty cells mean the run found no dated public source, not that nothing exists.
      </p>
      {open ? <BasisPanel disease={view.disease.key} row={open.row} cell={open.cell} label={open.label} onClose={() => setOpen(null)} /> : null}
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
  // An empty readout cell: one note per trial the readout runs checked (readouts.<nct>.has_data).
  const checked = cell.field === 'readouts' && items ? [...new Map(items.filter((b) => b.field.endsWith('.has_data')).map((b) => [b.field.split('.')[1], b])).entries()] : [];
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
          {checked.length ? (
            <div className="mx-6 mt-5 space-y-2">
              <p className="text-[13px] text-muted">
                {checked.length} trial{checked.length === 1 ? ' was' : 's were'} checked for reported results; none had any.
              </p>
              {checked.map(([nct, b]) => (
                <div key={nct} className="rounded-[4px] border border-line p-3">
                  <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{nct}</p>
                  <p className="mt-1 text-[14px]">{b.reasoning}</p>
                </div>
              ))}
            </div>
          ) : top ? (
            <div className="mx-6 mt-5 rounded-[4px] border border-line p-4">
              <p className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Reasoning</span>
                {top.confidence ? <span className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em] ${CONF[top.confidence] ?? 'bg-wash'}`}>{top.confidence} confidence</span> : null}
              </p>
              <p className="mt-2 text-[14px]">{top.reasoning}</p>
            </div>
          ) : (
            cell.why ? (
              <div className="mx-6 mt-5 rounded-[4px] border border-line p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">From the registry · no research run covered this</p>
                <p className="mt-2 text-[14px]">{cell.why.text}</p>
                {cell.why.trials.length ? (
                  <ul className="mt-3 space-y-2">
                    {cell.why.trials.map((t) => (
                      <li key={t.nct} className="text-[13px]">
                        <a href={`https://clinicaltrials.gov/study/${t.nct}`} target="_blank" rel="noreferrer" className="font-medium hover:underline">
                          {t.label} ↗
                        </a>
                        <span className="block text-muted">{t.detail}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="mx-6 mt-5 text-[14px] text-muted">The run returned no basis for this field.</p>
            )
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
      {/* The run footer belongs to cells a research run filled; a registry explanation has none. */}
      {cell.why && !items?.length ? null : (
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
      )}
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
