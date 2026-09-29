// Monitor API side of freshness (BACKEND-DESIGN.md, Job 2). One event_stream
// monitor per recorded company; each event is matched to that company's
// trials by NCT ID, trial name or asset. Monitors cannot call connectors, so
// a trial match starts a connector-backed Task run. Pure. Ported from
// validation/09-monitors.ts.

import type { Pack } from './types';

export const MONITOR_EVENT_SCHEMA = {
  type: 'object',
  properties: {
    assets: { type: 'array', items: { type: 'string' }, description: 'Company assets the update is about, by name and code.' },
    nct_ids: { type: 'array', items: { type: 'string' }, description: 'ClinicalTrials.gov NCT IDs named in the source. Empty if none are named.' },
    trial_names: { type: 'array', items: { type: 'string' }, description: 'Trial names or acronyms named in the source, e.g. "HARMONi-3".' },
    update_type: {
      type: 'string',
      enum: [
        'trial_announced',
        'enrolling',
        'first_patient_dosed',
        'enrollment_completed',
        'interim_data',
        'topline_results',
        'results_presented',
        'results_published',
        'regulatory_submission',
        'regulatory_decision',
        'discontinued_or_terminated',
        'paused_or_on_hold',
        'timeline_changed',
        'partnership_or_licensing',
        'other',
      ],
      description: 'What kind of update this is.',
    },
    summary: { type: 'string', description: 'One sentence with the date and what changed.' },
  },
  required: ['assets', 'nct_ids', 'trial_names', 'update_type', 'summary'],
  additionalProperties: false,
} as const;

// "vepdegestrant (ARV-471, PF-07850327; VEPPANU) plus palbociclib" -> "vepdegestrant (ARV-471)"
export function assetsOf(pack: Pack): string[] {
  const seen = new Map<string, string>();
  for (const p of pack.snapshot?.programs ?? []) {
    const raw = String(p.asset);
    const base = raw.split('(')[0].split(/\s+(?:plus|with|in|alone|\+)\s+/i)[0].trim();
    const code = raw.match(/\(([^,;)]+)/)?.[1]?.trim();
    if (!base || seen.has(base.toLowerCase())) continue;
    seen.set(base.toLowerCase(), code && code.toLowerCase() !== base.toLowerCase() ? `${base} (${code})` : base);
  }
  return [...seen.values()].slice(0, 6);
}

export function monitorQueryFor(pack: Pack): string {
  const company = pack.snapshot?.company ?? pack.about.company;
  const assets = assetsOf(pack);
  return `New clinical trial and pipeline updates from ${company} and its partners${assets.length ? ` about ${assets.join(', ')}` : ''}: trial starts, enrollment milestones, data readouts and conference presentations, regulatory submissions and decisions, discontinuations, and licensing or partnership deals.`;
}

export type EventContent = { assets: string[]; nct_ids: string[]; trial_names: string[]; update_type: string; summary: string };

export type StoredEvent = {
  event_id: string;
  event_group_id: string;
  event_date: string | null;
  received: string;
  update_type: string;
  summary: string;
  match: 'trial' | 'program' | 'none';
  trials: string[];
  source_urls: string[];
  /** Set once a follow-up Task run for the first matched trial is started, then finished. */
  followup?: { run_id: string; nct_id: string; status: 'running' | 'applied' | 'failed' | 'skipped'; finished?: string; reason?: string };
};

export function eventContent(output: any): EventContent {
  const raw = output?.content;
  let c: any = raw;
  if (typeof raw === 'string') {
    try {
      c = JSON.parse(raw);
    } catch {
      c = { summary: raw };
    }
  }
  return {
    assets: c?.assets ?? [],
    nct_ids: (c?.nct_ids ?? []).map((x: string) => String(x).toUpperCase()),
    trial_names: c?.trial_names ?? [],
    update_type: c?.update_type ?? 'other',
    summary: String(c?.summary ?? '').slice(0, 600),
  };
}

/** Matches a monitor event to the pack's trials: NCT ID first, then trial name, then asset. */
export function matchEvent(pack: Pack, c: EventContent): { match: StoredEvent['match']; trials: string[] } {
  const known = new Set<string>([...pack.rows.map((r) => r.nct_id), ...pack.found_beyond_registry_search.map((f) => f.nct_id)]);
  const acronyms = new Map<string, string>();
  for (const f of pack.found_beyond_registry_search) if (f.registry?.acronym) acronyms.set(f.registry.acronym.toLowerCase(), f.nct_id);
  for (const r of pack.rows) {
    const name = String(r.check?.program ?? '').match(/\(([^)]+)\)\s*$/)?.[1];
    if (name) acronyms.set(name.toLowerCase(), r.nct_id);
  }
  const ids = c.nct_ids.filter((x) => known.has(x));
  const byName = c.trial_names.map((n) => acronyms.get(n.toLowerCase())).filter((x): x is string => Boolean(x));
  const trials = [...new Set([...ids, ...byName])];
  if (trials.length) return { match: 'trial', trials };
  const assets = assetsOf(pack).map((a) => a.toLowerCase().split(' ')[0]);
  const assetHit = c.assets.some((a) => assets.some((k) => a.toLowerCase().includes(k)));
  return { match: assetHit ? 'program' : 'none', trials: [] };
}

export function toStoredEvent(pack: Pack, e: any, received: string): StoredEvent {
  const c = eventContent(e.output);
  const { match, trials } = matchEvent(pack, c);
  return {
    event_id: e.event_id,
    event_group_id: e.event_group_id,
    event_date: e.event_date ?? null,
    received,
    update_type: c.update_type,
    summary: c.summary,
    match,
    trials,
    source_urls: (e.output?.basis ?? []).flatMap((b: any) => (b.citations ?? []).map((ci: any) => ci.url)).slice(0, 3),
  };
}

/** Appends new events (by event_id), newest first, capped. */
export function mergeEvents(existing: readonly StoredEvent[], incoming: readonly StoredEvent[], cap = 200): StoredEvent[] {
  const seen = new Set(existing.map((e) => e.event_id));
  const fresh = incoming.filter((e) => !seen.has(e.event_id));
  const all = [...fresh, ...existing];
  all.sort((a, b) => (b.event_date ?? b.received).localeCompare(a.event_date ?? a.received));
  return all.slice(0, cap);
}
