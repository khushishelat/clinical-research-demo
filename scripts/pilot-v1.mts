// Pilot of the v1 Task specs on a handful of companies, before freezing them.
// Runs OWNER, FACTS, READOUT and WEB_ROLES v1 under the same run-log keys the
// pipeline uses (so the next build reuses these runs), leaves the app's data
// alone, and scores the pass criteria into pilot-v1/report.md.
//   npx tsx scripts/pilot-v1.mts --disease mash --companies "novo nordisk,madrigal,gsk"

import type { Company, Facts, Readout, Trial } from '../src/lib/space/types';
import { aliasesOf } from './lib/companies';
import { disease, groupRuns, log, parallel, pool, runLog, runOnce, spacePath, store, today } from './lib/pipeline';
import { DEALS, FACTS, OWNER, PHASES, READOUT, WEB_ROLES } from './lib/specs';
import { cleanFacts, dealsUnit, factsUnit, ownerUnit, readoutTrials, readoutUnit, rolesUnit } from './lib/units';

const d = disease();
const client = parallel(d, 'pilot');
if (!client) process.exit(1);
const i = process.argv.indexOf('--companies');
const keys = (i > 0 ? process.argv[i + 1] : '').split(',').map((x) => x.trim()).filter(Boolean);
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json')))!;
const pick = keys.map((k) => companies.find((c) => c.key === k)).filter((c): c is Company => Boolean(c));
if (pick.length !== keys.length) throw new Error(`Unknown company keys: ${keys.filter((k) => !companies.some((c) => c.key === k)).join(', ')}`);
const byNct = new Map(trials.map((t) => [t.nct, t]));
const now = today();
const sponsors = pick.flatMap((c) => c.registry_sponsors);
log(d, `pilot: ${pick.length} companies · ${sponsors.length} owner runs (pro) · ${pick.length} facts + ${pick.length} deals runs (pro) · ${pick.length} roles runs (pro) · readouts (core) after facts`);

// Owners (step 3's run log), facts and readouts (step 4's), roles (step 5's).
const rlCo = await runLog(d, 'companies');
const owners: Record<string, any> = {};
await pool(sponsors, 6, async (sp) => {
  const u = ownerUnit(d, now, sp, trials);
  owners[sp] = (await runOnce(client, rlCo, u.key, u.spec)).content;
});
const rlEn = await runLog(d, 'enrich');
const factsRes = await groupRuns(client, rlEn, d, 'facts', pick.flatMap((c) => [factsUnit(d, now, c, byNct), dealsUnit(d, now, c, byNct)]), 10);
const rawFacts = new Map(pick.map((c) => [c.key, factsRes[`${FACTS.key}:${c.key}`]?.content as Facts | undefined]));
const facts = new Map(pick.map((c) => [c.key, rawFacts.get(c.key) ? cleanFacts(c, rawFacts.get(c.key)!, factsRes[`${DEALS.key}:${c.key}`]?.content as Facts | undefined) : undefined]));
const roJobs = pick.flatMap((c) => readoutTrials(c, byNct, facts.get(c.key), now).map((t) => ({ c, t })));
log(d, `pilot: ${roJobs.length} readout runs (core)`);
const roRes = await groupRuns(client, rlEn, d, 'readouts', roJobs.map(({ c, t }) => readoutUnit(d, now, t, c)), 10);
const rlCl = await runLog(d, 'clinicians');
const rolesRes = await groupRuns(client, rlCl, d, 'web-roles', pick.map((c) => rolesUnit(d, c, byNct)), 10);

