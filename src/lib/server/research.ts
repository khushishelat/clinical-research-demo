// Server-only. Job 3: public research requests. No pay gate: anyone can ask
// for a company, and the result is shared with every viewer. Server-side
// caps (per-IP, daily budget, per-run cost) protect our key; viewers never
// see a price.

import type { CompanyConfig, TrialRow } from '../domain/types';
import { companyByKey, type Context } from './context';
import { allowRequest } from './guards';
import { advance, newJob, type JobState } from './pipeline';
import { paths } from './store';

/** More than this many active trials needs narrowing first (HANDOFF-v2.1 section 7). */
export const NARROW_ABOVE = 60;
const ACTIVE_TTL = 3 * 60 * 60;
const OPEN_INDEX = 'requests/open.json';
const RESEARCHED_INDEX = 'index/researched.json';

export type Researched = Record<string, { company: CompanyConfig; recorded: string }>;

const SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'plc', 'co', 'corp', 'corporation', 'company', 'sa', 'ag', 'nv', 'se', 'gmbh', 'kk', 'holdings', 'group',
  'therapeutics', 'pharmaceuticals', 'pharmaceutical', 'pharma', 'biosciences', 'bioscience', 'biotherapeutics', 'biotech', 'biotechnology', 'bio', 'biopharma', 'medicines', 'oncology',
]);

