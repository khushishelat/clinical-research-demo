// The dataset behind the map: one row per company, one column per researched
// field. Every cell names the field whose basis (citations, reasoning,
// confidence) the Task run returned for it. Pure.

import { comparatorLabel, phaseLabel, regulatoryLabel, routeLabel } from './labels';
import type { Space } from './load';
import { isAssetDeal } from './labels';
import { dealValue, drugLabels, hostOf } from './view';

type S = NonNullable<Space>;
/** Why a cell is empty when no research run covers it: computed from the registry, with each trial cited. */
export type Why = { text: string; trials: { nct: string; label: string; detail: string }[] };
export type Cell = { field: string; text: string; sub?: string; source?: string | null; why?: Why };
export type DatasetRow = { key: string; name: string; host: string | null; webOnly: boolean; trials: number; cells: Record<string, Cell>; run: string | null; connectors: Record<string, number>; seconds: number | null };

export const COLUMNS: { field: string; label: string; help: string }[] = [
  { field: 'furthest_along', label: 'Highest phase', help: 'The company’s most advanced asset in this indication, its phase, and where.' },
  { field: 'lead_assets', label: 'Assets', help: 'Assets the company is developing in this indication.' },
  { field: 'how_given', label: 'Route · frequency', help: 'Route of administration and frequency of the lead asset.' },
  { field: 'pivotal', label: 'Pivotal comparator', help: 'What the lead pivotal trial compares against: placebo, standard of care, or a named drug.' },
  { field: 'latest_readout', label: 'Latest readout', help: 'The most recent reported results of one of the company’s trials, from its own research run.' },
  { field: 'regulatory', label: 'Regulatory', help: 'Designations (Breakthrough Therapy, PRIME, Fast Track…), filings and expected decisions.' },
  { field: 'deals', label: 'Deals', help: 'Licensing, M&A and partnerships for these assets. Financings are not counted.' },
  { field: 'approvals', label: 'Approvals', help: 'Approvals in this indication, by region.' },
];

