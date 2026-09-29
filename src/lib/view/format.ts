// Display helpers. Pure and client-safe.

import type { Milestone, RunBy, TrialRow } from '../domain/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-07-23" → "Jul 23, 2026"; "2026-07" → "Jul 2026"; anything else as is. */
export function fmtDate(d: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!d) return '';
  const m = d.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!m) return d;
  const [, y, mo, day] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!day) return `${month} ${y}`;
  return opts.year === false ? `${month} ${Number(day)}` : `${month} ${Number(day)}, ${y}`;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function monthsSince(date: string, now: Date): number {
  const d = new Date(date);
  return (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
}

const MILESTONE: Record<string, string> = {
  trial_announced: 'Trial announced',
  enrolling: 'Enrolling',
  first_patient_dosed: 'First patient dosed',
  enrollment_completed: 'Enrollment complete',
  interim_data: 'Interim data',
  topline_results: 'Topline results',
  results_presented: 'Results presented',
  results_published: 'Results published',
  regulatory_submission: 'Regulatory submission',
  regulatory_filing_based_on_trial: 'Regulatory filing',
  regulatory_decision: 'Regulatory decision',
  discontinued_or_terminated: 'Discontinued',
  paused_or_on_hold: 'Paused',
  timeline_changed: 'Timeline changed',
  partnership_or_licensing: 'Partnership',
  no_public_update: 'No public update',
  active: 'Active',
  approved: 'Approved',
  discontinued: 'Discontinued',
  deprioritized: 'Deprioritized',
  partnered_or_out_licensed: 'Partnered',
  regulatory_submission_program: 'Filed',
};
export const milestoneLabel = (type: string | null | undefined) => (type ? (MILESTONE[type] ?? type.replace(/_/g, ' ')) : '');

const STATUS: Record<string, string> = {
  RECRUITING: 'Recruiting',
  NOT_YET_RECRUITING: 'Not yet recruiting',
  ACTIVE_NOT_RECRUITING: 'Active, not recruiting',
  ENROLLING_BY_INVITATION: 'Enrolling by invitation',
  SUSPENDED: 'Suspended',
  COMPLETED: 'Completed',
  TERMINATED: 'Terminated',
  WITHDRAWN: 'Withdrawn',
  UNKNOWN: 'Unknown',
};
export const statusLabel = (s: string | null | undefined) => (s ? (STATUS[s] ?? s.replace(/_/g, ' ').toLowerCase()) : '');

export const roleLabel: Record<RunBy, string> = { company_led: 'Company', partner_led: 'Partner', investigator_led: 'Investigator' };

export const phaseShort = (phases: readonly string[] | string) => {
  const list = typeof phases === 'string' ? phases.split('/') : phases;
  const nums = list.map((p) => p.replace(/^PHASE/i, '').replace('EARLY_', 'Early ')).filter(Boolean);
  return nums.length ? `Ph ${nums.join('/')}` : '';
};

/**
 * A short trial name: the registry acronym; "(HARMONi-3)" in the title; the
 * program text's lead-in ("HARMONi-GI3: …", "SEVILLA — …"); a parenthetical
 * in the program ("(Bi-MAPS/IFCT-2403)"); else the NCT ID.
 */
export function trialName(row: Pick<TrialRow, 'title' | 'nct_id'> & { check?: { program?: string | null } | null }, acronym?: string | null): string {
  const ok = (s: string | undefined): s is string =>
    Boolean(s) &&
    s!.length >= 3 &&
    s!.length <= 24 &&
    /[A-Z]/.test(s!) &&
    !/^(NCT\d|phase|ph |no |see |first|second|third|recurrent|metastatic|advanced|oral )/i.test(s!) &&
    // indication or regimen abbreviations (NSCLC, HCC, XELOX, KAT6) and bare asset codes (ARV-471, RMC-6236, AK112)
    !/^[A-Z]{2,5}\d{0,2}$/.test(s!) &&
    !/^[A-Z]{2,4}-?\d{2,5}$/.test(s!) &&
    !/^[A-Z]+-[A-Z]\d+[A-Z]$/.test(s!) &&
    !/\b(directed|degrader|inhibitor|antibody|bispecific)\b/i.test(s!);
  const clean = (s: string) => s.replace(/\s+(Phase \S+\s+)?(trial|study)$/i, '').trim();
  if (acronym && ok(acronym)) return acronym;
  const fromTitle = row.title.match(/\(([A-Z][A-Za-z0-9 -]{2,24})\)/)?.[1];
  if (ok(fromTitle) && /[\d-]|^[A-Z]{3,}/.test(fromTitle)) return fromTitle;
  const program = row.check?.program ?? '';
  // A trial-style code in the program text (KOMET-001, HARMONi-3, CARTITUDE-4) beats a brand name in its lead-in.
  const code = program.match(/\b([A-Z][A-Za-z]{2,}-(?:[A-Z]{1,3})?\d{1,4}[A-Za-z]?)\b/)?.[1];
  const leadRaw = program.match(/^([^:—(]{3,40}?)\s*(?:\([^)]*\))?\s*(?::|—| - )/)?.[1];
  const lead = leadRaw ? clean(leadRaw) : undefined;
  const leadOk = ok(lead) && !/^[a-z]/.test(lead) && !/ (plus|with|and|in|for) /i.test(lead) && !/^Ivonescimab|^[A-Z][a-z]+mab\b/.test(lead);
  if (leadOk && /[\d-]/.test(lead)) return lead;
  if (ok(code) && !/^(Phase|PD|HER|KRAS|NRAS|FLT|NPM|MET|EGFR|ALK|ROS)-/i.test(code)) return code;
  if (leadOk) return lead;
  for (const m of program.matchAll(/\(([^)]+)\)/g)) {
    const first = clean(m[1].split(/[;/,]/)[0]);
    if (ok(first) && /[\d-]|^[A-Z]{3,}/.test(first)) return first;
  }
  return row.nct_id;
}

