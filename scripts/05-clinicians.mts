// Step 5: the clinician layer.
//   a. registry roles (code)            from trials.json
//   b. NPI (US only)                    NPI Registry API; ambiguous names → Task (base, npi_registry)
//   c. PubMed                           E-utilities counts; common names → Task (core, pubmed)
//   d. web roles per company            Task Group (pro, pubmed + npi_registry)
//   e. profiles for the top 25          Task Group (core, npi_registry + pubmed + clinical_trials)
// Professional facts only. Profiles are US-only (NPI-verified).
//   npx tsx scripts/05-clinicians.mts --disease mash

import { affiliationMatches, cleanName, fromRegistry, narrowNpi, npiSearch, pacer, pubmedLookup, sameName, splitName, STATES, type Clinician } from './lib/clinicians';
import { disease, groupRuns, log, parallel, pool, recorder, runLog, saveReplay, spacePath, store, where } from './lib/pipeline';
import { assertNoContacts, personBase, stripAddress, type Trial } from './lib/registry';
import { isRemoved, removedHashes } from './lib/removed';
import { AUTHORSHIP, NPI_PICK, PROFILE, WEB_ROLES } from './lib/specs';
import { ownNct, rolesUnit } from './lib/units';

const d = disease();
const client = parallel(d, 'clinicians');
const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json')))!;
const { companies } = (await store.get<{ companies: any[] }>(spacePath(d, 'companies.json')))!;
const companyByNct = new Map<string, string>();
for (const c of companies) for (const n of [...c.trials, ...c.investigator_trials]) if (!companyByNct.has(n)) companyByNct.set(n, c.name);
const byKey = fromRegistry(trials, (n) => companyByNct.get(n) ?? null);
const rl = await runLog(d, 'clinicians');
log(d, `a. ${byKey.size} named investigators from ${trials.filter((t) => t.people.length).length} trials`);

// d. Web roles per company (first, so web-found US clinicians also get NPI and PubMed).
if (client) {
  // Registry companies with trials, plus web-found companies a person approved.
  const review = (await store.get<{ company: string; include: boolean | null }[]>(spacePath(d, 'review/companies.json'))) ?? [];
  const approved = new Set(review.filter((r) => r.include).map((r) => r.company));
  const targets = companies.filter((c) => (c.web_only ? approved.has(c.name) : c.trials.length + c.investigator_trials.length > 0));
  const byNct = new Map(trials.map((t) => [t.nct, t]));
  const units = targets.map((c) => rolesUnit(d, c, byNct));
  const rec = recorder();
  const res = await groupRuns(client, rl, d, 'web-roles', units, 12, rec);
  await saveReplay(d, 'web-roles', rec);
  let found = 0;
  for (const c of targets) {
    for (const w of ((res[`${WEB_ROLES.key}:${c.key}`]?.content as any)?.clinicians ?? []) as any[]) {
      if (!w.name || !/^https?:/.test(w.source_url ?? '')) continue; // a web role always has a source
      const us = /^(united states|usa|us)$/i.test(w.country ?? '');
      const match = [...byKey.values()].find((x) => sameName(x.name, w.name) && (!w.city || !x.city || x.city.toLowerCase() === w.city.toLowerCase() || x.us === us));
      const role = { role: w.role, program: w.program, nct: ownNct(c, w.nct), company: c.name, date: w.date ?? null, source_url: w.source_url };
      if (match) {
        match.web_roles.push(role);
        if (!match.sources.includes('web')) match.sources.push('web');
      } else {
        const key = `${personBase(cleanName(w.name))}|${(w.city ?? w.country ?? '').toLowerCase()}`;
        const existing = byKey.get(key);
        if (existing) existing.web_roles.push(role);
        else byKey.set(key, { key, aliases: [], name: cleanName(w.name), ...splitName(w.name), us, country: us ? 'United States' : (w.country ?? null), city: w.city ?? null, state: null, facilities: stripAddress(w.institution) ? [stripAddress(w.institution)!] : [], roles: [], web_roles: [role], npi: null, npi_status: us ? 'none' : 'not_us', pubmed: null, profile: null, sources: ['web'], score: 0 });
      }
      found += 1;
    }
  }
  log(d, `d. ${found} web roles across ${targets.length} companies`);
}

const people = [...byKey.values()];
const usPeople = people.filter((c) => c.us);

// Direct lookups are cached per person so re-runs don't repeat thousands of calls.
type Cache = { npi: Record<string, Awaited<ReturnType<typeof npiSearch>>>; pubmed: Record<string, Awaited<ReturnType<typeof pubmedLookup>>> };
const cachePath = spacePath(d, 'cache/lookups.json');
const cache: Cache = (await store.get<Cache>(cachePath)) ?? { npi: {}, pubmed: {} };

