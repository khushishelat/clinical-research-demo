// Daily news for an indication from a set of Monitors (MONITOR in specs.ts): one broad
// query, one per topic and one per leading company, each base and daily. Creating a
// monitor starts a daily charge, so monitors exist only for indications whose config sets
// `monitor: true`; the daily job creates them with the deployment's API key, and a
// monitor belongs to that key's workspace.
//
// spaces/<d>/monitor.json            the monitors, the IDs they replaced, and when news was last read
// spaces/<d>/monitor-events.json     events about a company on the map, merged across monitors
// spaces/<d>/monitor-unmatched.json  everything else, with the reason, for review
//
// Events arrive two ways: the daily job reads every monitor's new events, and in
// production each monitor also calls /api/monitor/webhook when it finds something, so
// news lands within minutes. Both go through collectMonitorEvents, keyed by event ID, so
// reading an event twice never adds it twice.

import type { Company } from '../../../src/lib/space/types';
import { aliasesOf, companyKey } from '../companies';
import { log, parallel, spacePath, store, type Disease } from '../pipeline';
import { MONITOR } from '../specs';

type Entry = { monitor_id: string; spec: string; kind: 'broad' | 'topic' | 'company'; label: string; query: string; created: string; company?: string; lost?: string };
export type MonitorDoc = {
  spec: string;
  monitors: Record<string, Entry>;
  /** Monitors cancelled or no longer visible to this API key. */
  previous: string[];
  /** Of those, the ones cancelled with an old API key (scripts/rotate-key.mts). */
  cancelled_previous?: string[];
  /** When events were last read, and when the last new one arrived. */
  health?: { last_collected: string; last_new: string | null };
};
export type MonitorEvent = {
  id: string;
  /** Every monitor event merged into this one. */
  ids: string[];
  date: string;
  company: string;
  company_name: string;
  drug: string | null;
  nct: string | null;
  type: string;
  headline: string;
  source_url: string | null;
  /** Keys of the monitors that found it (monitor.json), first finder first. */
  found_by: string[];
  /** When this app first read it. */
  detected: string;
};
type Unmatched = { id: string; monitor: string; reason: 'other_indication' | 'no_company_on_map' | 'no_date'; company: string | null; headline: string; date: string | null; source_url: string | null; detected: string };

const path = (d: Disease, f: string) => spacePath(d, f);
const now = () => new Date().toISOString();

/** The monitor doc, upgraded from v1 (a single monitor_id) so the old monitor is cancelled and replaced. */
export async function monitorOf(d: Disease): Promise<MonitorDoc | null> {
  const raw = await store.get<any>(path(d, 'monitor.json'));
  if (!raw) return null;
  if (raw.monitors) return raw as MonitorDoc;
  const monitors: Record<string, Entry> = {};
  if (raw.monitor_id && !raw.cancelled && !raw.lost) monitors.legacy = { monitor_id: raw.monitor_id, spec: raw.spec, kind: 'broad', label: 'Everything (v1)', query: '', created: raw.created };
  const previous = [...(raw.previous ?? []), ...(raw.cancelled || raw.lost ? [raw.monitor_id] : [])];
  return { spec: MONITOR.key, monitors, previous, cancelled_previous: raw.cancelled_previous ?? [] };
}

/**
 * The leading companies, alternating between the largest programs (company trials, then
 * phase) and the companies that make the news (news items in the last 180 days, from the
 * build's research and earlier monitor finds). Either list alone misses half the field:
 * trial counts favor companies with many small trials, news favors small caps.
 */
function leaders(companies: Company[], events: { company: string; origin: string; date: string }[], today: string): Company[] {
  const since = new Date(Date.parse(today) - 180 * 86_400_000).toISOString().slice(0, 10);
  const news = new Map<string, number>();
  for (const e of events) if (e.origin !== 'registry' && e.date >= since) news.set(e.company, (news.get(e.company) ?? 0) + 1);
  const pool = companies.filter((c) => !c.web_only || c.trials.length);
  const bySize = [...pool].sort((a, b) => b.trials.length - a.trials.length || b.max_phase - a.max_phase);
  const byNews = [...pool].sort((a, b) => (news.get(b.key) ?? 0) - (news.get(a.key) ?? 0) || b.max_phase - a.max_phase);
  const out: Company[] = [];
  for (let i = 0; out.length < pool.length; i++) for (const c of [bySize[i], byNews[i]]) if (c && !out.includes(c)) out.push(c);
  return out;
}

