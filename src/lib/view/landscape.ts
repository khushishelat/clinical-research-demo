// Landscape view model, built on the server from the full pack and sent to
// the browser by ID (rows travel once, slimmed). Pure.

import { nctIdsIn, layoutLandscape, whatsNew, type NewsItem } from '../domain/programs';
import type { Catalyst, Pack, Program } from '../domain/types';
import { slimPack, type SlimPack } from './slim';

export type ProgramView = { id: string; program: Program; rowIds: string[]; foundIds: string[]; approvedIn: string | null };
export type AreaView = {
  area: string;
  programs: ProgramView[];
  investigator: { trials: number; institutions: string[]; with_news: number; rowIds: string[] };
};
export type CatalystView = { id: string; label: string; what: string; earliest: string | null; latest: string | null; dated: boolean; nct_id?: string; source: 'trial' | 'program' };
export type Related = { name: string; key: string | null; scope: string };

export type LandscapeView = {
  pack: SlimPack;
  areas: AreaView[];
  other: { rowIds: string[]; foundIds: string[] };
  placement: Record<string, number>;
  whatsNew: NewsItem[];
  whatsNewTotal: number;
  catalysts: CatalystView[];
  related: Related[];
  stats: { registry: number; found: number; withNews: number; lagging: number; programs: number; investigatorTrials: number; investigatorSites: number };
};

/** "Approved · China" from a program's status and milestone text. */
export function approvedIn(p: Program): string | null {
  if (p.status !== 'approved') return null;
  const where = p.latest_milestone.match(/approved in (the )?(China|US|United States|EU|Europe|Japan)/i)?.[2];
  return where ? where.replace('United States', 'US') : 'Yes';
}

function catalystOf(c: Catalyst | null | undefined) {
  if (!c?.description) return null;
  const earliest = c.earliest ?? null;
  const latest = c.latest ?? c.earliest ?? null;
  return { earliest, latest, dated: Boolean(earliest && latest && earliest === latest) };
}

export function catalystsOf(pack: Pack, today: string, names: Record<string, string>): CatalystView[] {
  const out: CatalystView[] = [];
  const seen = new Set<string>();
  for (const r of pack.rows) {
    if (r.role === 'investigator_led') continue;
    const c = catalystOf(r.check?.next_catalyst);
    if (!c || !c.latest || c.latest < today) continue;
    const label = `${r.check?.next_catalyst?.timing_text ?? ''}`.trim();
    const key = `${names[r.nct_id]}|${label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `t:${r.nct_id}`, label: names[r.nct_id] ?? r.nct_id, what: shortWhat(r.check!.next_catalyst!.description!), ...c, nct_id: r.nct_id, source: 'trial' });
  }
  for (const [i, p] of (pack.snapshot?.programs ?? []).entries()) {
    const c = catalystOf(p.next_catalyst);
    if (!c || !c.latest || c.latest < today) continue;
    // Skip when a trial in this program already carries the same catalyst window.
    const ids = p.key_trials.flatMap(nctIdsIn);
    if (out.some((o) => o.nct_id && ids.includes(o.nct_id) && o.latest === c.latest)) continue;
    out.push({ id: `p:${i}`, label: p.asset.split('(')[0].trim(), what: shortWhat(p.next_catalyst!.description!), ...c, source: 'program' });
  }
  return out.sort((a, b) => (a.earliest ?? a.latest ?? '').localeCompare(b.earliest ?? b.latest ?? '')).slice(0, 12);
}

const shortWhat = (s: string) => {
  const first = s.split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Partners and sponsors of found trials, linked when we already have research for them. */
export function relatedOf(pack: Pack, known: Record<string, { name: string; match?: string }>, self: string): Related[] {
  const out = new Map<string, Related>();
  const link = (name: string) => {
    const n = norm(name);
    for (const [key, k] of Object.entries(known)) {
      if (key === self) continue;
      const token = norm(k.match ?? k.name.split(/[ ,]/)[0]);
      if (token && n.includes(token)) return key;
    }
    return null;
  };
  for (const p of pack.snapshot?.partnerships ?? []) {
    const name = p.partner.replace(/\s*\([^)]*\)/g, '').replace(/,? (Inc|plc|Ltd|Co|Corp|Corporation|Limited|SA|AG)\.?$/i, '').trim();
    const key = link(p.partner);
    if (key === self) continue;
    out.set(norm(name), { name, key, scope: p.scope });
  }
  // Collaborators and lead sponsors on registry rows (for example a combination study run with a partner).
  for (const r of pack.rows) {
    for (const sponsor of [r.lead_sponsor, ...r.collaborators]) {
      const key = link(sponsor);
      if (!key || [...out.values()].some((x) => x.key === key)) continue;
      out.set(norm(sponsor), { name: known[key].name, key, scope: `On ${r.nct_id} as ${sponsor === r.lead_sponsor ? 'lead sponsor' : 'collaborator'}` });
    }
  }
  for (const f of pack.found_beyond_registry_search) {
    const sponsor = f.registry?.lead_sponsor;
    if (!sponsor) continue;
    const key = link(sponsor);
    if (!key || [...out.values()].some((r) => r.key === key)) continue;
    out.set(norm(sponsor), { name: known[key].name, key, scope: 'Sponsors trials found beyond the registry search' });
  }
  return [...out.values()].sort((a, b) => Number(Boolean(b.key)) - Number(Boolean(a.key)));
}

export function landscapeView(pack: Pack, today: string, known: Record<string, { name: string; match?: string }>, self: string, names: Record<string, string>): LandscapeView {
  const layout = layoutLandscape(pack);
  const investigatorRows = pack.rows.filter((r) => r.role === 'investigator_led');
  const all = whatsNew(pack, 1000);
  return {
    pack: slimPack(pack),
    areas: layout.areas.map((a) => ({
      area: a.area,
      programs: a.programs.map((g, i) => ({ id: `${a.area}:${i}`, program: g.program, rowIds: g.rows.map((r) => r.nct_id), foundIds: g.found.map((f) => f.nct_id), approvedIn: approvedIn(g.program) })),
      investigator: {
        trials: a.investigator.trials,
        institutions: [...new Set(a.investigator.rows.map((r) => r.lead_sponsor))],
        with_news: a.investigator.with_news,
        rowIds: a.investigator.rows.map((r) => r.nct_id),
      },
    })),
    other: { rowIds: layout.other.rows.map((r) => r.nct_id), foundIds: layout.other.found.map((f) => f.nct_id) },
    placement: layout.placement,
    whatsNew: all.slice(0, 8),
    whatsNewTotal: all.length,
    catalysts: catalystsOf(pack, today, names),
    related: relatedOf(pack, known, self),
    stats: {
      registry: pack.rows.length,
      found: pack.found_beyond_registry_search.length,
      withNews: pack.rows.filter((r) => r.check && r.check.flag !== 'no_news').length,
      lagging: pack.rows.filter((r) => r.check?.flag === 'registry_lagging' || r.check?.flag === 'conflict').length,
      programs: pack.snapshot?.programs?.length ?? 0,
      investigatorTrials: investigatorRows.length,
      investigatorSites: new Set(investigatorRows.map((r) => r.lead_sponsor)).size,
    },
  };
}