// ── Score the pass criteria ─────────────────────────────────────────────────
const out: string[] = [`# v1 pilot, ${d.name}, ${now}`, '', `Companies: ${pick.map((c) => c.name).join(', ')}`, ''];
const phaseOk = (p: unknown) => (PHASES as readonly string[]).includes(String(p));
const ownerPhases = Object.values(owners).flatMap((o: any) => (o?.drugs ?? []).map((x: any) => x.phase));
const factPhases = [...facts.values()].map((f) => f?.furthest_along?.phase);
const badPhases = [...ownerPhases, ...factPhases].filter((p) => !phaseOk(p));
out.push(`## 1. Phases are enum values: ${badPhases.length ? 'FAIL' : 'PASS'}`, `${ownerPhases.length} owner drug phases and ${factPhases.length} highest phases; ${badPhases.length} not in the enum${badPhases.length ? `: ${badPhases.join(', ')}` : ''}.`, '');

// Trial links: every item the run tied to a trial, with a check that the trial tests the item's drug.
type Link = { company: string; kind: string; nct: string; text: string; drug: string | null; plausible: boolean };
const links: Link[] = [];
let invented = 0;
const tests = (c: Company, t: Trial, drug: string | null) => {
  if (!drug) return true;
  const hay = [t.title, t.acronym, ...t.interventions.flatMap((x) => [x.name, ...x.other_names])].join(' ').toLowerCase();
  const lower = (x: Company['drugs'][number]) => aliasesOf(x).map((a) => a.toLowerCase());
  const own = c.drugs.find((x) => lower(x).some((a) => drug.toLowerCase().includes(a)));
  const names = own ? lower(own) : [drug.toLowerCase().split(/[ (]/)[0]];
  return names.some((n) => n.length > 2 && hay.includes(n));
};
for (const c of pick) {
  const raw = rawFacts.get(c.key);
  const f = facts.get(c.key);
  invented += [...(raw?.milestones ?? []), ...(raw?.next ?? []), ...(raw?.pivotal ?? [])].filter((x: any) => x.nct && !c.trials.includes(x.nct) && !c.investigator_trials.includes(x.nct)).length;
  const add = (kind: string, nct: string | null | undefined, text: string, drug: string | null) => {
    const t = nct ? byNct.get(nct) : undefined;
    if (t) links.push({ company: c.name, kind, nct: t.nct, text, drug, plausible: tests(c, t, drug) });
  };
  for (const m of f?.milestones ?? []) add('milestone', m.nct, m.headline, m.drug);
  for (const n of f?.next ?? []) add('next', n.nct, n.what, n.drug ?? null);
  for (const p of f?.pivotal ?? []) add('pivotal', p.nct, `pivotal vs ${p.comparator}`, null);
  for (const r of ((rolesRes[`${WEB_ROLES.key}:${c.key}`]?.content as any)?.clinicians ?? []) as any[]) {
    if (r.nct && !c.trials.includes(r.nct) && !c.investigator_trials.includes(r.nct)) invented += 1;
    add('role', r.nct, `${r.role}, ${r.program}`, null);
  }
}
const plausible = links.filter((l) => l.plausible).length;
out.push(`## 2. Trial links (spot check, target 90%): ${links.length ? `${Math.round((100 * plausible) / links.length)}% pass the drug check` : 'no links'}`, `${links.length} items tied to a trial; ${plausible} name a drug that trial tests (or no drug); ${invented} trial IDs outside the company's trials were dropped. Hand check below.`, '');
out.push('| Company | Kind | Trial | Item | Drug check |', '| --- | --- | --- | --- | --- |');
for (const l of links) {
  const t = byNct.get(l.nct)!;
  out.push(`| ${l.company} | ${l.kind} | ${t.acronym || t.nct} (${t.phases.join('/')}) ${t.title.slice(0, 60)} | ${l.text.replace(/\|/g, '/').slice(0, 90)} | ${l.plausible ? 'ok' : 'CHECK'} |`);
}
out.push('');

const reg = (k: string) => facts.get(k)?.regulatory ?? [];
const gsk = reg('gsk');
const alt = reg('altimmune');
const has = (r: { kind: string }[], kind: string) => r.some((x) => x.kind === kind);
const c3 = has(gsk, 'breakthrough') && has(gsk, 'prime') && has(alt, 'breakthrough');
out.push(`## 3. Breakthrough and PRIME under regulatory: ${c3 ? 'PASS' : 'FAIL'}`, `GSK: ${gsk.map((r) => `${r.agency} ${r.kind} (${r.status})`).join(', ') || 'none'}. Altimmune: ${alt.map((r) => `${r.agency} ${r.kind} (${r.status})`).join(', ') || 'none'}.`, '');

const mad = facts.get('madrigal')?.deals ?? [];
const deal = (re: RegExp) => mad.find((x) => re.test(`${x.headline} ${x.parties.join(' ')}`));
const ribo = deal(/ribo/i);
const arrow = deal(/arrowhead/i);
const c4 = Boolean(ribo?.total_m && arrow?.total_m);
out.push(`## 4. Ribo and Arrowhead totals filled: ${c4 ? 'PASS' : 'FAIL'}`, `Ribo: ${ribo ? `${ribo.total ?? 'no total'} (${ribo.total_m ?? '—'}M ${ribo.currency ?? ''})` : 'deal not returned'}. Arrowhead: ${arrow ? `${arrow.total ?? 'no total'} (${arrow.total_m ?? '—'}M ${arrow.currency ?? ''})` : 'deal not returned'}.`, '');

const nexts = pick.flatMap((c) => (facts.get(c.key)?.next ?? []).map((n) => ({ c: c.name, n })));
const passed = nexts.filter(({ n }) => (n.latest ?? n.earliest ?? '9999') < now);
out.push(`## 5. No next step with a passed window: ${passed.length ? 'FAIL' : 'PASS'}`, `${nexts.length} next steps; ${passed.length} passed${passed.length ? `: ${passed.map(({ c, n }) => `${c}: ${n.what} (${n.latest ?? n.earliest})`).join('; ')}` : ''}. ${nexts.filter(({ n }) => !n.earliest && !n.latest).length} have no window, only timing text.`, '');

const ros = roJobs.map(({ c, t }) => ({ c, t, r: roRes[`${READOUT.key}:${t.nct}`]?.content as Readout | undefined }));
const withData = ros.filter((x) => x.r?.has_data);
const numeric = withData.filter((x) => x.r!.arms.some((a) => /\d/.test(a.result)));
out.push(`## 6. Readouts include numbers: ${withData.length && numeric.length === withData.length ? 'PASS' : withData.length ? 'PARTIAL' : 'NO DATA'}`, `${ros.length} trials checked, ${withData.length} reported data, ${numeric.length} with numbers.`, '');
for (const x of withData) out.push(`- ${x.c.name} ${x.t.acronym || x.t.nct}: ${x.r!.date ?? ''} ${x.r!.analysis ?? ''} — ${x.r!.arms.map((a) => `${a.arm}: ${a.result}`).join('; ').slice(0, 220)}`);
out.push('');

// Extra signal for the review: owner fields that are new in v1.
const ownerDrugs = Object.values(owners).flatMap((o: any) => o?.drugs ?? []);
out.push('## Owner v1 fields', `${ownerDrugs.length} drugs: modality on ${ownerDrugs.filter((x: any) => x.modality).length}, targets on ${ownerDrugs.filter((x: any) => x.targets?.length).length}, rights on ${ownerDrugs.filter((x: any) => x.rights?.length).length}. Mechanisms: ${[...new Set(ownerDrugs.map((x: any) => x.mechanism))].join(' · ')}`, '');
out.push('## Specs', `${OWNER.key} · ${FACTS.key} · ${DEALS.key} · ${READOUT.key} · ${WEB_ROLES.key}`);

await store.put(spacePath(d, 'pilot-v1/results.json'), { built: new Date().toISOString(), owners, facts: Object.fromEntries(facts), readouts: Object.fromEntries(ros.map((x) => [x.t.nct, x.r ?? null])), roles: Object.fromEntries(pick.map((c) => [c.key, (rolesRes[`${WEB_ROLES.key}:${c.key}`]?.content as any)?.clinicians ?? []])) });
await store.put(spacePath(d, 'pilot-v1/report.json'), { report: out.join('\n') });
console.log(out.join('\n'));