/** Up to four drug names for a company query: in development, one per drug ("Setmelanotide (Imcivree)" and "setmelanotide" are one). */
function drugNames(c: Company): string[] {
  const out = new Map<string, string>();
  for (const x of c.drugs) {
    if (x.highest_phase === 'Preclinical') continue;
    const name = x.name.split('(')[0].trim();
    if (name && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), name);
  }
  return [...out.values()].slice(0, 4);
}

type Want = Omit<Entry, 'monitor_id' | 'created'> & { key: string };

/** The monitors this indication should have, given the map's companies. Company monitors are kept while the company stays in the top 2N, so the set doesn't churn. */
function wanted(d: Disease, companies: Company[], events: { company: string; origin: string; date: string }[], doc: MonitorDoc | null): Want[] {
  const out: Want[] = [
    { key: 'all', spec: MONITOR.key, kind: 'broad', label: 'Everything', query: MONITOR.broad(d) },
    ...MONITOR.topics.map((t): Want => ({ key: t.key, spec: MONITOR.key, kind: 'topic', label: t.label, query: t.query(d) })),
  ];
  const ranked = leaders(companies, events, new Date().toISOString().slice(0, 10));
  const keep = new Set(Object.values(doc?.monitors ?? {}).filter((e) => e.kind === 'company' && !e.lost).map((e) => e.company));
  const chosen = ranked.slice(0, MONITOR.companies * 2).filter((c) => keep.has(c.key)).slice(0, MONITOR.companies);
  for (const c of ranked) if (chosen.length < MONITOR.companies && !chosen.includes(c)) chosen.push(c);
  for (const c of chosen) {
    const drugs = drugNames(c);
    out.push({ key: `co:${c.key}`, spec: MONITOR.key, kind: 'company', label: c.name, query: MONITOR.company(d, c.name, drugs), company: c.key });
  }
  return out;
}

