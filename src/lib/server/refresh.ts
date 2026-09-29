// Server-only. Job 1: the weekly re-run of every recorded company, as a cron
// state machine (the datacenter-map-demo pattern). One job blob per ISO week;
// each cron call advances every unfinished company by one step. A full
// refresh takes about 8 to 15 minutes of wall time, spread over several
// 15-minute cron calls, so no single call runs long.

import type { CompanyConfig } from '../domain/types';
import type { Context } from './context';
import { advance, newJob, type JobState } from './pipeline';
import { researchedIndex } from './research';
import { paths } from './store';

export type RefreshJob = { week: string; started_at: string; updated_at: string; companies: Record<string, JobState> };

/** ISO 8601 week, e.g. "2026-W40". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Recorded companies, plus researched ones viewed at least REFRESH_MIN_VIEWS times (up to MAX_REFRESHED_COMPANIES). */
async function companiesToRefresh(c: Context): Promise<CompanyConfig[]> {
  const researched = await researchedIndex(c);
  const viewed: { company: CompanyConfig; views: number }[] = [];
  for (const [key, r] of Object.entries(researched)) {
    const views = Number((await c.kv.get(`views:${key}`)) ?? 0);
    if (views >= c.settings.refreshMinViews) viewed.push({ company: r.company, views });
  }
  viewed.sort((a, b) => b.views - a.views);
  return [...c.companies, ...viewed.slice(0, c.settings.maxRefreshedCompanies).map((v) => v.company)];
}

export async function refreshTick(c: Context): Promise<{ week: string; skipped?: string; companies: Record<string, { phase: string; detail?: string }> }> {
  const now = c.now();
  const week = isoWeek(now);
  if (!c.parallel) return { week, skipped: 'fixture mode', companies: {} };
  if (!(await c.kv.set('lock:refresh', '1', { nx: true, exSeconds: 280 }))) return { week, skipped: 'another refresh call is running', companies: {} };
  try {
    const path = paths.refreshJob(week);
    let job = await c.store.get<RefreshJob>(path);
    if (!job) {
      const list = await companiesToRefresh(c);
      job = {
        week,
        started_at: now.toISOString(),
        updated_at: now.toISOString(),
        companies: Object.fromEntries(list.map((co) => [co.key, newJob(co, 'refresh', now)])),
      };
      await c.store.put(path, job);
    }
    const save = async (s: JobState) => {
      job!.companies[s.key] = s;
      job!.updated_at = c.now().toISOString();
      await c.store.put(path, job);
    };
    const out: Record<string, { phase: string; detail?: string }> = {};
    for (const [key, state] of Object.entries(job.companies)) {
      if (state.phase === 'finalized' || state.phase === 'failed') {
        out[key] = { phase: state.phase };
        continue;
      }
      const step = await advance(state, c, save);
      out[key] = { phase: step.state.phase, detail: step.detail };
    }
    return { week, companies: out };
  } finally {
    await c.kv.del('lock:refresh');
  }
}

/** "Rechecked weekly · next <date>" for the company bar: the next Monday, UTC. */
export function nextRefreshDate(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const add = ((8 - (d.getUTCDay() || 7)) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + add);
  return d.toISOString().slice(0, 10);
}
