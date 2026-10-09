// Step 6: one event list per indication, built in code (no model): disclosures
// from step 4 (milestones, deals, financings, approvals, regulatory events),
// registry events from the daily diffs, and Monitor events when they arrive.
// Plus guided catalysts and monthly registration counts. Events keep the trial
// ID the research run gave, so the map and drawers join on it exactly.
//   npx tsx scripts/06-events.mts --disease mash

import { createHash } from 'node:crypto';
import { regulatoryEvent } from '../../../src/lib/space/labels';
import { log, spacePath, store, where, type Disease } from '../pipeline';
import { registryHeadline, type RegistryEvent, type Trial } from '../registry';
import { sameEvent, type MonitorEvent } from './monitors';

export async function eventsStep(d: Disease) {
  const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
  const { companies } = (await store.get<{ companies: any[] }>(spacePath(d, 'companies.json')))!;
  const { facts } = (await store.get<{ facts: Record<string, any> }>(spacePath(d, 'facts.json'))) ?? { facts: {} };
  const registry = (await store.get<RegistryEvent[]>(spacePath(d, 'registry-events.json'))) ?? [];
  const monitor = (await store.get<MonitorEvent[]>(spacePath(d, 'monitor-events.json'))) ?? [];
  const companyOf = new Map<string, string>();
  for (const c of companies) for (const n of [...c.trials, ...c.investigator_trials]) if (!companyOf.has(n)) companyOf.set(n, c.key);
  const id = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 12);
  const valid = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

  type Event = { id: string; date: string; company: string; drug: string | null; type: string; headline: string; source_url: string | null; nct?: string | null; origin: 'web' | 'registry' | 'monitor'; found_by?: string[]; detected?: string };
  const events: Event[] = [];
  for (const [key, f] of Object.entries(facts)) {
    for (const m of f.milestones ?? []) if (valid(m.date)) events.push({ id: id(key, m.date, m.headline), date: m.date, company: key, drug: m.drug ?? null, type: m.type, headline: m.headline, source_url: m.source_url, nct: m.nct ?? null, origin: 'web' });
    for (const x of f.deals ?? []) if (valid(x.date)) events.push({ id: id(key, x.date, 'deal', x.headline), date: x.date, company: key, drug: x.drugs?.[0] ?? null, type: 'deal', headline: x.headline, source_url: x.source_url, origin: 'web' });
    for (const x of f.financings ?? []) if (valid(x.date)) events.push({ id: id(key, x.date, 'financing', x.headline), date: x.date, company: key, drug: null, type: 'financing', headline: x.headline, source_url: x.source_url, origin: 'web' });
    // Designations and filings that happened, unless a milestone already carries that day.
    for (const r of f.regulatory ?? []) {
      if (r.status !== 'done' || !valid(r.date)) continue;
      const dup = events.some((e) => e.company === key && ['regulatory', 'designation', 'filing'].includes(e.type) && Math.abs(Date.parse(e.date) - Date.parse(r.date)) < 4 * 86_400_000);
      if (!dup) events.push({ id: id(key, r.date, r.kind, r.drug), date: r.date, company: key, drug: r.drug, type: 'regulatory', headline: `${regulatoryEvent(r.agency, r.kind)} for ${r.drug}`.slice(0, 90), source_url: r.source_url, origin: 'web' });
    }
    for (const a of f.approvals ?? []) {
      if (!valid(a.date)) continue;
      const dup = events.some((e) => e.company === key && e.type === 'approval' && Math.abs(Date.parse(e.date) - Date.parse(a.date)) < 4 * 86_400_000);
      if (!dup) events.push({ id: id(key, a.date, 'approval', a.region), date: a.date, company: key, drug: a.drug, type: 'approval', headline: `${a.drug} approved in ${a.region}`.slice(0, 80), source_url: a.source_url, origin: 'web' });
    }
  }
  // Acquisition closings, from the ownership runs (step 3), unless the company's own facts already carry that day.
  for (const c of companies)
    for (const a of c.acquisitions ?? []) {
      if (!valid(a.closed)) continue;
      const dup = events.some((e) => e.company === c.key && e.type === 'deal' && Math.abs(Date.parse(e.date) - Date.parse(a.closed)) < 4 * 86_400_000);
      if (!dup) events.push({ id: id(c.key, a.closed, 'closed', a.sponsor), date: a.closed, company: c.key, drug: null, type: 'deal', headline: `${c.name} completes its acquisition of ${a.sponsor.replace(/,?\s*(Inc|Ltd|Co)\.?.*$/i, '')}`, source_url: a.source ?? null, origin: 'web' });
    }
  const byNct = new Map(trials.map((t) => [t.nct, t]));
  for (const r of registry) {
    const c = companyOf.get(r.nct);
    if (!c) continue;
    const t = byNct.get(r.nct);
    events.push({ id: r.id, date: r.date, company: c, drug: null, type: r.type, headline: registryHeadline(r, t), source_url: `https://clinicaltrials.gov/study/${r.nct}`, nct: r.nct, origin: 'registry' });
  }
  // New registrations come from each trial's first-posted date, so the feed works
  // from day one; snapshot diffs add status and phase changes on later days.
  const seenIds = new Set(events.map((e) => e.nct && e.type === 'trial_registered' ? e.nct : ''));
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
  for (const t of trials) {
    const c = companyOf.get(t.nct);
    if (!c || t.first_posted < since || seenIds.has(t.nct)) continue;
    const phase = t.phases.map((p) => p.replace('PHASE', 'Phase ').replace('EARLY_', 'Early ')).join('/') || 'Trial';
    events.push({ id: `posted:${t.nct}`, date: t.first_posted, company: c, drug: null, type: 'trial_registered', headline: `Registers ${t.acronym ? `${t.acronym}, ` : ''}a ${phase.replace('/Phase ', '/')}: ${t.title}`.slice(0, 120), source_url: `https://clinicaltrials.gov/study/${t.nct}`, nct: t.nct, origin: 'registry' });
  }
  // Monitor news, unless the build's research already has the same development.
  const research = events.filter((e) => e.origin === 'web');
  for (const m of monitor) {
    if (!m.company || !valid(m.date) || research.some((w) => sameEvent(w, m))) continue;
    events.push({ id: m.id, date: m.date, company: m.company, drug: m.drug, type: m.type, headline: m.headline, source_url: m.source_url, nct: m.nct, origin: 'monitor', found_by: m.found_by ?? [], detected: m.detected });
  }
  events.sort((a, b) => b.date.localeCompare(a.date));

  // Guided catalysts: the company's stated next steps, plus expected regulatory events.
  const catalysts = Object.entries(facts).flatMap(([key, f]) => [
    ...(f.next ?? []).map((n: any) => ({ id: id(key, n.what, n.timing_text ?? ''), company: key, ...n })),
    ...(f.regulatory ?? []).filter((r: any) => r.status === 'expected').map((r: any) => ({ id: id(key, r.kind, r.drug, r.window ?? ''), company: key, what: `${regulatoryEvent(r.agency, r.kind)} for ${r.drug}`, kind: 'decision', drug: r.drug, nct: null, stated_on: null, earliest: r.date, latest: null, timing_text: r.window, stated_by: null, source_url: r.source_url })),
  ]);
  const monthly: Record<string, { all: number; companies: number }> = {};
  for (const t of trials) {
    const m = t.first_posted.slice(0, 7);
    if (!m) continue;
    monthly[m] ??= { all: 0, companies: 0 };
    monthly[m].all += 1;
    if (companyOf.has(t.nct)) monthly[m].companies += 1;
  }
  await store.put(spacePath(d, 'events.json'), { disease: d.key, built: new Date().toISOString(), events, catalysts, monthly });
  const by = events.reduce((m: Record<string, number>, e) => ((m[e.type] = (m[e.type] ?? 0) + 1), m), {});
  log(d, `${events.length} events (${JSON.stringify(by)}) · ${catalysts.length} catalysts · saved to ${where}spaces/${d.key}/events.json`);
}
