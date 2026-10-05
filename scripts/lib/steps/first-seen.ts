// Step 8: "on the web N days earlier". For trials registered in the last 90
// days, one base run finds the first public announcement that refers to that
// trial (a plan to run "a Phase 3" doesn't count); the tag shows only when it
// came before the registry.
//   npx tsx scripts/08-first-seen.mts --disease mash

import { groupRuns, log, parallel, runLog, spacePath, store, where, type Disease } from '../pipeline';
import type { Trial } from '../registry';
import { FIRST_SEEN } from '../specs';

export async function firstSeenStep(d: Disease) {
  const client = parallel(d, 'first-seen');
  if (!client) return;
  const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
  const { companies } = (await store.get<{ companies: any[] }>(spacePath(d, 'companies.json')))!;
  const owner = new Map<string, any>();
  for (const c of companies) for (const n of [...c.trials, ...c.investigator_trials]) if (!owner.has(n)) owner.set(n, c);
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = trials.filter((t) => t.first_posted >= since && owner.has(t.nct));
  const rl = await runLog(d, 'first-seen');
  const res = await groupRuns(
    client,
    rl,
    d,
    'first-seen',
    recent.map((t) => {
      const c = owner.get(t.nct);
      return { key: `${FIRST_SEEN.key}:${t.nct}`, spec: { processor: FIRST_SEEN.processor, schema: FIRST_SEEN.schema, input: FIRST_SEEN.input({ nct: t.nct, acronym: t.acronym, title: t.title, company: c.name, drugs: c.drugs.map((x: any) => x.name).slice(0, 4), first_posted: t.first_posted }), metadata: { nct: t.nct } } };
    })
  );
  const out: Record<string, unknown> = {};
  for (const t of recent) {
    const c: any = res[`${FIRST_SEEN.key}:${t.nct}`]?.content;
    if (!c?.first_announced || !/^\d{4}-\d{2}-\d{2}$/.test(c.first_announced)) continue;
    const days = Math.round((Date.parse(t.first_posted) - Date.parse(c.first_announced)) / 86_400_000);
    out[t.nct] = { first_announced: c.first_announced, source_url: c.source_url, what: c.what, how_it_refers: c.how_it_refers, plan_announced: c.plan_announced ?? null, registry_first_posted: t.first_posted, days_earlier: days > 0 ? days : 0 };
  }
  await store.put(spacePath(d, 'first-seen.json'), out);
  const earlier = Object.entries(out).filter(([, v]: any) => v.days_earlier > 0);
  log(d, `${recent.length} recent trials checked · ${earlier.length} were on the web first: ${earlier.map(([n, v]: any) => `${n} ${v.days_earlier}d`).join(', ')}`);
  log(d, `saved to ${where}spaces/${d.key}/first-seen.json`);
}
