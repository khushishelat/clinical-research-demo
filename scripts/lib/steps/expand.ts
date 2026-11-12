// Daily: companies the news Monitors find that the map lacks join it on their own.
// News about a company not on the map is set aside (monitor-unmatched.json). Each such
// company gets one OWNER run (pro, $0.10, step 3's spec and run log) and joins as a
// web-found row when it has a drug for the indication in Phase 1 or later that is not only
// a generic (inScopeDrug, the review rule). Then every approved web-found row without
// research gets FACTS and DEALS runs (pro, $0.20) and, with no ClinicalTrials.gov trial, an
// other-registries run (pro, $0.10), and set-aside news moves onto the rows it now matches.
// At most WEEKLY_LOOKUPS companies are looked up per indication per week; the rest wait.
// spaces/<d>/expand.json records every company looked at, so none is paid for twice.

import type { Company, Facts } from '../../../src/lib/space/types';
import { aliasesOf, companyKey, inScopeDrug, joinRow, ownerFrom, rowNameFor, type Owner } from '../companies';
import { groupRuns, log, parallel, pool, runLog, runOnce, spacePath, store, today as todayOf, type Disease } from '../pipeline';
import { elsewhereFor, type ElsewhereTrial } from '../registries';
import { assertNoContacts, redactBasis, type Trial } from '../registry';
import { DEALS, FACTS, OTHER_REGISTRIES } from '../specs';
import { cleanFacts, dealsUnit, factsRecord, factsUnit, ownerUnit, registriesUnit } from '../units';
import { companyMatcher, onMap, rejoinSetAside, type Unmatched } from './monitors';

export const WEEKLY_LOOKUPS = 5;
type Outcome = 'added' | 'out_of_scope' | 'on_map' | 'not_a_company' | 'failed';
export type Looked = { name: string; date: string; outcome: Outcome; why: string; row?: string; run_id?: string };
/** spaces/<d>/expand.json, keyed by companyKey. */
export type ExpandDoc = { looked: Record<string, Looked> };
type CompaniesDoc = { companies: Company[] } & Record<string, unknown>;
type Review = { company: string; include: boolean | null } & Record<string, unknown>;

// Institutions, regulators and descriptions a monitor wrote where a company name belongs.
const NOT_A_COMPANY = /\b(universit\w*|hospitals?|college|institutes?|school|medical cent(er|re)|clinics?|ministry|agency|administration|commission|foundation|association|society|FDA|EMA|NIH|no company|multiple|holders)\b/i;
const PAID: Outcome[] = ['added', 'out_of_scope', 'failed'];

/**
 * Set-aside companies to look up now, newest news first, within the week's lookups; and the
 * ones settled without a run (already on the map, or not a company).
 */
export function lookups(other: Unmatched[], companies: Company[], doc: ExpandDoc, today: string): { now: string[]; settled: Record<string, Looked> } {
  const known = onMap(companies);
  const settled: Record<string, Looked> = {};
  const queue: string[] = [];
  for (const o of other) {
    if (o.reason !== 'no_company_on_map' || !o.company) continue;
    const k = companyKey(o.company);
    if (!k || doc.looked[k] || settled[k] || queue.some((n) => companyKey(n) === k)) continue;
    if (known(o.company)) settled[k] = { name: o.company, date: today, outcome: 'on_map', why: 'names a company on the map' };
    else if (NOT_A_COMPANY.test(o.company)) settled[k] = { name: o.company, date: today, outcome: 'not_a_company', why: 'an institution' };
    else queue.push(o.company);
  }
  const weekAgo = new Date(Date.parse(today) - 7 * 86_400_000).toISOString().slice(0, 10);
  const used = Object.values(doc.looked).filter((x) => PAID.includes(x.outcome) && x.date > weekAgo).length;
  return { now: queue.slice(0, Math.max(0, WEEKLY_LOOKUPS - used)), settled };
}

/**
 * What a lookup decides: on the map already (by its owner's name, or a drug a row already
 * lists, as with "Roche AG" and the Hoffmann-La Roche row), in scope, or not.
 */
export function judge(name: string, o: Owner, companies: Company[]): { outcome: 'added' | 'out_of_scope' | 'on_map'; why: string } {
  const owner = rowNameFor(name, o).name;
  if (onMap(companies)(owner)) return { outcome: 'on_map', why: `owned by ${owner}` };
  const match = companyMatcher(companies);
  for (const x of o.drugs)
    for (const a of aliasesOf(x)) {
      const row = match(null, a);
      if (row) return { outcome: 'on_map', why: `${x.name} is on ${row.name}'s row` };
    }
  const drug = o.drugs.find(inScopeDrug);
  return drug ? { outcome: 'added', why: `${drug.name}: ${drug.highest_phase}` } : { outcome: 'out_of_scope', why: o.drugs.map((x) => `${x.name}: ${x.highest_phase}`).join('; ') || 'no drug for the indication' };
}