// b. NPI: direct API first; only names with several plausible matches go to a Task run.
const npiPace = pacer(5);
const ambiguous: { c: Clinician; left: Awaited<ReturnType<typeof npiSearch>> }[] = [];
await pool(usPeople, 6, async (c) => {
  const code = c.state ? (STATES[c.state] ?? null) : null;
  let all = cache.npi[c.key];
  if (!all) {
    all = await npiSearch(c.first, c.last, code, npiPace);
    if (!all.length && code) all = await npiSearch(c.first, c.last, null, npiPace);
    cache.npi[c.key] = all;
  }
  const { pick, left, how } = narrowNpi(c, all, d.specialties);
  if (pick) {
    c.npi = { number: pick.npi, taxonomy: pick.taxonomy, city: pick.city, state: pick.state, how: how! };
    c.npi_status = 'matched';
  } else if (left.length > 1) {
    c.npi_status = 'ambiguous';
    ambiguous.push({ c, left: left.slice(0, 8) });
  } else c.npi_status = 'none';
});
if (client && ambiguous.length) {
  const res = await groupRuns(
    client,
    rl,
    d,
    'npi-pick',
    ambiguous.map(({ c, left }) => ({ key: `${NPI_PICK.key}:${c.key}`, spec: { processor: NPI_PICK.processor, connectors: NPI_PICK.connectors, schema: NPI_PICK.schema, input: NPI_PICK.input(d, c.name, c.roles.slice(0, 4).map((r) => ({ facility: r.facility, city: r.city, state: r.state })), left.map(({ npi, credential, taxonomy, city, state }) => ({ npi, credential, taxonomy, city, state }))), metadata: { person: c.key.slice(0, 60) } } }))
  );
  for (const { c, left } of ambiguous) {
    const out: any = res[`${NPI_PICK.key}:${c.key}`]?.content;
    const hit = out?.npi && out.confidence !== 'low' ? left.find((x) => x.npi === out.npi) : null;
    if (hit) {
      c.npi = { number: hit.npi, taxonomy: hit.taxonomy, city: hit.city, state: hit.state, how: 'connector' };
      c.npi_status = 'matched';
    }
  }
}
await store.put(cachePath, cache);
const matched = usPeople.filter((c) => c.npi_status === 'matched');
log(d, `b. NPI: ${matched.length} of ${usPeople.length} US clinicians matched (${matched.filter((c) => c.npi?.how === 'connector').length} by the NPI connector, ${ambiguous.length} were ambiguous) · ${people.length - usPeople.length} outside the US get no NPI`);

// c. PubMed: direct counts, kept only when an affiliation confirms the person.
const pmPace = pacer(3);
await pool(matched, 3, async (c) => {
  const r = (cache.pubmed[c.key] ??= await pubmedLookup(c, d.pubmed_terms, pmPace));
  const verified = r.count > 0 && affiliationMatches(c, r.affiliations);
  c.pubmed = { count: r.count, since_2024: r.since_2024, recent: r.recent, verified, how: verified ? 'affiliation' : 'unverified' };
  if (r.count) c.sources.push('PubMed');
});

await store.put(cachePath, cache);

// Rank: trial roles first, web roles next, verified papers break ties.
for (const c of people) c.score = 2 * new Set(c.roles.map((r) => r.nct)).size + 2 * c.web_roles.length + (c.pubmed?.verified ? Math.min(c.pubmed.count, 50) / 100 : 0);
const ranked = people.filter((c) => c.us && c.npi_status === 'matched').sort((a, b) => b.score - a.score);

if (client) {
  // Common names among the top 50: let the PubMed connector check authorship by affiliation.
  const check = ranked.slice(0, 50).filter((c) => c.pubmed && c.pubmed.count > 0 && !c.pubmed.verified);
  const res = await groupRuns(client, rl, d, 'authorship', check.map((c) => ({ key: `${AUTHORSHIP.key}:${c.key}`, spec: { processor: AUTHORSHIP.processor, connectors: AUTHORSHIP.connectors, schema: AUTHORSHIP.schema, input: AUTHORSHIP.input(d, c, d.pubmed_terms), metadata: { person: c.key.slice(0, 60) } } })));
  for (const c of check) {
    const out: any = res[`${AUTHORSHIP.key}:${c.key}`]?.content;
    if (out?.is_same_person && out.verified_count != null) c.pubmed = { count: out.verified_count, since_2024: out.since_2024 ?? 0, recent: out.recent ?? [], verified: true, how: 'connector' };
  }
  // e. Profiles for the 25 shown on screen.
  const top = ranked.slice(0, 25);
  const prof = await groupRuns(client, rl, d, 'profiles', top.map((c) => ({ key: `${PROFILE.key}:${c.key}`, spec: { processor: PROFILE.processor, connectors: PROFILE.connectors, schema: PROFILE.schema, input: PROFILE.input(d, { ...c, npi: c.npi?.number ?? null }), metadata: { person: c.key.slice(0, 60) } } })));
  for (const c of top) c.profile = (prof[`${PROFILE.key}:${c.key}`]?.content as Clinician['profile']) ?? null;
  log(d, `c. PubMed: ${matched.filter((c) => c.pubmed?.verified).length} verified (${check.length} checked by the PubMed connector) · e. ${top.filter((c) => c.profile).length} profiles`);
}

// People who asked to be removed never reach the data.
const removed = removedHashes();
const out = people.filter((c) => !isRemoved(removed, [c.key, ...c.aliases])).sort((a, b) => b.score - a.score);
assertNoContacts('clinicians', out);
await store.put(spacePath(d, 'clinicians.json'), { disease: d.key, built: new Date().toISOString(), rule: 'Registry overall officials (principal investigator, study chair) and site principal investigators; sponsor placeholders removed; one record per name and state or country. Profiles are US-only and NPI-verified. Never contacts or opinions.', clinicians: out });
log(d, `${out.length} clinicians (${usPeople.length} US) · top: ${ranked.slice(0, 3).map((c) => `${c.name} (${c.roles.length} trial roles${c.web_roles.length ? `, ${c.web_roles.length} web` : ''})`).join(' · ')}`);
log(d, `saved to ${where}spaces/${d.key}/clinicians.json`);
