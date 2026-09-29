// Stage 3: build a pack from raw Task run results. Pure apart from the
// registry lookup, which is injected. Same rules as validation/11-finalize.ts:
// - the flag is computed here, never by the model
// - found-by-research trials must exist, not list the company, have an
//   INDUSTRY lead sponsor, and name a company asset among their interventions
// - hand-check ticks carry over only for unchanged claims

import { carryOver, pinChecks, type PinnedCheck } from './handcheck';
import { nctIdsIn } from './programs';
import { flagFor } from './specs';
import type { BasisEntry, CompanyConfig, ConnectorLogEntry, FoundTrial, Pack, RegistryLookup, RegistryRecord, TrialCheck, TrialRow } from './types';

type RawResult = { run?: { run_id?: string; status?: string; created_at?: string | null; modified_at?: string | null }; output?: any } | null | undefined;
type RawEvents = { event: any }[] | null | undefined;

const calls = (r: RawResult): any[] => r?.output?.mcp_tool_calls ?? [];
const seconds = (r: RawResult) =>
  r?.run?.created_at && r?.run?.modified_at ? Math.round((Date.parse(r.run.modified_at) - Date.parse(r.run.created_at)) / 1000) : null;

export const basisOf = (r: RawResult): BasisEntry[] =>
  (r?.output?.basis ?? []).map((b: any) => ({
    field: b.field,
    confidence: b.confidence ?? null,
    citations: (b.citations ?? []).map((c: any) => ({ url: c.url, title: c.title ?? null })),
  }));

export const connectorLog = (r: RawResult): ConnectorLogEntry[] =>
  calls(r).map((k) => ({ connector: k.server_name, tool: k.tool_name, arguments: String(k.arguments).slice(0, 240), error: k.error || null, output_chars: String(k.content ?? '').length }));

function registryRecord(r: RawResult): RegistryRecord | null {
  const c = calls(r).find((k) => k.tool_name === 'get_trial_details');
  if (!c?.content) return null;
  try {
    const t = JSON.parse(c.content).trial ?? {};
    const locs: any[] = t.locations ?? [];
    const site_status: Record<string, number> = {};
    for (const l of locs) site_status[l.status ?? 'UNKNOWN'] = (site_status[l.status ?? 'UNKNOWN'] ?? 0) + 1;
    return {
      via: 'clinical_trials.get_trial_details',
      url: t.url ?? null,
      title: t.title ?? null,
      acronym: t.acronym ?? null,
      enrollment: t.enrollment ?? null,
      start_date: t.start_date ?? null,
      primary_completion_date: t.primary_completion_date ?? null,
      completion_date: t.completion_date ?? null,
      interventions: t.interventions ?? [],
      primary_outcomes: (t.primary_outcomes ?? []).map((o: any) => o.measure),
      secondary_outcome_count: (t.secondary_outcomes ?? []).length,
      has_results: t.has_results ?? null,
      sites: locs.length,
      countries: [...new Set(locs.map((l) => l.country).filter(Boolean))] as string[],
      site_status,
    };
  } catch {
    return null;
  }
}

function liveStats(events: RawEvents) {
  if (!events) return null;
  const stats = events.filter((e) => e.event?.type === 'task_run.progress_stats').map((e) => e.event);
  return { events: events.length, sources_considered: stats.at(-1)?.source_stats?.num_sources_considered ?? null, sources_read: stats.at(-1)?.source_stats?.num_sources_read ?? null };
}

export function checkFrom(status: string, r: RawResult, events?: RawEvents): TrialCheck | null {
  if (!r?.output) return null;
  const content = typeof r.output.content === 'string' ? JSON.parse(r.output.content) : (r.output.content ?? {});
  const byConnector: Record<string, number> = {};
  for (const c of calls(r)) byConnector[c.server_name] = (byConnector[c.server_name] ?? 0) + 1;
  const earlier = content.earlier_milestones ?? [];
  return {
    status: r.run?.status ?? 'completed',
    seconds: seconds(r),
    program: content.program ?? null,
    latest_milestone: content.latest_milestone ?? null,
    earlier_milestones: earlier,
    results_publications: content.results_publications ?? [],
    next_catalyst: content.next_catalyst ?? null,
    flag: flagFor(content.latest_milestone?.type, status, earlier.map((m: any) => m?.type)),
    connector_calls: byConnector,
    citations: basisOf(r).reduce((n, b) => n + b.citations.length, 0),
    basis: basisOf(r),
    registry_record: registryRecord(r),
    connector_log: connectorLog(r),
    live: liveStats(events),
  };
}

