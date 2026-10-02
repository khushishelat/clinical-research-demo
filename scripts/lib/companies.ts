// Companies: registry sponsors grouped under their current owner, plus
// companies the web finds. Investigator-run trials join the company whose
// drug they test, matched on drug names and codes as whole tokens. Pure.

import type { Company } from '../../src/lib/space/types';
import type { Trial } from './registry';

const LEGAL = /\b(inc|incorporated|ltd|limited|co|corp|corporation|company|plc|ag|sa|se|nv|bv|gmbh|llc|lp|a\/s|kk|pty|pvt|s\.?p\.?a)\b\.?/gi;
// Place names that prefix many Chinese company names ("Guangdong Raynovent Biotech").
const PLACES = ['hk', 'hong', 'kong', 'china', 'beijing', 'shanghai', 'guangdong', 'guangzhou', 'jiangsu', 'zhejiang', 'suzhou', 'shenzhen', 'hangzhou', 'nanjing', 'chengdu', 'sichuan', 'fujian', 'xiamen', 'changchun', 'wuhan', 'tianjin', 'hengqin', 'hainan', 'shandong', 'jilin', 'anhui', 'hubei', 'hunan'];
const DESCRIPTIVE = new Set([...PLACES, 'holdings', 'holding', 'group', 'pharmaceuticals', 'pharmaceutical', 'pharma', 'therapeutics', 'biotherapeutics', 'biotech', 'biotechnology', 'biologics', 'biopharma', 'biopharmaceuticals', 'biosciences', 'bioscience', 'sciences', 'science', 'laboratories', 'labs', 'industrial', 'development', 'international', 'global', 'research', 'and', 'the', 'us', 'usa', 'innovation', 'medicine', 'medical', 'health', 'healthcare', 'bio']);
/** A stable key for a company name: "Novo Nordisk A/S" and "Novo Nordisk" match. */
export function companyKey(name: string): string {
  const all = (name ?? '')
    .replace(/\(.*?\)/g, ' ')
    .replace(LEGAL, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);
  const kept = all.filter((w) => !DESCRIPTIVE.has(w));
  // Never reduce a name to nothing ("Qilu Pharmaceutical", "China Medical").
  const words = kept.length ? kept : all.filter((w) => !PLACES.includes(w)).length ? all.filter((w) => !PLACES.includes(w)) : all;
  const two = words.slice(0, 2).join(' ');
  return two;
}

