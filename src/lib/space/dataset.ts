// The dataset behind the map: one row per company, one column per researched
// field. Every cell names the field whose basis (citations, reasoning,
// confidence) the Task run returned for it. Pure.

import type { Space } from './load';
import { drugLabels, hostOf } from './view';

type S = NonNullable<Space>;
export type Cell = { field: string; text: string; sub?: string; source?: string | null };
export type DatasetRow = { key: string; name: string; host: string | null; webOnly: boolean; trials: number; cells: Record<string, Cell>; run: string | null; connectors: Record<string, number>; seconds: number | null };

export const COLUMNS: { field: string; label: string; help: string }[] = [
  { field: 'furthest_along', label: 'Furthest along', help: 'The company’s most advanced drug in this disease, its phase, and where.' },
  { field: 'lead_assets', label: 'Drugs', help: 'Drugs the company is developing for this disease.' },
  { field: 'how_given', label: 'How it’s given', help: 'Route and dosing frequency of the lead drug.' },
  { field: 'pivotal_comparator', label: 'Pivotal trial vs', help: 'What the lead pivotal trial compares against.' },
  { field: 'latest_readout', label: 'Latest data', help: 'The most recent reported result, with its date.' },
  { field: 'next_regulatory_decision', label: 'Next regulatory decision', help: 'An agency decision date or window the company has stated.' },
  { field: 'deals', label: 'Deals', help: 'Licenses, acquisitions and partnerships for these drugs.' },
  { field: 'approvals', label: 'Approvals', help: 'Approvals in this disease, by region.' },
];

/** "Approved for non-cirrhotic MASH" → "Approved"; "Phase IIb" → "Phase 2". The run's wording stays in the basis. */
function stageOf(phase: string | null | undefined): string {
  const p = phase ?? '';
  if (!p) return '—';
  if (/approved|marketed|authori[sz]ed/i.test(p) && !/not approved|pre-?approval/i.test(p)) return 'Approved';
  const roman: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };
  const m = p.match(/phase\s*(\d|iv|i{1,3})(?:\s*\/\s*(\d|iv|i{1,3}))?/i);
  if (m) return `Phase ${roman[(m[2] ?? m[1]).toLowerCase()] ?? m[2] ?? m[1]}`;
  return /preclinical/i.test(p) ? 'Preclinical' : p.split(/[;,(]/)[0].trim();
}

const short = (x: string | null | undefined, n = 110) => (!x ? '' : x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x);

export function datasetView(s: S) {
  const rows: DatasetRow[] = [];
  for (const c of s.companies) {
    if (c.web_only && !s.included.has(c.name)) continue;
    const f = s.facts[c.key];
    if (!f) continue;
    const cells: Record<string, Cell> = {};
    const fa = f.furthest_along;
    cells.furthest_along = { field: 'furthest_along', text: stageOf(fa?.phase), sub: [fa?.drug, fa?.where && fa.where !== 'global' ? fa.where : fa?.where === 'global' ? 'Global' : null].filter(Boolean).join(' · ') };
    const drugs = drugLabels((f.lead_assets ?? []).map((name: string) => ({ name })));
    cells.lead_assets = { field: 'lead_assets', text: drugs.slice(0, 3).join(', ') || '—', sub: drugs.length > 3 ? `+${drugs.length - 3} more` : undefined };
    cells.how_given = { field: 'how_given', text: f.how_given?.route ?? '—', sub: f.how_given?.frequency ?? undefined };
    cells.pivotal_comparator = { field: 'pivotal_comparator', text: f.pivotal_comparator?.compared_against ?? '—', sub: f.pivotal_comparator?.nct ?? undefined };
    cells.latest_readout = { field: 'latest_readout', text: short(f.latest_readout?.result) || '—', sub: f.latest_readout?.date ?? undefined, source: f.latest_readout?.source_url ?? null };
    const nrd = f.next_regulatory_decision;
    cells.next_regulatory_decision = { field: 'next_regulatory_decision', text: nrd?.date_or_window ?? '—', sub: [nrd?.agency, nrd?.stated_by ? `stated by ${nrd.stated_by}` : null].filter(Boolean).join(' · ') || undefined, source: nrd?.source_url ?? null };
    const deals = (f.deals ?? []).slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    cells.deals = { field: 'deals', text: deals.length ? `${deals.length} deal${deals.length === 1 ? '' : 's'}` : '—', sub: deals[0] ? short(`${deals[0].headline}${deals[0].total || deals[0].upfront ? ` (${deals[0].total ?? `${deals[0].upfront} upfront`})` : ''}`, 90) : undefined, source: deals[0]?.source_url ?? null };
    const appr = f.approvals ?? [];
    cells.approvals = { field: 'approvals', text: appr.length ? [...new Set(appr.map((a) => a.region))].join(', ') : '—', sub: appr[0] ? `First ${appr.map((a) => a.date).filter(Boolean).sort()[0] ?? ''}` : undefined };
    const host = hostOf(c.owner_source ?? c.web?.source);
    rows.push({ key: c.key, name: c.name, host, webOnly: c.web_only, trials: c.trials.length + c.investigator_trials.length, cells, run: f._run ?? null, connectors: f._connectors ?? {}, seconds: f._seconds ?? null });
  }
  const rank = (r: DatasetRow) => (/approved/i.test(r.cells.furthest_along.text) ? 5 : Number(r.cells.furthest_along.text.match(/\d/)?.[0] ?? 0));
  rows.sort((a, b) => rank(b) - rank(a) || b.trials - a.trials);
  return { disease: { key: s.config.key, name: s.config.name }, updated: s.fetched, columns: COLUMNS, rows };
}

export type DatasetView = ReturnType<typeof datasetView>;

/** CSV of the dataset: plain values plus the source of each cell where one exists. */
export function datasetCsv(v: DatasetView): string {
  const esc = (x: string | number | null | undefined) => {
    const t = String(x ?? '');
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const head = ['company', 'trials_on_map', ...v.columns.flatMap((c) => [c.field, `${c.field}_detail`])];
  const lines = v.rows.map((r) => [r.name, r.trials, ...v.columns.flatMap((c) => [r.cells[c.field]?.text === '—' ? '' : r.cells[c.field]?.text, r.cells[c.field]?.sub ?? ''])].map(esc).join(','));
  return [head.join(','), ...lines].join('\n');
}
