import { registryChangeSummary, missingFromActiveSearch, type LiveStatus } from '@/lib/domain/freshness';
import { loadPack } from '@/lib/server/context';
import { context, isKey, json, notFound } from '@/lib/server/http';
import { requestState, resolveCompany } from '@/lib/server/research';

export const dynamic = 'force-dynamic';

const TTL = 10 * 60;

/**
 * Registry re-read on open (HANDOFF-v2.1 section 5): today's ClinicalTrials.gov
 * statuses against the pack, with each flag recomputed. Free; cached 10 min.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = context();
  if (c instanceof Response) return c;
  if (!isKey(key)) return notFound();
  const cacheKey = `registry:${key}`;
  const hit = await c.kv.get(cacheKey);
  if (hit) return json({ ...JSON.parse(hit), cached: true });

  const name = new URL(request.url).searchParams.get('name') ?? undefined;
  const company = (await resolveCompany(c, { key })) ?? (await requestState(c, key))?.company ?? (name ? await resolveCompany(c, { name }) : null);
  const loaded = await loadPack(key, c);
  if (!company && !loaded) return notFound();
  const co = company ?? { key, name: loaded!.pack.about.company, match: loaded!.pack.about.company.toLowerCase(), aliases: [], lead_asset: '' };
  const stage1 = await c.registry.companyTrials(co);
  const live: Record<string, LiveStatus> = Object.fromEntries(stage1.map((r) => [r.nct_id, { status: r.status, last_update_posted: r.last_update_posted }]));
  const rows = loaded?.pack.rows ?? [];
  const missing = missingFromActiveSearch(rows, live);
  const leftRecords = missing.length ? await c.registry.lookup(missing) : {};
  const left: Record<string, LiveStatus> = Object.fromEntries(Object.entries(leftRecords).map(([id, r]) => [id, { status: r.status }]));
  const { byTrial, changed } = registryChangeSummary(rows, live, left);
  const known = new Set(rows.map((r) => r.nct_id));
  const body = {
    key,
    checked_at: c.now().toISOString(),
    trials: stage1.length,
    changed,
    freshness: byTrial,
    // Trials that became active since the research was recorded: listed from the registry, unchecked.
    new_trials: stage1.filter((r) => !known.has(r.nct_id)),
    stage1: loaded ? undefined : stage1,
  };
  await c.kv.set(cacheKey, JSON.stringify(body), { exSeconds: TTL });
  return json({ ...body, cached: false });
}
