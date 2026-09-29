// Server-only. What each company page needs, shared by the page components
// and GET /api/company/:key.

import { mergeCompetitors } from '../domain/join';
import type { CompanyConfig, Pack } from '../domain/types';
import { companyByKey, loadPack, type Context } from './context';
import { eventsFor } from './followups';
import { nextRefreshDate } from './refresh';
import { countView, requestState, researchedIndex } from './research';

export type CompanyView = {
  key: string;
  source: 'storage' | 'recorded';
  config: CompanyConfig | null;
  refresh: { cadence: 'weekly'; next: string; included: boolean };
  pack: Pack;
  events: Awaited<ReturnType<typeof eventsFor>>;
  /** Other companies we have research for, by key, for "Recorded · instant" links. */
  known: Record<string, { name: string; recorded: string }>;
};

export async function companyView(c: Context, key: string, opts: { countView?: boolean } = {}): Promise<CompanyView | null> {
  if (!/^[a-z0-9-]{1,60}$/.test(key)) return null;
  const loaded = await loadPack(key, c);
  if (!loaded) return null;
  // Competitor lists merge across packs that share a ChEMBL molecule (Summit and Akeso).
  const others = await Promise.all(c.companies.filter((co) => co.key !== key).map(async (co) => [co.key, (await loadPack(co.key, c))?.pack] as const));
  const all = Object.fromEntries([[key, loaded.pack], ...others.filter((o): o is readonly [string, Pack] => Boolean(o[1]))]) as Record<string, Pack>;
  const merged = mergeCompetitors(all);
  if (opts.countView) await countView(c, key).catch(() => null);
  const known: CompanyView['known'] = {};
  for (const [k, p] of Object.entries(all)) known[k] = { name: p.about.company, recorded: p.about.recorded };
  for (const [k, r] of Object.entries(await researchedIndex(c))) known[k] ??= { name: r.company.name, recorded: r.recorded };
  const config = companyByKey(key, c) ?? null;
  return {
    key,
    source: loaded.source,
    config,
    refresh: { cadence: 'weekly', next: nextRefreshDate(c.now()), included: Boolean(config) },
    pack: merged[key],
    events: (await eventsFor(c, key)).slice(0, 20),
    known,
  };
}

export { requestState };