/** "Revolution Medicines, Inc." → key "revolution-medicines", match "revolution". */
export function companyFromName(name: string): CompanyConfig {
  const clean = name.replace(/[^\p{L}\p{N}\s&.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = clean.toLowerCase().replace(/\./g, '').split(' ').filter(Boolean);
  const core = words.filter((w, i) => i === 0 || !SUFFIXES.has(w));
  while (core.length > 1 && ['and', '&', 'of', 'the'].includes(core.at(-1)!)) core.pop();
  const key = words.join('-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').slice(0, 60) || 'company';
  return { key, name: clean, match: core.join(' '), aliases: [], lead_asset: '' };
}

export async function researchedIndex(c: Context): Promise<Researched> {
  try {
    return (await c.store.get<Researched>(RESEARCHED_INDEX)) ?? {};
  } catch {
    return {};
  }
}

/** A recorded company, a previously researched one, or a new config from the name. */
export async function resolveCompany(c: Context, input: { key?: string; name?: string }): Promise<CompanyConfig | null> {
  if (input.key) {
    const known = companyByKey(input.key, c) ?? (await researchedIndex(c))[input.key]?.company;
    if (known) return known;
  }
  if (input.name && input.name.trim().length >= 2) {
    const fromName = companyFromName(input.name.slice(0, 120));
    return companyByKey(fromName.key, c) ?? (await researchedIndex(c))[fromName.key]?.company ?? fromName;
  }
  return null;
}

export type ResearchResponse =
  | { status: 'started' | 'joined'; key: string; taskgroup_id: string; trials: number; checked: number; estimated_minutes: number }
  | { status: 'narrow'; key: string; trials: number; stage1: Omit<TrialRow, 'check'>[] }
  | { status: 'queued'; key: string; message: string }
  | { status: 'limited' | 'unavailable' | 'failed'; key?: string; message: string };

export async function requestResearch(
  c: Context,
  body: { key?: string; name?: string; only_nct_ids?: string[] },
  client: string
): Promise<ResearchResponse> {
  if (!c.parallel) return { status: 'unavailable', message: 'Live research is off in this deployment. Recorded companies still open instantly.' };
  const company = await resolveCompany(c, body);
  if (!company) return { status: 'failed', message: 'Enter a company name.' };

  const active = await c.kv.get(`active:${company.key}`);
  if (active) return { status: 'joined', key: company.key, taskgroup_id: active, trials: 0, checked: 0, estimated_minutes: 10 };

  const stage1 = await c.registry.companyTrials(company);
  const only = body.only_nct_ids?.filter((id) => /^NCT\d{8}$/.test(id) && stage1.some((r) => r.nct_id === id));
  if (!stage1.length) return { status: 'failed', key: company.key, message: `No active trials on ClinicalTrials.gov list ${company.name} as sponsor or collaborator. Try the drug name or another spelling.` };
  if (stage1.length > NARROW_ABOVE && !only?.length) return { status: 'narrow', key: company.key, trials: stage1.length, stage1 };

  if (!(await allowRequest(c.kv, 'research', client, c.settings.perIpPerDay.research, c.now()))) {
    return { status: 'limited', key: company.key, message: 'You have started the most research runs allowed today. Recorded companies still open instantly.' };
  }
  // Only one run per company at a time; a second viewer joins the first.
  if (!(await c.kv.set(`lock:req:${company.key}`, '1', { nx: true, exSeconds: 120 }))) {
    return { status: 'joined', key: company.key, taskgroup_id: (await c.kv.get(`active:${company.key}`)) ?? '', trials: stage1.length, checked: 0, estimated_minutes: 10 };
  }
  try {
    const job = newJob(company, 'research', c.now(), only);
    job.stage1 = stage1;
    const save = saver(c);
    const step = await advance(job, c, save);
    if (step.status === 'queued') {
      await addOpen(c, company.key);
      return { status: 'queued', key: company.key, message: "We'll research this within a day. The link will show it when it's ready." };
    }
    if (!job.taskgroup_id) return { status: 'failed', key: company.key, message: job.error ?? 'Could not start research.' };
    await c.kv.set(`active:${company.key}`, job.taskgroup_id, { exSeconds: ACTIVE_TTL });
    await addOpen(c, company.key);
    const checked = (only ?? stage1).length;
    return { status: 'started', key: company.key, taskgroup_id: job.taskgroup_id, trials: stage1.length, checked, estimated_minutes: estimateMinutes(checked) };
  } finally {
    await c.kv.del(`lock:req:${company.key}`);
  }
}

/** Snapshot (ultra) sets the floor; checks run in parallel. From the Sep 28 run: 7 to 10 minutes. */
export const estimateMinutes = (checked: number) => Math.min(20, 8 + Math.ceil(checked / 40));

const saver = (c: Context) => (s: JobState) => c.store.put(paths.request(s.key), s);

async function addOpen(c: Context, key: string) {
  const open = new Set((await c.store.get<string[]>(OPEN_INDEX)) ?? []);
  open.add(key);
  await c.store.put(OPEN_INDEX, [...open]);
}

async function removeOpen(c: Context, key: string) {
  const open = new Set((await c.store.get<string[]>(OPEN_INDEX)) ?? []);
  if (open.delete(key)) await c.store.put(OPEN_INDEX, [...open]);
}

export async function requestState(c: Context, key: string): Promise<JobState | null> {
  if (!/^[a-z0-9-]+$/.test(key)) return null;
  return c.store.get<JobState>(paths.request(key));
}

/**
 * One step for one request. Called by the stream route when the snapshot or
 * the group finishes, and by the follow-ups cron as a sweep. Locked, so
 * concurrent callers never double-add or double-write.
 */
export async function advanceRequest(c: Context, key: string): Promise<JobState | null> {
  const lock = `lock:adv:${key}`;
  if (!(await c.kv.set(lock, '1', { nx: true, exSeconds: 240 }))) return null;
  try {
    const job = await requestState(c, key);
    if (!job || job.phase === 'finalized' || job.phase === 'failed') return job;
    const step = await advance(job, c, saver(c));
    if (step.status === 'finalized' || step.status === 'failed') {
      await c.kv.del(`active:${key}`);
      await removeOpen(c, key);
      if (step.status === 'finalized' && !companyByKey(key, c)) {
        const index = await researchedIndex(c);
        index[key] = { company: job.company, recorded: job.finalized_at!.slice(0, 10) };
        await c.store.put(RESEARCHED_INDEX, index);
      }
    }
    return job;
  } finally {
    await c.kv.del(lock);
  }
}

/** Advances every open request once (cron). Queued requests retry when the budget resets. */
export async function sweepRequests(c: Context): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of (await c.store.get<string[]>(OPEN_INDEX)) ?? []) {
    const job = await advanceRequest(c, key);
    out[key] = job?.phase ?? 'busy';
  }
  return out;
}

/** Views of researched (non-recorded) companies, for the weekly-refresh cut. Fixed 30-day windows. */
export async function countView(c: Context, key: string): Promise<void> {
  if (companyByKey(key, c)) return;
  await c.kv.incrByFloat(`views:${key}`, 1, 30 * 24 * 60 * 60);
}