/** "Novo Nordisk A/S" → "Novo Nordisk"; keeps descriptive words a reader expects. */
export const displayName = (name: string) =>
  name
    .replace(/\s*\((?!.*\b(?:US|UK)\b).*?\)/g, '')
    .replace(/,?\s*&?\s*\b(Inc|Incorporated|Ltd|Limited|Co|Corp|Corporation|plc|AG|SA|SE|NV|GmbH|LLC|A\/S|KK|Pty|Pvt)\b\.?/g, '')
    .replace(/\s*&\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

const norm = (s: string) => ` ${(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
const compact = (s: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// Never match on these: comparators, background therapy, generic words.
const STOP = new Set(['placebo', 'standard of care', 'diet', 'exercise', 'lifestyle', 'metformin', 'insulin', 'vitamin e', 'pioglitazone', 'saline', 'drug', 'injection', 'tablet', 'capsule', 'oral', 'subcutaneous']);

import type { Drug } from '../../src/lib/space/types';

export type { Drug };

/** Aliases worth matching: at least 4 characters, never trial IDs or stop words. */
export function aliasesOf(drug: Drug): string[] {
  const all = [drug.name, ...(drug.codes ?? [])].map((a) => (a ?? '').trim()).filter((a) => a.length >= 4 && !/^NCT\d{8}$/i.test(a) && !STOP.has(a.toLowerCase()));
  return [...new Set(all)];
}

/** Does any of the trial's intervention names or other names contain the alias as whole words (or the same compacted code)? */
export function trialUses(trial: Trial, alias: string): boolean {
  const a = norm(alias);
  const c = compact(alias);
  return trial.interventions.some((iv) => [iv.name, ...iv.other_names].some((n) => norm(n).includes(a) || (c.length >= 5 && /\d/.test(c) && compact(n).includes(c))));
}

export { phaseLabel } from '../../src/lib/space/labels';

/** A phase as older runs wrote it ("Phase 2b", "Approved for NASH in India") → the PHASES enum. */
export function phaseFromText(text: string | null | undefined): string {
  const t = (text ?? '').toLowerCase();
  if (/approved|marketed|launched/.test(t)) return 'approved';
  if (/filed|submitted|nda|bla|marketing application/.test(t)) return 'filed';
  if (/(phase\s*)?(2|ii)[ab]?\s*[/-]\s*(phase\s*)?(3|iii)/.test(t)) return 'phase_2_3';
  if (/phase\s*(3|iii)/.test(t)) return 'phase_3';
  if (/(phase\s*)?(1|i)[ab]?\s*[/-]\s*(phase\s*)?(2|ii)/.test(t)) return 'phase_1_2';
  if (/phase\s*(2|ii)/.test(t)) return 'phase_2';
  if (/phase\s*(1|i)\b/.test(t)) return 'phase_1';
  return 'preclinical';
}

export const isApproved = (phase: string) => /approved|marketed|launch/i.test(phase ?? '');
export const phaseRank = (phase: string) => (isApproved(phase) ? 5 : /filed|submitted|nda|bla|registration/i.test(phase ?? '') ? 4 : /3/.test(phase ?? '') ? 3 : /2/.test(phase ?? '') ? 2 : /1/.test(phase ?? '') ? 1 : 0);

/**
 * Does the trial test the drug, not just compare against it? Uses the arms when
 * the registry has them: the drug must sit in an experimental arm. Trials
 * without arm data fall back to the intervention list.
 */
export function trialTests(trial: Trial, alias: string): boolean {
  if (!trialUses(trial, alias)) return false;
  const arms = trial.arms ?? [];
  if (!arms.length) return true;
  const a = norm(alias);
  const c = compact(alias);
  const inArm = (arm: { interventions: string[] }) => arm.interventions.some((n) => norm(n).includes(a) || (c.length >= 5 && /\d/.test(c) && compact(n).includes(c)));
  const experimental = arms.filter((x) => !/COMPARATOR|SHAM|NO_INTERVENTION/.test(x.type));
  return experimental.some(inArm);
}

/** A financial parent (a foundation or holding company) is not the company on the map. */
export const isHoldingCompany = (name: string) => /\b(holdings?|foundation|fund|investments?|capital|ventures)\b/i.test(name ?? '');

/**
 * Merge rows a same-company run grouped. The row whose key matches the group's
 * usual name keeps its key (else the row with the most trials), so research
 * already run under that key is reused. Returns the merges made.
 */
export function mergeRows(rows: Map<string, Company>, groups: { names: string[]; company: string }[]): { into: string; from: string[] }[] {
  const merges: { into: string; from: string[] }[] = [];
  const byName = (n: string) => [...rows.values()].find((c) => c.name === n || c.registry_sponsors.includes(n));
  for (const g of groups) {
    const members = [...new Set(g.names.map(byName).filter((c): c is Company => Boolean(c)))];
    if (members.length < 2) continue;
    const wanted = companyKey(g.company);
    const into = members.find((c) => c.key === wanted) ?? [...members].sort((a, b) => Number(a.web_only) - Number(b.web_only) || b.trials.length - a.trials.length)[0];
    const from = members.filter((c) => c !== into);
    for (const c of from) {
      into.registry_sponsors.push(...c.registry_sponsors);
      into.trials.push(...c.trials);
      into.investigator_trials.push(...c.investigator_trials);
      into.acquisitions.push(...c.acquisitions);
      for (const drug of c.drugs) if (!into.drugs.some((x) => x.name.toLowerCase() === drug.name.toLowerCase())) into.drugs.push(drug);
      into.owner_source ??= c.owner_source;
      into.web ??= c.web;
      into.web_only = into.web_only && c.web_only;
      rows.delete(c.key);
    }
    if (into.key === wanted) into.name = displayName(g.company);
    merges.push({ into: into.key, from: from.map((c) => c.key) });
  }
  return merges;
}
