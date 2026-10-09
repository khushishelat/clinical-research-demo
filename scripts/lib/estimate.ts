// What a build will cost, from the registry alone (free), before any run starts.
//
// Every paid step scales with something the registry already shows: sponsors (one owner
// run each), companies (facts, deals and investigator roles, one run each), late-stage
// trials past their readout point, and trials registered in the last 90 days. Given the
// true company count, this reproduces the actual cost of each of the five builds of
// October 2026 to within about 1%. The company count is the one unknown before step 3:
// sponsors resolve to fewer owners and the web adds companies the registry lacks, which
// came to between 1.0 and 1.55 companies per sponsor in those builds. So the estimate is a
// range.

import type { Disease } from './pipeline';
import type { Trial } from './registry';
import { BRIEF, COMPANY_CHAIN, DEALS, FACTS, FIRST_SEEN, MONITOR, OWNER, PROFILE, READOUT, WEB_ROLES } from './specs';

/** Dollars per completed run, by processor (docs.parallel.ai/getting-started/pricing). Failed runs are free. */
export const PRICE: Record<string, number> = { lite: 0.005, base: 0.01, core: 0.025, core2x: 0.05, pro: 0.1, ultra: 0.3, ultra2x: 0.6 };
const COMPANIES_PER_SPONSOR = [1.0, 1.6] as const;
const CHAIN_PAGES = [COMPANY_CHAIN.minPages, COMPANY_CHAIN.maxPages] as const;
const PROFILES = 25;
/** Investigator name checks, the Medicare coverage check and the same-company run: under a dollar in every build. */
const SMALL_JOBS = 0.5;

export type Line = { step: string; runs: [number, number]; processor: string; cost: [number, number] };
export type Estimate = { sponsors: number; companies: [number, number]; readouts: number; recent: number; lines: Line[]; total: [number, number]; monthly: [number, number] };

const line = (step: string, runs: [number, number], processor: string): Line => ({ step, runs, processor, cost: [runs[0] * PRICE[processor], runs[1] * PRICE[processor]] });

/** Trials in scope (as the registry step keeps them) → the runs a first build pays for. */
export function estimate(d: Pick<Disease, 'chain_regions'>, trials: Trial[], today: string): Estimate {
  const company = trials.filter((t) => t.run_by === 'company');
  const sponsors = new Set(company.map((t) => t.sponsor)).size;
  // As readoutTrials (units.ts) picks them before any company is researched.
  const readouts = company.filter((t) => t.phase_level >= 2 && (t.status === 'ACTIVE_NOT_RECRUITING' || (t.primary_completion !== '' && t.primary_completion.slice(0, 7) <= today.slice(0, 7)))).length;
  const since = new Date(Date.parse(today) - 90 * 86_400_000).toISOString().slice(0, 10);
  const recent = company.filter((t) => t.first_posted >= since).length;
  const companies: [number, number] = [Math.round(sponsors * COMPANIES_PER_SPONSOR[0]), Math.round(sponsors * COMPANIES_PER_SPONSOR[1])];
  const regions = d.chain_regions?.length || 1;
  const lines = [
    line('Who owns each sponsor', [sponsors, sponsors], OWNER.processor),
    line('The web’s company list', [CHAIN_PAGES[0] * regions, CHAIN_PAGES[1] * regions], COMPANY_CHAIN.processor),
    line('Clinical facts, one per company', companies, FACTS.processor),
    line('Deals and regulatory, one per company', companies, DEALS.processor),
    line('Investigator roles, one per company', companies, WEB_ROLES.processor),
    line('Readouts, late-stage trials', [readouts, readouts], READOUT.processor),
    line('First disclosed, trials from the last 90 days', [recent, recent], FIRST_SEEN.processor),
    line('Investigator profiles', [PROFILES, PROFILES], PROFILE.processor),
    line('Weekly brief', [1, 1], BRIEF.processor),
  ];
  const total: [number, number] = [lines.reduce((s, l) => s + l.cost[0], SMALL_JOBS), lines.reduce((s, l) => s + l.cost[1], SMALL_JOBS)];
  // Kept current: the weekly brief, the daily news Monitors, and at most one re-check a month
  // for each late-stage trial that has not reported yet.
  const base = (52 / 12) * PRICE[BRIEF.processor] + 30 * (1 + MONITOR.topics.length + MONITOR.companies) * PRICE[MONITOR.processor];
  const monthly: [number, number] = [base, base + readouts * PRICE[READOUT.processor]];
  return { sponsors, companies, readouts, recent, lines, total, monthly };
}

const usd = (n: number) => `$${n.toFixed(2)}`;
const range = ([a, b]: [number, number], f: (n: number) => string = String) => (f(a) === f(b) ? f(a) : `${f(a)}–${f(b)}`);

/** The estimate as a table for the terminal. */
export function formatEstimate(e: Estimate): string {
  const rows = e.lines.map((l) => [l.step, range(l.runs), l.processor, range(l.cost, usd)]);
  const w = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), ['Step', 'Runs', 'Processor', 'Cost'][i].length));
  const fmt = (r: string[]) => r.map((c, i) => (i === 0 || i === 2 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('   ');
  return [
    fmt(['Step', 'Runs', 'Processor', 'Cost']),
    ...rows.map(fmt),
    `${'Small jobs (name checks, coverage, same-company)'.padEnd(w[0] + w[1] + w[2] + 6)}   ${usd(SMALL_JOBS).padStart(w[3])}`,
    '',
    `First build: ${range(e.total, usd)} (${e.sponsors} sponsors → ${range(e.companies)} companies; ${e.readouts} late-stage trials past their readout point; ${e.recent} trials registered in the last 90 days)`,
    `Kept current: ${range(e.monthly, usd)} a month (weekly brief, daily news Monitors, monthly readout re-checks)`,
  ].join('\n');
}