export async function expandStep(d: Disease, today = todayOf()): Promise<{ added: string[]; researched: string[]; rejoined: number }> {
  const out = { added: [] as string[], researched: [] as string[], rejoined: 0 };
  const doc = await store.get<CompaniesDoc>(spacePath(d, 'companies.json'));
  if (!doc) return out;
  const other = (await store.get<Unmatched[]>(spacePath(d, 'monitor-unmatched.json'))) ?? [];
  const review = (await store.get<Review[]>(spacePath(d, 'review/companies.json'))) ?? [];
  const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json'))) ?? { trials: [] as Trial[] };
  const factsDoc = await store.get<{ facts: Record<string, Facts> } & Record<string, unknown>>(spacePath(d, 'facts.json'));
  const expand = (await store.get<ExpandDoc>(spacePath(d, 'expand.json'))) ?? { looked: {} };
  const { now, settled } = lookups(other, doc.companies, expand, today);
  Object.assign(expand.looked, settled);

  const approved = () => new Set(review.filter((r) => r.include).map((r) => r.company));
  const unresearched = () => (factsDoc ? doc.companies.filter((c) => c.web_only && approved().has(c.name) && !factsDoc.facts[c.key]) : []);
  const client = now.length || unresearched().length ? parallel(d, 'map expansion') : null;

  // 1. Who each company is, and whether it has a drug that earns a row.
  if (client && now.length) {
    const rl = await runLog(d, 'companies');
    await pool(now, 5, async (name) => {
      const k = companyKey(name);
      const u = ownerUnit(d, today, name, trials);
      const rec = await runOnce(client, rl, u.key, u.spec);
      if (!rec.content) {
        expand.looked[k] = { name, date: today, outcome: 'failed', why: `owner run ${rec.status}`, run_id: rec.run_id };
        return;
      }
      const o = ownerFrom(rec.content);
      const verdict = judge(name, o, doc.companies);
      expand.looked[k] = { name, date: today, ...verdict, run_id: rec.run_id };
      if (verdict.outcome === 'added') {
        const news = other.find((x) => x.company && companyKey(x.company) === k);
        const { row } = joinRow(doc.companies, name, o);
        row.found = { by: 'monitor', date: today, headline: news?.headline ?? null, source_url: news?.source_url ?? null };
        const entry = { company: row.name, include: true, decided: today, added_by: 'monitor', drugs: row.drugs.map((x) => `${x.name} (${x.highest_phase})`), source: o.owner_source_url };
        const i = review.findIndex((r) => r.company === row.name);
        if (i >= 0) review[i] = { ...review[i], ...entry };
        else review.push(entry);
        expand.looked[k].row = row.key;
        out.added.push(row.name);
      }
    });
    if (out.added.length) {
      await store.put(spacePath(d, 'companies.json'), doc);
      await store.put(spacePath(d, 'review/companies.json'), review);
    }
  }
  if (Object.keys(settled).length || now.length) await store.put(spacePath(d, 'expand.json'), expand);
  for (const [k, x] of Object.entries(expand.looked)) if (now.some((n) => companyKey(n) === k) || settled[k]) log(d, `expansion: ${x.name}: ${x.outcome} (${x.why})`);

  // 2. Approved web-found rows not yet researched: added here, by hand, or approved in review.
  const targets = unresearched();
  if (client && factsDoc && targets.length) {
    const byNct = new Map(trials.map((t) => [t.nct, t]));
    const res = await groupRuns(client, await runLog(d, 'enrich'), d, 'facts', targets.flatMap((c) => [factsUnit(d, today, c, byNct), dealsUnit(d, today, c, byNct)]), 12);
    const done: Company[] = [];
    for (const c of targets) {
      const fr = res[`${FACTS.key}:${c.key}`];
      const dr = res[`${DEALS.key}:${c.key}`];
      if (!fr?.content || !dr?.content) continue;
      factsDoc.facts[c.key] = factsRecord(cleanFacts(c, fr.content as Facts, dr.content as Facts), fr);
      const basis = [...redactBasis(fr.basis), ...redactBasis(dr.basis)];
      assertNoContacts(`basis ${c.key}`, basis);
      await store.put(spacePath(d, `basis/${c.key}.json`), { company: c.name, run_id: fr.run_id, basis });
      done.push(c);
    }
    if (done.length) {
      assertNoContacts('facts', factsDoc.facts);
      await store.put(spacePath(d, 'facts.json'), { ...factsDoc, built: new Date().toISOString() });
      out.researched.push(...done.map((c) => c.name));
    }
    // Their trials outside ClinicalTrials.gov, as step 7 finds them.
    const elsewhere = done.filter((c) => !c.trials.length && !c.investigator_trials.length);
    if (elsewhere.length) {
      const since = d.include_completed_since ?? `${Number(today.slice(0, 4)) - 2}-01-01`;
      const rr = await groupRuns(client, await runLog(d, 'registries'), d, 'registries', elsewhere.map((c) => registriesUnit(d, c, since)), 12);
      const reg = (await store.get<{ companies: Record<string, ElsewhereTrial[]> } & Record<string, unknown>>(spacePath(d, 'other-registries.json'))) ?? { disease: d.key, spec: OTHER_REGISTRIES.key, companies: {} };
      for (const c of elsewhere) {
        const got = ((rr[`${OTHER_REGISTRIES.key}:${c.key}`]?.content as { trials?: ElsewhereTrial[] } | undefined)?.trials ?? []) as ElsewhereTrial[];
        const { kept } = await elsewhereFor(got, d.include_completed_since ?? null);
        if (kept.length) reg.companies[c.key] = kept;
      }
      await store.put(spacePath(d, 'other-registries.json'), { ...reg, built: new Date().toISOString() });
    }
    log(d, `expansion: researched ${done.length} of ${targets.length} approved web-found rows (${done.map((c) => c.name).join(', ') || 'none finished'})`);
  }

  // 3. Their news, set aside while they were off the map.
  out.rejoined = await rejoinSetAside(d);
  return out;
}
