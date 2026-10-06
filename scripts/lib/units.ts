// The units of work for the per-company and per-trial Task runs, built in one
// place so the pipeline steps and the pilot make identical runs under the same
// keys (a pilot run is reused by the next build, never billed twice).

import type { Company, Facts, Trial } from '../../src/lib/space/types';
import type { Disease, RunSpec } from './pipeline';
import { DEALS, FACTS, OWNER, READOUT, WEB_ROLES } from './specs';

export type Unit = { key: string; spec: RunSpec };
const present = <T>(x: T | undefined | null): x is T => x != null;

/** The registry trials on a company's row: its own, then investigator-sponsored trials of its drugs. */
export const registryOf = (c: Company, byNct: Map<string, Trial>, own = false) => (own ? c.trials : [...c.trials, ...c.investigator_trials]).map((n) => byNct.get(n)).filter(present);

export const ownerUnit = (d: Disease, today: string, sponsor: string, trials: Trial[]): Unit => ({
  key: `${OWNER.key}:${sponsor}`,
  spec: {
    processor: OWNER.processor,
    connectors: OWNER.connectors,
    schema: OWNER.schema,
    input: OWNER.input(d, sponsor, today, trials.filter((t) => t.sponsor === sponsor).map((t) => ({ nct: t.nct, title: t.title, interventions: t.interventions.map((i) => i.name), phase: t.phases.join('/') }))),
    metadata: { job: 'owner', disease: d.key },
  },
});

const registryRows = (c: Company, byNct: Map<string, Trial>) => registryOf(c, byNct).map((t) => ({ nct: t.nct, acronym: t.acronym, title: t.title, phase: t.phases.join('/'), status: t.status, sponsor: t.sponsor }));

export const factsUnit = (d: Disease, today: string, c: Company, byNct: Map<string, Trial>): Unit => ({
  key: `${FACTS.key}:${c.key}`,
  spec: { processor: FACTS.processor, connectors: FACTS.connectors, schema: FACTS.schema, input: FACTS.input(d, today, c, registryRows(c, byNct)), metadata: { company: c.key } },
});

export const dealsUnit = (d: Disease, today: string, c: Company, byNct: Map<string, Trial>): Unit => ({
  key: `${DEALS.key}:${c.key}`,
  spec: { processor: DEALS.processor, schema: DEALS.schema, input: DEALS.input(d, today, c, registryRows(c, byNct)), metadata: { company: c.key } },
});

/**
 * Company trials worth a READOUT run: Phase 2 or later, and past primary
 * completion, closed to enrollment, or named by a data milestone.
 */
export function readoutTrials(c: Company, byNct: Map<string, Trial>, f: Facts | undefined, today: string): Trial[] {
  const withData = new Set((f?.milestones ?? []).filter((m) => m.type === 'data' && m.nct).map((m) => m.nct));
  return registryOf(c, byNct, true).filter((t) => t.phase_level >= 2 && (withData.has(t.nct) || t.status === 'ACTIVE_NOT_RECRUITING' || (t.primary_completion !== '' && t.primary_completion.slice(0, 7) <= today.slice(0, 7))));
}

export const readoutUnit = (d: Disease, today: string, t: Trial, c: Company): Unit => ({
  key: `${READOUT.key}:${t.nct}`,
  spec: {
    processor: READOUT.processor,
    connectors: READOUT.connectors,
    schema: READOUT.schema,
    input: READOUT.input(d, today, { nct: t.nct, acronym: t.acronym, title: t.title, phase: t.phases.join('/'), status: t.status, primary_completion: t.primary_completion }, c.name, c.drugs.map((x) => x.name).slice(0, 6)),
    metadata: { nct: t.nct, company: c.key },
  },
});

export const rolesUnit = (d: Disease, c: Company, byNct: Map<string, Trial>): Unit => ({
  key: `${WEB_ROLES.key}:${c.key}`,
  spec: {
    processor: WEB_ROLES.processor,
    connectors: WEB_ROLES.connectors,
    schema: WEB_ROLES.schema,
    input: WEB_ROLES.input(d, c.name, c.drugs.map((x) => x.name).slice(0, 6), registryOf(c, byNct).map((t) => ({ nct: t.nct, acronym: t.acronym }))),
    metadata: { company: c.key },
  },
});

/** Keep a returned trial ID only if it is one of the company's registry trials. */
export const ownNct = (c: Company, nct: string | null | undefined) => (nct && (c.trials.includes(nct) || c.investigator_trials.includes(nct)) ? nct : null);

/** Facts as stored: the clinical and deal runs merged, and trial IDs a run invented set to null, so a join can only land on a real trial. */
export function cleanFacts(c: Company, f: Facts, deals?: Pick<Facts, 'deals' | 'financings' | 'regulatory'>): Facts {
  if (deals) f = { ...f, deals: deals.deals ?? [], financings: deals.financings ?? [], regulatory: deals.regulatory ?? [] };
  const keep = <T extends { nct?: string | null }>(xs: T[] | undefined) => (xs ?? []).map((x) => ({ ...x, nct: ownNct(c, x.nct) }));
  return { ...f, milestones: keep(f.milestones), next: keep(f.next), pivotal: keep(f.pivotal) };
}
