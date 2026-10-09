// Daily news for an indication from one Monitor (base, daily). The monitor's ID
// is kept in the store next to the indication (monitor.json); events land in
// monitor-events.json, joined to a company on the map by name, and step 6 adds
// them to the feed. Creating a monitor starts a daily charge, so it happens only
// when the indication's config sets `monitor: true` (the daily job creates it,
// with the deployment's API key) or on request from the CLI.

import type { Company } from '../../../src/lib/space/types';
import { companyKey } from '../companies';
import { log, parallel, spacePath, store, type Disease } from '../pipeline';
import { MONITOR } from '../specs';

/** `lost`: the API key no longer sees this monitor (it was created with another key); `previous` keeps replaced IDs. */
type MonitorDoc = { monitor_id: string; spec: string; created: string; cancelled?: string | null; lost?: string | null; previous?: string[] };
export type MonitorEvent = { id: string; date: string; company: string; company_name: string; drug: string | null; nct: string | null; type: string; headline: string; source_url: string | null };

export const monitorOf = (d: Disease) => store.get<MonitorDoc>(spacePath(d, 'monitor.json'));

export async function createMonitor(d: Disease): Promise<MonitorDoc | null> {
  const existing = await monitorOf(d);
  if (existing && !existing.cancelled && !existing.lost) return existing;
  const client = parallel(d, 'monitor');
  if (!client) return null;
  const m: any = await client.monitor.create({
    type: 'event_stream',
    frequency: MONITOR.frequency,
    processor: MONITOR.processor,
    settings: { query: MONITOR.query(d), include_backfill: true, output_schema: { type: 'json', json_schema: MONITOR.schema } },
    metadata: { app: 'trial-check', disease: d.key, spec: MONITOR.key },
  } as any);
  const previous = existing ? [...(existing.previous ?? []), existing.monitor_id] : [];
  const doc = { monitor_id: m.monitor_id as string, spec: MONITOR.key, created: new Date().toISOString(), ...(previous.length ? { previous } : {}) };
  await store.put(spacePath(d, 'monitor.json'), doc);
  log(d, `monitor ${doc.monitor_id} created (${MONITOR.processor}, daily)`);
  return doc;
}

export async function cancelMonitor(d: Disease) {
  const doc = await monitorOf(d);
  const client = parallel(d, 'monitor');
  if (!doc || doc.cancelled || !client) return;
  await client.monitor.cancel(doc.monitor_id);
  await store.put(spacePath(d, 'monitor.json'), { ...doc, cancelled: new Date().toISOString() });
  log(d, `monitor ${doc.monitor_id} cancelled`);
}

/**
 * Reads new events (free) and keeps those about a company on the map. Returns how many were
 * added, or -1 when this API key can't see the monitor (created with another key): the doc is
 * marked lost so createMonitor makes a replacement.
 */
export async function collectMonitorEvents(d: Disease): Promise<number> {
  const doc = await monitorOf(d);
  const client = parallel(d, 'monitor');
  if (!doc || doc.cancelled || doc.lost || !client) return 0;
  try {
    await client.monitor.retrieve(doc.monitor_id);
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
    await store.put(spacePath(d, 'monitor.json'), { ...doc, lost: new Date().toISOString() });
    log(d, `monitor ${doc.monitor_id} is not visible to this API key; it will be replaced`);
    return -1;
  }
  const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
  const byKey = new Map(companies.map((c) => [companyKey(c.name), c]));
  for (const c of companies) for (const s of c.registry_sponsors ?? []) if (!byKey.has(companyKey(s))) byKey.set(companyKey(s), c);
  const saved = (await store.get<MonitorEvent[]>(spacePath(d, 'monitor-events.json'))) ?? [];
  const seen = new Set(saved.map((e) => e.id));
  const added: MonitorEvent[] = [];
  let cursor: string | null | undefined;
  // Newest first: stop paging at the first page with nothing new.
  for (let page = 0; page < 5; page++) {
    const res: any = await client.monitor.events(doc.monitor_id, { limit: 100, ...(cursor ? { cursor } : {}) } as any);
    let fresh = 0;
    for (const e of res.events ?? []) {
      if (e.event_type !== 'event_stream' || !e.event_id || seen.has(e.event_id)) continue;
      fresh += 1;
      seen.add(e.event_id);
      const c = typeof e.output?.content === 'string' ? safeJson(e.output.content) : e.output?.content;
      if (!c?.company || !/^\d{4}-\d{2}-\d{2}$/.test(c.date ?? '')) continue;
      const company = byKey.get(companyKey(c.company));
      if (!company) continue;
      const source = (e.output?.basis ?? []).flatMap((b: any) => (b.citations ?? []).map((ci: any) => ci.url)).find(Boolean) ?? null;
      const nct = typeof c.nct === 'string' && (company.trials.includes(c.nct) || company.investigator_trials.includes(c.nct)) ? c.nct : null;
      added.push({ id: e.event_id, date: c.date, company: company.key, company_name: company.name, drug: c.drug ?? null, nct, type: c.type ?? 'other', headline: String(c.headline ?? '').slice(0, 120), source_url: source });
    }
    cursor = res.next_cursor;
    if (!cursor || !fresh) break;
  }
  if (added.length) await store.put(spacePath(d, 'monitor-events.json'), [...added, ...saved]);
  log(d, `monitor: ${added.length} new events about companies on the map`);
  return added.length;
}

const safeJson = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
