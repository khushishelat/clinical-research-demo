// Step 2: every active drug trial for a disease, from the ClinicalTrials.gov
// API (free, no key). Writes today's snapshot, the latest copy, and registry
// events (new trials, status and phase changes) from the diff with the last
// snapshot.
//   npx tsx scripts/02-registry.mts --disease mash
//
// Exported as a function so the CLI (scripts/02-registry.mts) and the daily
// cron job run the same code.

import { log, spacePath, store, today, where, type Disease } from '../pipeline';
import { assertNoContacts, diffSnapshots, fetchTrials, isActive, type RegistryEvent, type Trial } from '../registry';

export async function registryStep(d: Disease, date = today()) {
  // An indication can narrow what gets researched (diseases.json `default_scope`):
  // Phase 2 and later only, or only trials whose conditions name the indication.
  const sc = d.default_scope;
  const fetched = await fetchTrials(d);
  const trials = fetched.filter((t) => (!sc?.min_phase || t.phase_level >= sc.min_phase) && (!sc?.conditions_only || t.conditions.some((c) => c.toLowerCase().includes(sc.conditions_only!))));
  if (d.include_completed_since) log(d, `${trials.filter((t) => !isActive(t.status)).length} trials completed or stopped since ${d.include_completed_since} kept alongside ${trials.filter((t) => isActive(t.status)).length} active`);
  if (trials.length !== fetched.length) log(d, `scope: ${trials.length} of ${fetched.length} active trials (${[sc?.min_phase ? `Phase ${sc.min_phase}+` : '', sc?.conditions_only ? `conditions naming "${sc.conditions_only}"` : ''].filter(Boolean).join(', ')})`);
  assertNoContacts('trials', trials);

  const index = (await store.get<{ dates: string[] }>(spacePath(d, 'snapshots/index.json'))) ?? { dates: [] };
  const last = index.dates.filter((x) => x < date).at(-1);
  const prev = last ? await store.get<Trial[]>(spacePath(d, `snapshots/trials-${last}.json`)) : null;
  const fresh: RegistryEvent[] = prev ? diffSnapshots(prev, trials, date) : [];
  const events = (await store.get<RegistryEvent[]>(spacePath(d, 'registry-events.json'))) ?? [];
  const known = new Set(events.map((e) => e.id));
  const merged = [...events, ...fresh.filter((e) => !known.has(e.id))];

  await store.put(spacePath(d, `snapshots/trials-${date}.json`), trials);
  await store.put(spacePath(d, 'snapshots/index.json'), { dates: [...new Set([...index.dates, date])].sort() });
  await store.put(spacePath(d, 'trials.json'), { disease: d.key, fetched: new Date().toISOString(), source: 'ClinicalTrials.gov API v2', scope: sc || d.include_completed_since ? { ...(sc ?? {}), ...(d.include_completed_since ? { completed_since: d.include_completed_since } : {}) } : null, trials });
  await store.put(spacePath(d, 'registry-events.json'), merged);

  const company = trials.filter((t) => t.run_by === 'company');
  const people = new Set(trials.flatMap((t) => t.people.map((p) => p.key)));
  log(d, `${trials.length} drug trials · ${company.length} company-run · ${new Set(company.map((t) => t.sponsor)).size} sponsors`);
  log(d, `${company.filter((t) => t.people.length).length} company trials name an investigator · ${people.size} named investigators`);
  log(d, prev ? `${fresh.length} registry events since ${last}` : 'first snapshot; registry events start tomorrow');
  log(d, `saved to ${where}spaces/${d.key}/`);
}
