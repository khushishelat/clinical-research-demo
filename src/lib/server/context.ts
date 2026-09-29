// Server-only. Composition root: validated settings, storage, counters, the
// Parallel client, and the registry source, built once per process. Tests
// replace pieces with setContextForTests().

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import OpenAI from 'openai';
import Parallel from 'parallel-web';
import { findCompanyTrials, lookupTrials } from '../domain/stage1';
import type { CompanyConfig, Pack, RegistryLookup, TrialRow } from '../domain/types';
import type { LiveStatus } from '../domain/freshness';
import { memoryKv, upstashKv, type Kv } from './kv';
import { serverSettings, type ServerSettings } from './settings';
import { blobStore, folderStore, memoryStore, paths, type Store } from './store';

export const appRoot = process.cwd();

export interface RegistrySource {
  /** Today's active trials for a company (stage 1). */
  companyTrials(company: CompanyConfig): Promise<Omit<TrialRow, 'check'>[]>;
  /** Records for specific NCT IDs (trials that left the active search, found trials). */
  lookup(ids: string[]): Promise<Record<string, RegistryLookup>>;
}

export type Context = {
  settings: ServerSettings;
  store: Store;
  kv: Kv;
  registry: RegistrySource;
  /** The official SDK client. Null in fixture mode. */
  parallel: Parallel | null;
  /** OpenAI SDK pointed at Parallel's Responses API, for Ask. Null in fixture mode. */
  responses: OpenAI | null;
  /** Monitor IDs by company key (data/monitors.json, written by scripts/setup-monitors.ts). */
  monitors: Record<string, string>;
  companies: CompanyConfig[];
  now: () => Date;
};

/**
 * Fixture registry: today's statuses are the recorded ones, unless
 * fixtures/registry-overrides.json (or a test) says otherwise.
 */
export function fixtureRegistry(overrides: Record<string, LiveStatus> = {}): RegistrySource {
  return {
    async companyTrials(company) {
      const pack = await readRecordedPack(company.key);
      return (pack?.rows ?? []).map(({ check: _c, ...row }) => ({ ...row, ...(overrides[row.nct_id] ?? {}) }));
    },
    async lookup(ids) {
      const out: Record<string, RegistryLookup> = {};
      for (const id of ids) {
        const o = overrides[id];
        if (o) out[id] = { lead_sponsor: '', lead_sponsor_class: '', collaborators: [], status: o.status, phase: '', acronym: null, title: '', interventions: '' };
      }
      return out;
    },
  };
}

const liveRegistry: RegistrySource = {
  companyTrials: (company) => findCompanyTrials({ company: company.name, match: company.match, advanced: company.advanced }),
  lookup: (ids) => lookupTrials(ids),
};

function loadCompanies(): CompanyConfig[] {
  return JSON.parse(readFileSync(join(appRoot, 'data/companies.json'), 'utf8')) as CompanyConfig[];
}

function loadMonitors(): Record<string, string> {
  try {
    const file = JSON.parse(readFileSync(join(appRoot, 'data/monitors.json'), 'utf8')) as { monitors: { key: string; monitor_id: string }[] };
    return Object.fromEntries(file.monitors.map((m) => [m.key, m.monitor_id]));
  } catch {
    return {};
  }
}

function build(): Context {
  const settings = serverSettings();
  const live = settings.mode === 'live';
  let overrides: Record<string, LiveStatus> = {};
  try {
    overrides = JSON.parse(readFileSync(join(appRoot, 'fixtures/registry-overrides.json'), 'utf8'));
  } catch {
    // no overrides file
  }
  return {
    settings,
    store: settings.blobToken ? blobStore(settings.blobToken) : live ? folderStore(join(appRoot, '.data')) : memoryStore(),
    kv: settings.redisUrl && settings.redisToken ? upstashKv(settings.redisUrl, settings.redisToken) : memoryKv(),
    registry: live ? liveRegistry : fixtureRegistry(overrides),
    parallel: live
      ? new Parallel({ apiKey: settings.parallelApiKey, baseURL: settings.parallelApiBaseUrl, timeout: settings.requestTimeoutMs, maxRetries: 2 })
      : null,
    responses: live ? new OpenAI({ apiKey: settings.parallelApiKey, baseURL: `${settings.parallelApiBaseUrl}/v1`, timeout: settings.requestTimeoutMs }) : null,
    monitors: loadMonitors(),
    companies: loadCompanies(),
    now: () => new Date(),
  };
}

const holder = globalThis as typeof globalThis & { __trialCheckContext?: Context };

export function ctx(): Context {
  holder.__trialCheckContext ??= build();
  return holder.__trialCheckContext;
}

export function setContextForTests(partial: Partial<Context>): Context {
  const base = holder.__trialCheckContext ?? build();
  holder.__trialCheckContext = { ...base, ...partial };
  return holder.__trialCheckContext;
}

export function resetContext(): void {
  delete holder.__trialCheckContext;
}

// ---------- packs ----------

export async function readRecordedPack(key: string): Promise<Pack | null> {
  if (!/^[a-z0-9-]+$/.test(key)) return null;
  try {
    return JSON.parse(await readFile(join(appRoot, 'fixtures/recorded', `${key}.json`), 'utf8')) as Pack;
  } catch {
    return null;
  }
}

/** Latest pack for a company: storage first, then the recorded fixture. */
export async function loadPack(key: string, c: Context = ctx()): Promise<{ pack: Pack; source: 'storage' | 'recorded' } | null> {
  if (!/^[a-z0-9-]+$/.test(key)) return null;
  try {
    const stored = await c.store.get<Pack>(paths.latestPack(key));
    if (stored) return { pack: stored, source: 'storage' };
  } catch {
    // storage unavailable: fall back to the recorded pack
  }
  const recorded = await readRecordedPack(key);
  return recorded ? { pack: recorded, source: 'recorded' } : null;
}

export function companyByKey(key: string, c: Context = ctx()): CompanyConfig | undefined {
  return c.companies.find((co) => co.key === key);
}