/** "ivonescimab (SMT112, AK112) plus chemotherapy" → "ivonescimab" */
export const assetBase = (asset: string) => asset.split('(')[0].trim();

export function domainOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\d?\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/** What a source is, from its URL, for the chip label. */
export function sourceType(url: string | null | undefined): string {
  const d = domainOf(url);
  let path = '';
  try {
    path = new URL(url ?? '').pathname.toLowerCase();
  } catch {
    // not a URL
  }
  if (!d) return 'Source';
  if (d.endsWith('sec.gov')) return 'SEC filing';
  if (d.includes('clinicaltrials.gov')) return 'Registry';
  if (d.includes('pubmed') || d.includes('ncbi.nlm.nih.gov')) return 'PubMed';
  if (d.includes('biorxiv') || d.includes('medrxiv')) return 'Preprint';
  if (/hkexnews|sse\.com|szse|asx|lse/.test(d)) return 'Exchange filing';
  if (/prnewswire|globenewswire|businesswire|newswire/.test(d)) return 'Press release';
  if (/(^|\.)ir\.|investors?\.|news|press/.test(d) || /press-release|news-release|\/news\/|\/press\/|media\/.*news/.test(path)) return 'Press release';
  if (/\.pdf$/.test(path) && /ir\.|investor|static-files/.test(d + path)) return 'Company filing';
  if (/cancer\.fr|clinicaltrialsregister|chictr|isrctn|anzctr|jrct/.test(d)) return 'Non-US registry';
  if (/asco|esmo|aacr|wclc|ash|meeting/.test(d)) return 'Conference';
  return 'Web';
}

export const isFlagLoud = (flag: string | undefined) => flag === 'registry_lagging' || flag === 'conflict';

export const milestoneOf = (row: { check?: { latest_milestone?: Milestone | null } | null }) => {
  const m = row.check?.latest_milestone;
  return m && m.type !== 'no_public_update' ? m : null;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