/** The webhook production monitors call when they find something; none for local runs. */
const webhookUrl = () => process.env.MONITOR_WEBHOOK_URL ?? (process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/monitor/webhook` : null);

/**
 * Creates the monitors this indication lacks and cancels those it no longer wants (a
 * company that left the leaders, the v1 monitor). Returns the doc, or null without a key.
 */
export async function reconcileMonitors(d: Disease): Promise<MonitorDoc | null> {
  const client = parallel(d, 'monitors');
  if (!client) return null;
  const doc: MonitorDoc = (await monitorOf(d)) ?? { spec: MONITOR.key, monitors: {}, previous: [] };
  const { companies } = (await store.get<{ companies: Company[] }>(path(d, 'companies.json'))) ?? { companies: [] };
  const { events } = (await store.get<{ events: { company: string; origin: string; date: string }[] }>(path(d, 'events.json'))) ?? { events: [] };
  const want = wanted(d, companies, events, doc);
  const wantKeys = new Set(want.map((w) => w.key));
  const save = () => store.put(path(d, 'monitor.json'), doc);
  for (const [key, e] of Object.entries(doc.monitors)) {
    if (wantKeys.has(key) && !e.lost && e.spec === MONITOR.key) continue;
    if (!e.lost) {
      try {
        await client.monitor.cancel(e.monitor_id);
      } catch (error) {
        if ((error as { status?: number }).status !== 404) throw error;
      }
    }
    doc.previous.push(e.monitor_id);
    delete doc.monitors[key];
    await save();
    log(d, `monitor ${key} (${e.monitor_id}) ${e.lost ? 'replaced' : 'cancelled'}`);
  }
  const hook = webhookUrl();
  for (const { key, ...w } of want) {
    if (doc.monitors[key]) continue;
    const m: any = await client.monitor.create({
      type: 'event_stream',
      frequency: MONITOR.frequency,
      processor: MONITOR.processor,
      settings: { query: w.query, include_backfill: true, output_schema: { type: 'json', json_schema: MONITOR.schema(d) } },
      ...(hook ? { webhook: { url: hook, event_types: ['monitor.event.detected'] } } : {}),
      metadata: { app: 'trial-check', disease: d.key, monitor: key.slice(0, 500), spec: MONITOR.key },
    } as any);
    doc.monitors[key] = { ...w, monitor_id: m.monitor_id, created: now() };
    // Saved after each one, so a failure part-way never creates a monitor twice.
    await save();
  }
  log(d, `monitors: ${Object.keys(doc.monitors).length} (${MONITOR.processor}, daily)${hook ? ', with webhook' : ''}`);
  return doc;
}

/** Cancels every monitor for this indication (stops the daily charge). */
export async function cancelMonitors(d: Disease) {
  const doc = await monitorOf(d);
  const client = parallel(d, 'monitors');
  if (!doc || !client) return;
  for (const [key, e] of Object.entries(doc.monitors)) {
    try {
      await client.monitor.cancel(e.monitor_id);
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
    doc.previous.push(e.monitor_id);
    delete doc.monitors[key];
  }
  await store.put(path(d, 'monitor.json'), doc);
  log(d, 'monitors cancelled');
}

// ── Matching an event to a company on the map ────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s: string) => companyKey(s).split(' ').filter(Boolean);

/** Name, then drug name or code, then a unique partial name ("Lilly" → Eli Lilly and Company). */
export function companyMatcher(companies: Company[]) {
  const byName = new Map<string, Company>();
  for (const c of companies) for (const n of [c.name, ...(c.registry_sponsors ?? [])]) if (!byName.has(companyKey(n))) byName.set(companyKey(n), c);
  const byDrug = new Map<string, Company | null>();
  for (const c of companies)
    for (const x of c.drugs)
      for (const a of aliasesOf(x)) {
        const k = norm(a);
        byDrug.set(k, byDrug.has(k) && byDrug.get(k) !== c ? null : c); // shared drug names match nobody
      }
  return (name: string | null, drug: string | null): Company | null => {
    if (name) {
      const exact = byName.get(companyKey(name));
      if (exact) return exact;
    }
    for (const part of (drug ?? '').split(/[,/;]|\band\b|\+/)) {
      const hit = byDrug.get(norm(part));
      if (hit) return hit;
    }
    if (!name) return null;
    const w = words(name);
    if (!w.length) return null;
    const partial = companies.filter((c) => {
      const cw = words(c.name);
      return w.every((x) => cw.includes(x)) || cw.every((x) => w.includes(x));
    });
    return partial.length === 1 ? partial[0] : null;
  };
}

// ── Reading events ───────────────────────────────────────────────────────────

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'in', 'to', 'and', 'with', 'on', 'at', 'its', 'phase', 'trial', 'study']);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(' ').filter((x) => x.length > 2 && !STOP.has(x)));
const similar = (a: string, b: string) => {
  const x = tokens(a);
  const y = tokens(b);
  const both = [...x].filter((t) => y.has(t)).length;
  return both / Math.max(1, Math.min(x.size, y.size)) >= 0.5;
};
const near = (a: string, b: string, days = 3) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;
type Comparable = Pick<MonitorEvent, 'company' | 'type' | 'date' | 'headline' | 'source_url'> & { company_name?: string };
/**
 * The same development, found by two monitors or twice by one: same company and close
 * dates, with the same source or the same kind of news and a similar headline. Partners report
 * the same news under two companies (a licensee and the originator of its drug), so two
 * companies also match when the headlines share a distinctive word: a code with digits
 * ("HRS-4729", "KAI-4729") or a word of either company's name. "Lilly reports Phase 2
 * results" and "Novo reports Phase 2 results" share neither.
 */
// Results reach the news as data, a presentation or a publication, often the same day: one family.
const family = (t: string) => (['data', 'presentation', 'publication'].includes(t) ? 'results' : t);

export function sameEvent(a: Comparable, b: Comparable): boolean {
  if (!near(a.date, b.date)) return false;
  if (a.source_url && a.source_url === b.source_url) return true;
  if (family(a.type) !== family(b.type) || !similar(a.headline, b.headline)) return false;
  if (a.company === b.company) return true;
  if (!near(a.date, b.date, 2)) return false;
  const names = new Set([...tokens(a.company_name ?? ''), ...tokens(b.company_name ?? '')]);
  const shared = [...tokens(a.headline)].filter((t) => tokens(b.headline).has(t));
  return shared.some((t) => /\d/.test(t) || names.has(t));
}

/** Folds duplicates already kept into one event (first found keeps its company), so a better rule also fixes earlier finds. */
export function mergeDuplicates(kept: MonitorEvent[]): MonitorEvent[] {
  const out: MonitorEvent[] = [];
  // Events kept by v1 monitors have no `detected`, `ids` or `found_by`; they sort first.
  for (const e of [...kept].sort((a, b) => (a.detected ?? '').localeCompare(b.detected ?? ''))) {
    const dup = out.find((k) => sameEvent(k, e));
    if (!dup) out.push(e);
    else {
      dup.ids = [...new Set([...(dup.ids ?? [dup.id]), ...(e.ids ?? [e.id])])];
      dup.found_by = [...new Set([...(dup.found_by ?? []), ...(e.found_by ?? [])])];
      dup.nct ??= e.nct;
      dup.source_url ??= e.source_url;
    }
  }
  return out;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

/**
 * Reads new events (free) from every monitor, or from one execution when a webhook names
 * it. Keeps events about a company on the map, merged across monitors; everything else
 * goes to monitor-unmatched.json with the reason. Returns how many were added. A monitor
 * this API key can't see is marked lost, and reconcileMonitors replaces it.
 */
export async function collectMonitorEvents(d: Disease, only?: { monitor_id: string; event_group_id?: string | null }): Promise<{ added: number; merged: number; unmatched: number }> {
  const result = { added: 0, merged: 0, unmatched: 0 };
  const doc = await monitorOf(d);
  const client = parallel(d, 'monitors');
  if (!doc || !client) return result;
  const { companies } = (await store.get<{ companies: Company[] }>(path(d, 'companies.json'))) ?? { companies: [] };
  const match = companyMatcher(companies);
  const kept = (await store.get<MonitorEvent[]>(path(d, 'monitor-events.json'))) ?? [];
  const other = (await store.get<Unmatched[]>(path(d, 'monitor-unmatched.json'))) ?? [];
  const seen = new Set([...kept.flatMap((e) => e.ids ?? [e.id]), ...other.map((e) => e.id)]);
  const entries = Object.entries(doc.monitors).filter(([, e]) => !e.lost && (!only || e.monitor_id === only.monitor_id));

  for (const [key, e] of entries) {
    const pages: any[][] = [];
    try {
      if (only?.event_group_id) pages.push(((await client.monitor.events(e.monitor_id, { event_group_id: only.event_group_id } as any)) as any).events ?? []);
      else {
        let cursor: string | undefined;
        // Newest first: stop at the first page with nothing new.
        for (let page = 0; page < 5; page++) {
          const res: any = await client.monitor.events(e.monitor_id, { limit: 100, ...(cursor ? { cursor } : {}) } as any);
          pages.push(res.events ?? []);
          cursor = res.next_cursor;
          if (!cursor || (res.events ?? []).every((x: any) => seen.has(x.event_id))) break;
        }
      }
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
      doc.monitors[key] = { ...e, lost: now() };
      log(d, `monitor ${key} (${e.monitor_id}) is not visible to this API key; it will be replaced`);
      continue;
    }
    for (const x of pages.flat()) {
      if (x.event_type !== 'event_stream' || !x.event_id || seen.has(x.event_id)) continue;
      seen.add(x.event_id);
      const c = typeof x.output?.content === 'string' ? safeJson(x.output.content) : x.output?.content;
      const source = (x.output?.basis ?? []).flatMap((b: any) => (b.citations ?? []).map((ci: any) => ci.url)).find(Boolean) ?? null;
      const miss = (reason: Unmatched['reason']) => {
        other.unshift({ id: x.event_id, monitor: key, reason, company: c?.company ?? null, headline: String(c?.headline ?? '').slice(0, 160), date: c?.date ?? null, source_url: source, detected: now() });
        result.unmatched += 1;
      };
      if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '')) {
        miss('no_date');
        continue;
      }
      if (c.about_indication === false) {
        miss('other_indication');
        continue;
      }
      const company = match(c.company ?? null, c.drug ?? null);
      if (!company) {
        miss('no_company_on_map');
        continue;
      }
      const nct = typeof c.nct === 'string' && (company.trials.includes(c.nct) || company.investigator_trials.includes(c.nct)) ? c.nct : null;
      const ev: MonitorEvent = { id: x.event_id, ids: [x.event_id], date: c.date, company: company.key, company_name: company.name, drug: c.drug ?? null, nct, type: c.type ?? 'other', headline: String(c.headline ?? '').slice(0, 120), source_url: source, found_by: [key], detected: now() };
      const dup = kept.find((k) => sameEvent(k, ev));
      if (dup) {
        dup.ids = [...new Set([...(dup.ids ?? [dup.id]), ev.id])];
        dup.found_by = [...new Set([...(dup.found_by ?? []), key])];
        dup.nct ??= ev.nct;
        dup.source_url ??= ev.source_url;
        result.merged += 1;
      } else {
        kept.unshift(ev);
        result.added += 1;
      }
    }
  }
  const merged = mergeDuplicates(kept).sort((a, b) => b.date.localeCompare(a.date));
  result.merged += kept.length - merged.length;
  const changed = result.added + result.merged + result.unmatched > 0;
  const lost = Object.values(doc.monitors).some((e) => e.lost);
  // A webhook that brings nothing new writes nothing; the daily job always records that it read.
  if (!changed && !lost && only) return result;
  if (changed) {
    await store.put(path(d, 'monitor-events.json'), merged);
    await store.put(path(d, 'monitor-unmatched.json'), other.slice(0, 500));
  }
  // Re-read before writing: a webhook and the daily job can collect at the same time, and
  // only the lost marks and the health belong to this call.
  const latest = (await monitorOf(d)) ?? doc;
  for (const [key, e] of Object.entries(doc.monitors)) if (e.lost && latest.monitors[key]?.monitor_id === e.monitor_id) latest.monitors[key] = e;
  latest.health = { last_collected: now(), last_new: result.added ? now() : (latest.health?.last_new ?? null) };
  await store.put(path(d, 'monitor.json'), latest);
  log(d, `monitors: ${result.added} new events about companies on the map, ${result.merged} found again by another monitor, ${result.unmatched} set aside (see monitor-unmatched.json)`);
  return result;
}

/** Per monitor: events it found, events only it found, and what it set aside. For pruning the set. */
export async function monitorReport(d: Disease) {
  const doc = await monitorOf(d);
  const kept = (await store.get<MonitorEvent[]>(path(d, 'monitor-events.json'))) ?? [];
  const other = (await store.get<Unmatched[]>(path(d, 'monitor-unmatched.json'))) ?? [];
  const rows = Object.entries(doc?.monitors ?? {}).map(([key, e]) => ({
    monitor: key,
    label: e.label,
    found: kept.filter((k) => k.found_by?.includes(key)).length,
    only_this_one: kept.filter((k) => k.found_by?.length === 1 && k.found_by[0] === key).length,
    other_indication: other.filter((o) => o.monitor === key && o.reason === 'other_indication').length,
    not_on_map: other.filter((o) => o.monitor === key && o.reason === 'no_company_on_map').length,
  }));
  return { since: Object.values(doc?.monitors ?? {}).map((e) => e.created).sort()[0] ?? null, events: kept.length, rows, aside: other.slice(0, 30) };
}
