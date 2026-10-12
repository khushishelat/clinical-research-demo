// Daily: put trials that are on no company row onto the right one. The build (step 3)
// assigns every trial once; after that, new registrations and newly matching trials
// arrived off the map, so a new Amgen trial never joined Amgen's row or the feed.
//
// - A company-run trial joins the company that already lists its sponsor.
// - A sponsor seen for the first time gets one OWNER run (pro, $0.10, the same unit and
//   run log as step 3): its trials join the owner's row, or a new row for a new company.
// - An investigator-run trial joins the company that owns the drug in its tested arm
//   (lib/assign.ts, the same rules as step 3).
// Existing assignments are never moved, so rows don't reshuffle from day to day.

import type { Company } from '../../../src/lib/space/types';
import { drugOwner, investigatorClaims } from '../assign';
import { companyKey, displayName, isHoldingCompany, ownerFrom, ownerName } from '../companies';
import { log, parallel, runLog, runOnce, spacePath, store, today, type Disease } from '../pipeline';
import type { Trial } from '../registry';
import { ownerUnit } from '../units';

type CompaniesDoc = { disease: string; built: string; companies: Company[]; unassigned_investigator_trials: string[]; shared_trials?: { nct: string; companies: string[] }[]; attached?: { date: string; nct: string; company: string; how: string }[] };

const blank = (key: string, name: string): Company => ({ key, name, relationship: 'independent', owner_source: null, acquisitions: [], registry_sponsors: [], drugs: [], trials: [], investigator_trials: [], web: null, web_only: false, approved: false, max_phase: 0 });

/** With `dry`, logs what would change and writes nothing (no owner runs). */
export async function attachStep(d: Disease, opts: { dry?: boolean } = {}): Promise<{ attached: number; new_sponsors: number }> {
  const doc = await store.get<CompaniesDoc>(spacePath(d, 'companies.json'));
  const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json'))) ?? { trials: [] as Trial[] };
  if (!doc || !trials.length) return { attached: 0, new_sponsors: 0 };
  const companies = doc.companies;
  const placed = () => new Set(companies.flatMap((c) => [...c.trials, ...c.investigator_trials]));
  const loose = trials.filter((t) => !placed().has(t.nct));
  const added: { nct: string; company: string; how: string }[] = [];
  const add = (c: Company, t: Trial, how: string) => {
    (t.run_by === 'company' ? c.trials : c.investigator_trials).push(t.nct);
    c.max_phase = Math.max(c.max_phase, t.phase_level);
    added.push({ nct: t.nct, company: c.key, how });
  };

  // Company-run trials: the sponsor's company, by the sponsor name the row already lists.
  const bySponsor = new Map<string, Company>();
  for (const c of companies) for (const n of [c.name, ...c.registry_sponsors]) if (!bySponsor.has(companyKey(n))) bySponsor.set(companyKey(n), c);
  const unknown = new Map<string, Trial[]>();
  for (const t of loose.filter((x) => x.run_by === 'company')) {
    const c = bySponsor.get(companyKey(t.sponsor));
    if (c) {
      if (!c.registry_sponsors.includes(t.sponsor)) c.registry_sponsors.push(t.sponsor);
      c.web_only = false;
      add(c, t, 'sponsor');
    } else unknown.set(t.sponsor, [...(unknown.get(t.sponsor) ?? []), t]);
  }

  // New sponsors: who owns them, from the same OWNER run step 3 makes.
  if (opts.dry) for (const [sponsor, own] of unknown) log(d, `would run OWNER for new sponsor ${sponsor} (${own.map((t) => t.nct).join(', ')})`);
  const client = unknown.size && !opts.dry ? parallel(d, 'owners of new sponsors') : null;
  if (client) {
    const rl = await runLog(d, 'companies');
    for (const [sponsor, own] of unknown) {
      const u = ownerUnit(d, today(), sponsor, trials);
      const rec = await runOnce(client, rl, u.key, u.spec);
      if (!rec.content) {
        log(d, `owner of new sponsor ${sponsor}: ${rec.status}; its trials stay off the map until the next run`);
        continue;
      }
      const o = ownerFrom(rec.content);
      const byHolding = isHoldingCompany(o.current_owner) && !['acquired', 'merged'].includes(o.relationship);
      const name = (byHolding ? sponsor : ownerName(o.current_owner)) || sponsor;
      let c = bySponsor.get(companyKey(name));
      if (!c) {
        c = { ...blank(companyKey(name), displayName(name)), owner_source: o.owner_source_url };
        companies.push(c);
        bySponsor.set(c.key, c);
      }
      c.registry_sponsors.push(sponsor);
      c.web_only = false;
      for (const drug of o.drugs) if (!c.drugs.some((x) => x.name.toLowerCase() === drug.name.toLowerCase())) c.drugs.push(drug);
      for (const t of own) add(c, t, 'new sponsor');
    }
  }

  // Investigator-run trials: the owner of the drug in the tested arm.
  const ownerOf = drugOwner(companies, trials);
  const claims = investigatorClaims(companies, trials, ownerOf, loose);
  for (const [nct, keys] of claims)
    for (const k of keys) {
      const c = companies.find((x) => x.key === k)!;
      add(c, trials.find((t) => t.nct === nct)!, 'drug');
    }

  if (opts.dry) {
    for (const a of added) log(d, `would attach ${a.nct} → ${companies.find((c) => c.key === a.company)?.name} (by ${a.how}): ${trials.find((t) => t.nct === a.nct)?.title.slice(0, 70)}`);
    return { attached: added.length, new_sponsors: unknown.size };
  }
  if (!added.length) return { attached: 0, new_sponsors: 0 };
  const now = placed();
  doc.unassigned_investigator_trials = trials.filter((t) => t.run_by === 'investigator' && !now.has(t.nct)).map((t) => t.nct);
  doc.attached = [...(doc.attached ?? []), ...added.map((a) => ({ date: today(), ...a }))];
  await store.put(spacePath(d, 'companies.json'), doc);
  const by = added.reduce((m: Record<string, number>, a) => ((m[a.how] = (m[a.how] ?? 0) + 1), m), {});
  log(d, `attached ${added.length} trials to company rows (${Object.entries(by).map(([k, n]) => `${n} by ${k}`).join(', ')})`);
  return { attached: added.length, new_sponsors: unknown.size };
}