/** Lower-case asset names and codes from the snapshot, for the intervention check. */
export function assetTokens(programs: readonly { asset: string }[]): string[] {
  const stop = new Set(['with', 'and', 'alone', 'plus', 'combination', 'chemotherapy', 'directed', 'car-t', 'fast', 'degrader', 'bispecific', 'antibody', 'inhibitor', 'therapy', 'injection']);
  const tokens = new Set<string>();
  for (const p of programs)
    for (const t of p.asset.split(/[\s,;()/+]+/)) {
      const k = t.trim().toLowerCase();
      if (k.length >= 4 && /[a-z]/.test(k) && !stop.has(k)) tokens.add(k);
    }
  return [...tokens];
}

export function filterFoundTrials(
  claimed: readonly string[],
  registry: Record<string, RegistryLookup>,
  opts: { match: string; tokens: readonly string[]; stage1Ids: ReadonlySet<string> }
): { kept: FoundTrial[]; excluded: (FoundTrial & { reasons: string[] })[] } {
  const kept: FoundTrial[] = [];
  const excluded: (FoundTrial & { reasons: string[] })[] = [];
  for (const id of new Set(claimed)) {
    if (!/^NCT\d{8}$/.test(id) || opts.stage1Ids.has(id)) continue;
    const r = registry[id];
    const reasons: string[] = [];
    if (!r) reasons.push('not found on ClinicalTrials.gov');
    else {
      if ([r.lead_sponsor, ...r.collaborators].some((n) => n.toLowerCase().includes(opts.match))) reasons.push('lists the company (already in the registry search)');
      if (r.lead_sponsor_class !== 'INDUSTRY') reasons.push(`lead sponsor is ${r.lead_sponsor_class || 'unknown'}, not industry`);
      if (!opts.tokens.some((t) => r.interventions.toLowerCase().includes(t))) reasons.push('no company asset among registered interventions');
    }
    const entry: FoundTrial = { nct_id: id, found_by: 'company_snapshot · clinical_trials connector search', registry: r ?? null };
    if (reasons.length) excluded.push({ ...entry, reasons });
    else kept.push(entry);
  }
  return { kept, excluded };
}

/** NCT IDs the company snapshot says belong to the company's programs or partners. */
export function claimedIds(snapshot: any): string[] {
  return [
    ...(snapshot?.partner_run_trials ?? []).map((p: any) => String(p.nct_id).toUpperCase()),
    ...(snapshot?.programs ?? []).flatMap((p: any) => (p.key_trials ?? []).flatMap((k: string) => nctIdsIn(k))),
  ];
}

/**
 * Found-by-research trials for a snapshot: its claimed IDs (plus `extra`, the
 * trials a previous pack already found, so a weekly re-run does not drop them
 * on model variance), confirmed against the registry.
 */
export async function foundTrials(
  company: CompanyConfig,
  snapshot: any,
  stage1Ids: ReadonlySet<string>,
  lookup: (ids: string[]) => Promise<Record<string, RegistryLookup>>,
  extra: readonly string[] = []
) {
  const claimed = [...claimedIds(snapshot), ...extra];
  const registry = await lookup([...new Set(claimed)].filter((id) => /^NCT\d{8}$/.test(id) && !stage1Ids.has(id)));
  return filterFoundTrials(claimed, registry, { match: company.match, tokens: assetTokens(snapshot?.programs ?? []), stage1Ids });
}