/** "Approved for non-cirrhotic MASH" → "Approved"; "Phase IIb" → "Phase 2". The run's wording stays in the basis. */
function stageOf(phase: string | null | undefined): string {
  const p = phase ?? '';
  if (!p) return '—';
  if (phaseLabel(p) !== p) return phaseLabel(p);
  if (/approved|marketed|authori[sz]ed/i.test(p) && !/not approved|pre-?approval/i.test(p)) return 'Approved';
  const roman: Record<string, string> = { i: '1', ii: '2', iii: '3', iv: '4' };
  const m = p.match(/phase\s*(\d|iv|i{1,3})(?:\s*\/\s*(\d|iv|i{1,3}))?/i);
  if (m) return `Phase ${roman[(m[2] ?? m[1]).toLowerCase()] ?? m[2] ?? m[1]}`;
  return /preclinical/i.test(p) ? 'Preclinical' : p.split(/[;,(]/)[0].trim();
}

const STATUS: Record<string, string> = { RECRUITING: 'recruiting', NOT_YET_RECRUITING: 'not yet recruiting', ACTIVE_NOT_RECRUITING: 'active, not recruiting', ENROLLING_BY_INVITATION: 'enrolling by invitation', COMPLETED: 'completed', TERMINATED: 'terminated', SUSPENDED: 'suspended', WITHDRAWN: 'withdrawn' };
const phaseOf = (phases: string[]) => phases.map((p) => p.replace('EARLY_PHASE1', 'Early Phase 1').replace('PHASE', 'Phase ')).join('/').replace('/Phase ', '/') || 'Phase n/a';

/**
 * Why a company has no readout to show, from the rule the pipeline uses (scripts/lib/units.ts
 * readoutTrials): its own trials are checked once they are Phase 2 or later and past primary
 * completion, closed to enrollment, or named in a data disclosure.
 */
function readoutWhy(s: S, c: S['companies'][number], f: NonNullable<S['facts'][string]>, today: string): Why {
  const own = c.trials.map((n) => s.trials.find((t) => t.nct === n)).filter((t): t is S['trials'][number] => Boolean(t));
  if (!own.length) return { text: c.investigator_trials.length ? 'Only investigator-sponsored trials of its drugs are in the registry, and those are not checked for readouts.' : 'The company has no trials in the registry for this indication; it was added from web research.', trials: [] };
  const withData = new Set((f.milestones ?? []).filter((m) => m.type === 'data' && m.nct).map((m) => m.nct));
  const due = (t: (typeof own)[number]) => t.phase_level >= 2 && (withData.has(t.nct) || t.status === 'ACTIVE_NOT_RECRUITING' || (t.primary_completion !== '' && t.primary_completion.slice(0, 7) <= today.slice(0, 7)));
  const trials = own
    .slice()
    .sort((a, b) => b.phase_level - a.phase_level || (a.primary_completion || '9').localeCompare(b.primary_completion || '9'))
    .slice(0, 8)
    .map((t) => ({
      nct: t.nct,
      label: t.acronym || t.nct,
      detail: [phaseOf(t.phases), STATUS[t.status] ?? t.status.toLowerCase(), t.primary_completion ? `primary completion ${t.primary_completion}` : 'primary completion not stated', t.phase_level < 2 ? 'earlier than Phase 2' : due(t) ? 'due for a check in the next daily refresh' : 'not yet at a readout point'].join(' · '),
    }));
  return { text: own.some(due) ? 'A trial has reached its readout point since the last check; it will be checked in the next daily refresh.' : 'None of its trials has reached a readout point yet: readouts are checked from Phase 2, once a trial is past primary completion, closed to enrollment, or named in a data disclosure.', trials };
}

const short = (x: string | null | undefined, n = 110) => (!x ? '' : x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x);

export function datasetView(s: S, today = new Date().toISOString().slice(0, 10)) {
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
    cells.how_given = { field: 'how_given', text: routeLabel(f.how_given?.route) || '—', sub: f.how_given?.frequency ?? undefined };
    const piv = f.pivotal?.[0];
    cells.pivotal = { field: 'pivotal', text: piv ? (piv.comparator === 'active' && piv.comparator_name ? piv.comparator_name : comparatorLabel(piv.comparator)) : '—', sub: piv?.nct ?? undefined };
    // The most recent readout of the company's trials; its basis is that trial's READOUT run.
    const ro = (f.readouts ?? []).slice().sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))[0];
    const trial = ro ? s.trials.find((t) => t.nct === ro.nct) : undefined;
    cells.latest_readout = ro
      ? { field: `readouts.${ro.nct}`, text: short(ro.arms.map((a) => `${a.arm}: ${a.result}`).join('; ')) || short(ro.endpoint) || 'Reported', sub: [trial?.acronym || ro.nct, ro.date].filter(Boolean).join(' · '), source: ro.source_url }
      : // No reported results: the readout runs that found none sit under readouts.<nct>; when no
        // run covered the company, `why` explains from the registry.
        { field: 'readouts', text: '—', why: readoutWhy(s, c, f, today) };
    const reg = f.regulatory ?? [];
    const done = [...new Set(reg.filter((r) => r.status === 'done').map((r) => regulatoryLabel(r.kind)))];
    const expected = reg.find((r) => r.status === 'expected');
    cells.regulatory = { field: 'regulatory', text: done.join(', ') || (expected ? 'None yet' : '—'), sub: expected ? `Next: ${regulatoryLabel(expected.kind)}${expected.window || expected.date ? `, ${expected.window ?? expected.date}` : ''}` : undefined, source: expected?.source_url ?? reg[0]?.source_url ?? null };
    const deals = (f.deals ?? []).slice().sort((a, b) => Number(isAssetDeal(b.about)) - Number(isAssetDeal(a.about)) || dealValue(b) - dealValue(a) || (b.date ?? '').localeCompare(a.date ?? ''));
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
