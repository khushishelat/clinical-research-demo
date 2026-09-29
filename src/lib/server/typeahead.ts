// Server-only. GET /api/typeahead (HANDOFF-v2.1 section 7): recorded
// companies first (with aliases), then researched ones, then the static
// sponsor index (data/sponsors.json, scripts/build-sponsors.mts). Live
// active-trial counts for the top 5 in live mode, cached 24 h.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { countActiveTrials } from '../domain/stage1';
import { appRoot, type Context } from './context';
import { companyFromName, estimateMinutes, NARROW_ABOVE, researchedIndex } from './research';

export type Suggestion = {
  name: string;
  key: string;
  state: 'recorded' | 'researched' | 'in_progress' | 'not_researched' | 'narrow';
  /** Active trials listing the sponsor (live when available, else at index build time). */
  trials: number | null;
  recorded?: string;
  estimated_minutes?: number;
  scope_label?: string;
};

type SponsorIndex = { built: string; sponsors: { name: string; trials: number }[] };
let index: SponsorIndex | null = null;
function sponsors(): SponsorIndex['sponsors'] {
  if (!index) {
    try {
      index = JSON.parse(readFileSync(join(appRoot, 'data/sponsors.json'), 'utf8')) as SponsorIndex;
    } catch {
      index = { built: '', sponsors: [] };
    }
  }
  return index.sponsors;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** 0 = exact, 1 = starts with, 2 = a word starts with, 3 = contains, -1 = no match. */
export function score(name: string, q: string): number {
  const n = norm(name);
  if (!q) return -1;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.split(' ').some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 3 : -1;
}

const COUNT_TTL = 24 * 60 * 60;

async function liveCount(c: Context, name: string): Promise<number | null> {
  const cacheKey = `count:${norm(name)}`;
  const hit = await c.kv.get(cacheKey);
  if (hit !== null) return Number(hit);
  try {
    const n = await countActiveTrials(name);
    await c.kv.set(cacheKey, String(n), { exSeconds: COUNT_TTL });
    return n;
  } catch {
    return null;
  }
}

export async function typeahead(c: Context, raw: string, limit = 8): Promise<Suggestion[]> {
  const q = norm(raw.slice(0, 80));
  if (q.length < 2) return [];
  const out: Suggestion[] = [];
  const taken = new Set<string>();

  const recorded = c.companies
    .map((co) => ({ co, s: Math.min(...[co.name, co.key, ...co.aliases].map((n) => score(n, q)).filter((x) => x >= 0), 99) }))
    .filter((x) => x.s < 99)
    .sort((a, b) => a.s - b.s);
  for (const { co } of recorded) {
    out.push({ name: co.name, key: co.key, state: 'recorded', trials: null, ...(co.scope_label ? { scope_label: co.scope_label } : {}) });
    taken.add(co.key);
    for (const a of co.aliases) taken.add(companyFromName(a).key);
  }

  const researched = await researchedIndex(c);
  for (const [key, r] of Object.entries(researched)) {
    if (taken.has(key) || score(r.company.name, q) < 0) continue;
    out.push({ name: r.company.name, key, state: 'researched', trials: null, recorded: r.recorded });
    taken.add(key);
  }

  const candidates = sponsors()
    .map((s) => ({ ...s, s: score(s.name, q), key: companyFromName(s.name).key }))
    .filter((s) => s.s >= 0 && !taken.has(s.key))
    .sort((a, b) => a.s - b.s || b.trials - a.trials)
    .slice(0, Math.max(0, limit - out.length));

  const counted = await Promise.all(
    candidates.map(async (s, i) => ({ ...s, live: c.parallel && i < 5 ? await liveCount(c, s.name) : null }))
  );
  for (const s of counted) {
    const trials = s.live ?? s.trials;
    const active = await c.kv.get(`active:${s.key}`);
    out.push({
      name: s.name,
      key: s.key,
      state: active ? 'in_progress' : trials > NARROW_ABOVE ? 'narrow' : 'not_researched',
      trials,
      ...(trials <= NARROW_ABOVE ? { estimated_minutes: estimateMinutes(trials) } : {}),
    });
  }
  return out.slice(0, limit);
}
