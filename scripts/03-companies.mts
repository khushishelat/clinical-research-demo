// Step 3: the rows. Registry sponsors are resolved to their current owner with
// their drugs and codes (Task API, pro, ChEMBL + ClinicalTrials.gov), and the
// web's list of companies is built by interaction chaining (ultra, until dry).
// Investigator-run trials join the company whose drug they test. Companies
// found only on the web go to a review file for a person to approve.
//   npx tsx scripts/03-companies.mts --disease mash [--seed-from-tests]

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { aliasesOf, companyKey, displayName, isApproved, isHoldingCompany, mergeRows, phaseRank, trialTests, trialUses, type Drug } from './lib/companies';
import { chain, disease, log, parallel, pool, runLog, runOnce, spacePath, store, today, where } from './lib/pipeline';
import type { Company } from '../src/lib/space/types';
import type { Trial } from './lib/registry';
import { COMPANY_CHAIN, OWNER, SAME_COMPANY } from './lib/specs';

const d = disease();
const client = parallel(d, 'companies');
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json'))) ?? { trials: [] as Trial[] };
if (!trials.length) throw new Error('No trials yet. Run 02-registry first.');
const sponsors = [...new Set(trials.filter((t) => t.run_by === 'company').map((t) => t.sponsor))].sort();
const rl = await runLog(d, 'companies');

// The Oct 1 tests ran this exact work (12 sponsors on pro, and MASH's 4-page
// company chain). Reuse those runs by ID instead of paying again.
const TESTS = '.data/tests/v5-survey.state.json';
if (process.argv.includes('--seed-from-tests') && existsSync(TESTS)) {
  const t = JSON.parse(readFileSync(TESTS, 'utf8'));
  let n = 0;
  for (const [k, v] of Object.entries<any>(t.owners ?? {})) {
    const [proc, sponsor] = k.split('|');
    if (proc !== 'pro' || rl.log[`owner:${sponsor}`] || !v.run_id) continue;
    rl.log[`owner:${sponsor}`] = { run_id: v.run_id, processor: 'pro', created: '' };
    n += 1;
  }
  for (const [i, p] of (t.chains?.[`${d.key}:companies`]?.pages ?? []).entries()) {
    if (rl.log[`web:p${i + 1}`]) continue;
    rl.log[`web:p${i + 1}`] = { run_id: p.run_id, interaction_id: p.interaction_id, previous_interaction_id: p.previous_interaction_id, processor: 'ultra', created: '' };
    n += 1;
  }
  await rl.save();
  log(d, `reused ${n} runs from the Oct 1 tests`);
}