export type BuildInput = {
  company: CompanyConfig;
  recorded: string;
  taskgroup_id: string;
  stage1: Omit<TrialRow, 'check'>[];
  snapshot: RawResult;
  mechanism: RawResult;
  trials: Record<string, RawResult>;
  found?: Record<string, RawResult>;
  events?: Record<string, RawEvents>;
  lookup: (ids: string[]) => Promise<Record<string, RegistryLookup>>;
  previous?: Pack | null;
  review?: PinnedCheck[];
  /** Found trials carried over from the previous pack (see foundTrials). */
  extraClaimed?: string[];
};

export async function buildPack(input: BuildInput): Promise<Pack> {
  const snapshot = input.snapshot?.output?.content ?? null;
  const rows: TrialRow[] = input.stage1.map((x) => ({ ...x, check: checkFrom(x.status, input.trials[x.nct_id], input.events?.[x.nct_id]) }));
  const stage1Ids = new Set(rows.map((r) => r.nct_id));
  const { kept, excluded } = await foundTrials(input.company, snapshot, stage1Ids, input.lookup, input.extraClaimed);
  for (const f of kept) f.check = checkFrom(f.registry?.status ?? '', input.found?.[f.nct_id]);

  const pack: Pack = {
    about: {
      company: input.company.name,
      recorded: input.recorded,
      taskgroup_id: input.taskgroup_id,
      note: 'Recorded research run on public data. Model output unless hand-checked. Not investment advice.',
    },
    totals: { flags: {} },
    snapshot,
    snapshot_basis: basisOf(input.snapshot),
    snapshot_connector_log: connectorLog(input.snapshot),
    snapshot_live: null,
    mechanism: input.mechanism?.output?.content ?? null,
    mechanism_basis: basisOf(input.mechanism),
    mechanism_connector_log: connectorLog(input.mechanism),
    found_beyond_registry_search: kept,
    found_beyond_excluded: excluded,
    rows,
  };

  const pinned = input.review ?? (input.previous ? pinChecks(input.previous.review ?? [], input.previous.rows, input.previous.found_beyond_registry_search) : []);
  pack.review = carryOver(pinned, pack);
  for (const row of pack.rows) {
    const checks = pack.review.filter((c) => c.nct_id === row.nct_id);
    if (checks.length && row.check) row.check.hand_checked = checks;
  }
  pack.totals = totalsOf(pack);
  return pack;
}

export function totalsOf(pack: Pack): Pack['totals'] {
  const flags: Pack['totals']['flags'] = {};
  for (const r of pack.rows) if (r.check) flags[r.check.flag] = (flags[r.check.flag] ?? 0) + 1;
  const connectorCalls =
    pack.rows.reduce((n, r) => n + Object.values(r.check?.connector_calls ?? {}).reduce((a, b) => a + b, 0), 0) +
    (pack.snapshot_connector_log?.length ?? 0) +
    (pack.mechanism_connector_log?.length ?? 0);
  return {
    registry_trials: pack.rows.length,
    flags,
    partner_run_trials: pack.found_beyond_registry_search.length,
    partner_run_excluded: pack.found_beyond_excluded?.length ?? 0,
    programs: pack.snapshot?.programs?.length ?? 0,
    competitors: pack.mechanism?.competitors?.length ?? 0,
    connector_calls: connectorCalls,
    hand_checked_claims: pack.review?.length ?? 0,
  };
}

/** Merge competitor lists across packs that share a ChEMBL molecule ID. */
export function mergeCompetitors(packs: Record<string, Pack>): Record<string, Pack> {
  const byMolecule = new Map<string, string[]>();
  for (const [key, p] of Object.entries(packs)) {
    const id = p.mechanism?.chembl_molecule_id;
    if (id) byMolecule.set(id, [...(byMolecule.get(id) ?? []), key]);
  }
  const out = { ...packs };
  for (const keys of byMolecule.values()) {
    if (keys.length < 2) continue;
    const merged = new Map<string, any>();
    for (const k of keys) for (const c of out[k].mechanism?.competitors ?? []) {
      const id = c.asset.split('(')[0].trim().toLowerCase();
      if (!merged.has(id)) merged.set(id, { ...c, from_run: c.from_run ?? k });
    }
    for (const k of keys) out[k] = { ...out[k], mechanism: { ...out[k].mechanism!, competitors: [...merged.values()], competitors_merged_from: keys } };
  }
  return out;
}
