// Server-only. Reads a disease ("space") built by the pipeline (scripts/) from
// storage: private Vercel Blob when BLOB_READ_WRITE_TOKEN is set, else .data/.
// The repo ships no generated data; a disease appears once its pipeline has run.

import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cache } from 'react';
import { blobStore, folderStore, type Store } from '../store';
import type { Basis, Brief, Clinician, Company, CompanyReview, Coverage, EventsDoc, Facts, FirstSeen, Trial } from './types';

export type DiseaseConfig = { key: string; name: string; subtitle?: string; query_cond: string; specialties: string[]; default_scope?: { min_phase?: number; top_companies?: number; conditions_only?: string } };

let _store: Store | null = null;
export const appStore = (): Store => (_store ??= process.env.BLOB_READ_WRITE_TOKEN ? blobStore(process.env.BLOB_READ_WRITE_TOKEN) : folderStore(join(process.cwd(), '.data')));

export const diseaseConfig = cache((): { diseases: DiseaseConfig[]; default: string } => JSON.parse(readFileSync(join(process.cwd(), 'scripts/diseases.json'), 'utf8')));

const doc = <T>(key: string, file: string) => appStore().get<T>(`spaces/${key}/${file}`);

export type Space = {
  config: DiseaseConfig;
  fetched: string;
  trials: Trial[];
  companies: Company[];
  unassigned: string[];
  /** Web-found companies a person approved in review/companies.json. */
  included: Set<string>;
  facts: Record<string, Facts>;
  events: EventsDoc['events'];
  catalysts: EventsDoc['catalysts'];
  monthly: EventsDoc['monthly'];
  clinicians: Clinician[];
  coverage: Coverage[];
  firstSeen: Record<string, FirstSeen>;
  briefs: string[];
};

async function loadSpaceRaw(key: string): Promise<Space | null> {
  const config = diseaseConfig().diseases.find((d) => d.key === key);
  if (!config) return null;
  const trialsDoc = await doc<{ fetched: string; trials: Trial[] }>(key, 'trials.json');
  if (!trialsDoc) return null;
  const [companies, facts, events, clinicians, coverage, firstSeen, briefs, review] = await Promise.all([
    doc<{ companies: Company[]; unassigned_investigator_trials: string[] }>(key, 'companies.json'),
    doc<{ facts: Record<string, Facts> }>(key, 'facts.json'),
    doc<EventsDoc>(key, 'events.json'),
    doc<{ clinicians: Clinician[] }>(key, 'clinicians.json'),
    doc<{ determinations: Coverage[] }>(key, 'coverage.json'),
    doc<Record<string, FirstSeen>>(key, 'first-seen.json'),
    doc<{ issues: string[] }>(key, 'briefs/index.json'),
    doc<CompanyReview[]>(key, 'review/companies.json'),
  ]);
  return {
    config,
    fetched: trialsDoc.fetched,
    trials: trialsDoc.trials,
    companies: companies?.companies ?? [],
    unassigned: companies?.unassigned_investigator_trials ?? [],
    included: new Set((review ?? []).filter((r) => r.include).map((r) => r.company)),
    facts: facts?.facts ?? {},
    events: events?.events ?? [],
    catalysts: events?.catalysts ?? [],
    monthly: events?.monthly ?? {},
    clinicians: (clinicians?.clinicians ?? []).map((c) => ({ ...c, aliases: c.aliases ?? [] })),
    coverage: coverage?.determinations ?? [],
    firstSeen: firstSeen ?? {},
    briefs: briefs?.issues ?? [],
  };
}

/** One load per request, shared by layout, page and route handlers. */
export const loadSpace = cache(loadSpaceRaw);

/** Diseases with built data, with their sizes, for the picker. */
export const builtDiseases = cache(async () => {
  const out: { key: string; name: string; trials: number; companies: number; clinicians: number }[] = [];
  for (const d of diseaseConfig().diseases) {
    const s = await loadSpace(d.key);
    if (s) out.push({ key: d.key, name: d.name, trials: s.trials.length, companies: s.companies.length, clinicians: s.clinicians.length });
  }
  return out;
});

export const basisFor = (key: string, company: string) => doc<{ company: string; run_id: string; basis: Basis[] }>(key, `basis/${company}.json`);
export const briefFor = (key: string, date: string) => doc<Brief>(key, `briefs/${date}.json`);
export const replayFor = (key: string, job: string) => doc<{ job: string; started: string; duration_s: number; events: unknown[] }>(key, `replay/${job}.json`);