// Runs sometimes explain instead of naming ("Lepu Medical group; the proposed transfer…"): keep the name.
const ownerName = (x: string | null | undefined) => (x ?? '').split(/;|\(|,\s+(?:the|which|but|pending|not)\b/i)[0].replace(/\s+group$/i, '').trim();

type Owner = { current_owner: string; relationship: string; announced: string | null; closed: string | null; value: string | null; owner_source_url: string; drugs: Drug[] };
// Older runs named the fields mash_drugs / highest_phase_in_mash; trial IDs never count as drug codes.
const ownerFrom = (c: any): Owner => ({ ...c, drugs: (c.drugs ?? c.mash_drugs ?? []).map((x: any) => ({ ...x, highest_phase: x.highest_phase ?? x.highest_phase_in_mash ?? '', codes: (x.codes ?? []).filter((y: string) => !/^NCT\d{8}$/i.test(y)) })) });
const owners: Record<string, Owner> = {};
if (client) {
  await pool(sponsors, 8, async (sponsor) => {
    const mine = trials.filter((t) => t.sponsor === sponsor).map((t) => ({ nct: t.nct, title: t.title, interventions: t.interventions.map((i) => i.name), phase: t.phases.join('/') }));
    const rec = await runOnce(client, rl, `owner:${sponsor}`, { processor: OWNER.processor, connectors: OWNER.connectors, schema: OWNER.schema, input: OWNER.input(d, sponsor, today(), mine), metadata: { job: 'owner', disease: d.key } });
    if (rec.content) owners[sponsor] = ownerFrom(rec.content);
    else log(d, `owner run for ${sponsor}: ${rec.status}`);
  });
} else {
  for (const sponsor of sponsors) {
    const c = rl.log[`owner:${sponsor}`]?.content;
    if (c) owners[sponsor] = ownerFrom(c);
  }
}

type WebCompany = { company: string; country: string; drugs: { name: string; codes: string[]; mechanism: string; highest_phase: string; approved_in: string[] }[]; source_url: string };
const web: WebCompany[] = client
  ? await chain<WebCompany>(client, rl, 'web', { ...COMPANY_CHAIN, first: COMPANY_CHAIN.first(d, today()), next: COMPANY_CHAIN.next(d), dedupe: (x) => companyKey(x.company), metadata: { job: 'company-chain', disease: d.key } })
  : Object.keys(rl.log)
      .filter((k) => k.startsWith('web:p'))
      .flatMap((k) => ((rl.log[k].content as any)?.companies ?? []) as WebCompany[]);

// ── Join in code ─────────────────────────────────────────────────────────────
const companies = new Map<string, Company>();
const blank = (key: string, name: string): Company => ({ key, name, relationship: 'independent', owner_source: null, acquisitions: [], registry_sponsors: [], drugs: [], trials: [], investigator_trials: [], web: null, web_only: false, approved: false, max_phase: 0 });

for (const sponsor of sponsors) {
  const o = owners[sponsor];
  // Rows are operating companies: keep the sponsor when its "owner" is a foundation or holding company.
  const byHolding = o && isHoldingCompany(o.current_owner) && !['acquired', 'merged'].includes(o.relationship);
  const name = (byHolding ? sponsor : ownerName(o?.current_owner)) || sponsor;
  const key = companyKey(name);
  const c = companies.get(key) ?? blank(key, displayName(name));
  c.registry_sponsors.push(sponsor);
  c.trials.push(...trials.filter((t) => t.sponsor === sponsor && t.run_by === 'company').map((t) => t.nct));
  if (o) {
    c.owner_source ??= o.owner_source_url;
    if (['acquired', 'merged'].includes(o.relationship) && companyKey(sponsor) !== key) c.acquisitions.push({ sponsor, announced: o.announced, closed: o.closed, value: o.value, source: o.owner_source_url });
    for (const drug of o.drugs) if (!c.drugs.some((x) => x.name.toLowerCase() === drug.name.toLowerCase())) c.drugs.push(drug);
  }
  companies.set(key, c);
}
// A web result may name the registry sponsor (Fujian Shengdi) rather than its owner (Hengrui).
const bySponsorKey = new Map<string, string>();
for (const c of companies.values()) for (const sp of c.registry_sponsors) bySponsorKey.set(companyKey(sp), c.key);
for (const w of web) {
  const key = bySponsorKey.get(companyKey(w.company)) ?? companyKey(w.company);
  const existing = companies.get(key);
  const c = existing ?? { ...blank(key, displayName(w.company)), web_only: true };
  c.web = { country: w.country, source: w.source_url };
  for (const drug of w.drugs ?? []) {
    if (c.drugs.some((x) => x.name.toLowerCase() === drug.name.toLowerCase())) continue;
    c.drugs.push({ name: drug.name, codes: drug.codes ?? [], mechanism: drug.mechanism, mechanism_source: 'web', chembl_id: null, rights_holder: null, highest_phase: drug.approved_in?.length ? `Approved (${drug.approved_in.join(', ')})` : drug.highest_phase });
  }
  companies.set(key, c);
}

// One company, one row: a Task run groups names that are the same company today.
// Keyed by the names, so the same set of rows reuses the run.
const rowNames = [...new Set([...companies.values()].flatMap((c) => [c.name, ...c.registry_sponsors]))].sort();
const sameKey = `same:${createHash('sha1').update(rowNames.join('|')).digest('hex').slice(0, 12)}`;
const same = client || rl.log[sameKey] ? await runOnce(client!, rl, sameKey, { processor: SAME_COMPANY.processor, schema: SAME_COMPANY.schema, input: SAME_COMPANY.input(d, rowNames), metadata: { job: 'same-company', disease: d.key } }) : null;
const merges = mergeRows(companies, ((same?.content as any)?.groups ?? []) as { names: string[]; company: string }[]);
for (const m of merges) log(d, `same company: ${m.from.join(', ')} → ${m.into}`);

// Who a drug belongs to: the company with the most of its own trials of it,
// counting every name and code of the drug (Innovent registers mazdutide as
// IBI362). If those are all Phase 4 studies of a marketed drug, it is a generic
// here and claims no investigator trials (handoff: generics stay unassigned).
const companyTrials = new Map(trials.filter((t) => t.run_by === 'company').map((t) => [t.nct, t]));
const aliasOwner = new Map<string, string | null>();
const ownerOf = (alias: string): string | null => {
  if (aliasOwner.has(alias)) return aliasOwner.get(alias)!;
  let best: { key: string; n: number; early: boolean } | null = null;
  for (const c of companies.values()) {
    const drug = c.drugs.find((x) => aliasesOf(x).includes(alias));
    if (!drug) continue;
    const names = aliasesOf(drug);
    const mine = c.trials.map((n) => companyTrials.get(n)).filter((t): t is Trial => Boolean(t) && names.some((a) => trialUses(t!, a)));
    const cand = { key: c.key, n: mine.length, early: mine.some((t) => t.phase_level > 0 && t.phase_level <= 3) };
    if (!best || cand.n > best.n) best = cand;
  }
  // A company with no trial of its own here can still own the drug (e.g. a web-found originator).
  const owner = best && (best.early || (best.n === 0 && !companies.get(best.key)!.trials.length)) ? best.key : null;
  aliasOwner.set(alias, owner);
  return owner;
};
const owns = (c: Company, drug: Drug) => aliasesOf(drug).some((a) => ownerOf(a) === c.key);

// Investigator-run trials join the company whose drug sits in an experimental arm.
const claims = new Map<string, Set<string>>();
for (const t of trials.filter((x) => x.run_by === 'investigator')) {
  for (const c of companies.values())
    for (const drug of c.drugs)
      for (const a of aliasesOf(drug)) if (ownerOf(a) === c.key && trialTests(t, a)) (claims.get(t.nct) ?? claims.set(t.nct, new Set()).get(t.nct)!).add(c.key);
}
const conflicts: { nct: string; companies: string[] }[] = [];
for (const [nct, keys] of claims) {
  // A combination trial can test two companies' drugs; it shows in both rows.
  if (keys.size > 1) conflicts.push({ nct, companies: [...keys] });
  for (const k of keys) companies.get(k)!.investigator_trials.push(nct);
}
for (const c of companies.values()) {
  // Approved only for drugs the company owns here (a generic maker testing resmetirom is not Madrigal).
  c.approved = c.drugs.some((x) => isApproved(x.highest_phase) && owns(c, x));
  const trialPhase = Math.max(0, ...[...c.trials, ...c.investigator_trials].map((n) => trials.find((t) => t.nct === n)?.phase_level ?? 0));
  c.max_phase = Math.max(trialPhase, ...c.drugs.filter((x) => owns(c, x)).map((x) => phaseRank(x.highest_phase)));
  c.relationship = c.acquisitions.length ? 'acquirer' : c.relationship;
}
const list = [...companies.values()].sort((a, b) => Number(b.approved) - Number(a.approved) || b.max_phase - a.max_phase || b.trials.length + b.investigator_trials.length - (a.trials.length + a.investigator_trials.length));
const assigned = new Set(list.flatMap((c) => [...c.trials, ...c.investigator_trials]));
const unassigned = trials.filter((t) => t.run_by === 'investigator' && !assigned.has(t.nct)).map((t) => t.nct);

await store.put(spacePath(d, 'companies.json'), { disease: d.key, built: new Date().toISOString(), companies: list, unassigned_investigator_trials: unassigned, shared_trials: conflicts });
// Keep any decisions a person already made in the review file.
const prior = new Map(((await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? []).map((r) => [r.company, r.include]));
const review = list.filter((c) => c.web_only).map((c) => ({ include: prior.get(c.name) ?? null, company: c.name, country: c.web?.country, drugs: c.drugs.map((x) => `${x.name} (${x.highest_phase})`), source: c.web?.source, registry_trials: c.trials.length + c.investigator_trials.length }));
await store.put(spacePath(d, 'review/companies.json'), review);

const withTrials = list.filter((c) => c.trials.length + c.investigator_trials.length);
const companyRun = trials.filter((t) => t.run_by === 'company').length;
log(d, `${sponsors.length} registry sponsors → ${list.filter((c) => !c.web_only).length} companies; web adds ${review.length} for review`);
log(d, `companies' drugs on the map: ${assigned.size} trials (${companyRun} company-run + ${assigned.size - companyRun} investigator-run); ${unassigned.length} investigator trials unassigned`);
log(d, `${withTrials.length} companies have active trials · ${list.filter((c) => c.approved).length} with an approved drug · ${conflicts.length} trials shared by two companies`);
for (const c of list.filter((x) => x.acquisitions.length)) log(d, `acquisition: ${c.acquisitions.map((a) => `${a.sponsor} → ${c.name} (closed ${a.closed ?? '?'})`).join('; ')}`);
log(d, `saved to ${where}spaces/${d.key}/companies.json and review/companies.json`);
