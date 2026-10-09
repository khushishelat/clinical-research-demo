// The homepage: one card per built indication, and the latest activity across all of them.
// Built on the server from the same views as the maps. Pure apart from loading.

import { briefFor, builtDiseases, loadSpace } from './load';
import { mapView } from './view';

export async function homeView(today: string) {
  const cards = [];
  const latest = [];
  for (const b of await builtDiseases()) {
    const s = await loadSpace(b.key);
    if (!s) continue;
    const v = mapView(s, 'companies', today);
    const brief = s.briefs[0] ? await briefFor(b.key, s.briefs[0]) : null;
    cards.push({
      key: b.key,
      name: s.config.name,
      subtitle: s.config.subtitle ?? null,
      area: s.config.area ?? 'Other',
      trials: v.stats.trials,
      completed: v.stats.completed,
      companies: v.stats.companies,
      deals: v.stats.deals,
      dealDollars: v.stats.dealDollars,
      updated: s.fetched,
      week: v.pulse,
      brief: brief ? { title: brief.title, date: brief.date } : null,
    });
    latest.push(...v.feed.slice(0, 10).map((f) => ({ ...f, indication: b.key, indicationName: s.config.name })));
  }
  // News before registry changes on the same day, newest first. A trial or announcement that
  // belongs to several indications shows once, naming each of them.
  latest.sort((a, b) => b.date.localeCompare(a.date) || Number(a.origin === 'registry') - Number(b.origin === 'registry'));
  const merged = new Map<string, (typeof latest)[number] & { indicationNames: string[] }>();
  for (const f of latest) {
    const k = `${f.date}|${f.company}|${f.nct ?? f.headline}`;
    const seen = merged.get(k);
    if (seen) seen.indicationNames.push(f.indicationName);
    else merged.set(k, { ...f, indicationNames: [f.indicationName] });
  }
  return { cards, latest: [...merged.values()].slice(0, 8) };
}

export type HomeView = Awaited<ReturnType<typeof homeView>>;
