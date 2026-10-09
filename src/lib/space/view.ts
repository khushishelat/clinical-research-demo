// View models for the disease map, built on the server from a loaded space.
// Pure: no I/O. Every number on screen is computed here from the pipeline's
// files, never hard-coded.

import type { Space } from './load';
import { dealAboutLabel, isAssetDeal, regulatoryEvent } from './labels';
import type { Company, Deal, Facts } from './types';

export type Scope = 'companies' | 'all';
/** `done`: completed or terminated (kept when the indication includes recent readouts). */
export type Dot = { nct: string; label: string; x: string; kind: 'company' | 'investigator'; phase: number; acquiredFrom: string | null; done: boolean };
/**
 * A dated mark on a company's row. `nct` is the trial it is about, when the research
 * run named one; otherwise `trials` lists the row's trials of the mark's drug.
 */
export type Mark = { date: string; type: string; headline: string; source: string | null; host: string | null; nct: string | null; drug: string | null; detail: string | null; trials: { nct: string; label: string }[] };
export type Row = {
  key: string;
  name: string;
  host: string | null;
  lead: string;
  stage: string;
  approved: boolean;
  mechanisms: string[];
  dots: Dot[];
  news: Mark[];
  next: (Mark & { window: string | null })[];
  trials: number;
  webOnly: boolean;
  acquisitions: { from: string; closed: string | null; source: string }[];
  /** Regulatory designations granted, e.g. "BTD", "PRIME". */
  designations: string[];
};
export type RailClinician = { key: string; name: string; specialty: string | null; place: string; registryRoles: number; webRoles: number; papers: number | null; npi: boolean; initials: string };
export type FeedItem = { id: string; date: string; company: string; companyKey: string; host: string | null; origin: 'registry' | 'web' | 'monitor'; type: string; headline: string; source: string | null; nct?: string; webEarlier?: { days: number; date: string; source: string | null } };

export const hostOf = (url: string | null | undefined): string | null => {
  try {
    return url ? new URL(url).hostname.replace(/^(www|ir|investors?|news|media|newsroom)\./, '') : null;
  } catch {
    return null;
  }
};

/** The company's own web host (for its favicon): the most common host among its sources that isn't a regulator, registry or news site. */
function companyHost(c: Company, f: Facts | undefined): string | null {
  const generic = /(clinicaltrials|fda|ema|gov|europa|nih|pubmed|ncbi|biospace|fiercebiotech|reuters|businesswire|prnewswire|globenewswire|sec\.gov|hkex|endpts|wikipedia|asco|easl|aasld|thelancet|nejm|nature|sciencedirect|springer|wiley|jamanetwork|bloomberg|cnbc|yahoo|marketscreener|evaluate|pharmaceutical-technology|medscape|healio)/;
  const urls = [c.owner_source, c.web?.source, ...(f?.milestones ?? []).map((m) => m.source_url), ...(f?.deals ?? []).map((x) => x.source_url), ...(f?.next ?? []).map((x) => x.source_url)];
  const counts = new Map<string, number>();
  for (const u of urls) {
    const h = hostOf(u);
    if (h && !generic.test(h)) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** One label per drug: merge the ChEMBL and web records of the same molecule, keep the brand when known. */
export function drugLabels(drugs: { name: string; codes?: string[] }[]): string[] {
  const groups: { base: Set<string>; label: string }[] = [];
  for (const d of drugs ?? []) {
    const parts = [d.name, ...(d.name.match(/\(([^)]+)\)/)?.[1].split(/[;,]/) ?? []), ...(d.codes ?? [])].map((x) => x.split('(')[0].trim().toLowerCase()).filter(Boolean);
    const g = groups.find((x) => parts.some((p) => x.base.has(p)));
    const brand = d.name.match(/\(([^)]+)\)/)?.[1];
    const label = brand && /^[A-Z][a-z]/.test(brand) && !/^[A-Z]+-?\d/.test(brand) ? `${brand.split(/[;,]/)[0].trim()} (${d.name.split('(')[0].trim().toLowerCase()})` : d.name.split('(')[0].trim();
    if (g) {
      parts.forEach((p) => g.base.add(p));
      if (label.includes('(') && !g.label.includes('(')) g.label = label;
    } else groups.push({ base: new Set(parts), label });
  }
  return groups.map((g) => g.label);
}

const stageRank = (stage: string) => STAGE.indexOf(stage);
const STAGE = ['Preclinical', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Approved'];
// Short mechanism tags: the targets, then what the drug does to them.
const TARGETS: [RegExp, string][] = [
  [/glucagon-like peptide-1|\bGLP-1R?\b/i, 'GLP-1'],
  [/glucose-dependent insulinotropic|\bGIPR?\b/i, 'GIP'],
  [/\bglucagon\b(?!-like)|\bGCGR\b/i, 'glucagon'],
  [/fibroblast growth factor 21|\bFGF21R?\b/i, 'FGF21'],
  [/thyroid hormone receptor[\s-]*(beta|β)|\bTHR-?β/i, 'THR-β'],
  [/\bpan-PPAR\b/i, 'pan-PPAR'],
  [/peroxisome proliferator-activated receptor|\bPPAR[αγδ]?/i, 'PPAR'],
  [/farnesoid X receptor|\bFXR\b/i, 'FXR'],
  [/\bHSD17B13\b/i, 'HSD17B13'],
  [/\bPNPLA3\b/i, 'PNPLA3'],
  [/\bSLC25A5\b/i, 'SLC25A5'],
  [/\bCIDEB\b/i, 'CIDEB'],
  [/sodium-glucose cotransporter 2|\bSGLT2\b/i, 'SGLT2'],
  [/fatty-acid synthase|\bFASN\b/i, 'FASN'],
  [/\bTL1A\b/i, 'TL1A'],
  [/galectin-3/i, 'galectin-3'],
  [/myeloperoxidase/i, 'MPO'],
  [/\bSSAO\b|VAP-1/i, 'SSAO'],
  [/growth hormone-releasing hormone/i, 'GHRH'],
  [/\bGPR119\b/i, 'GPR119'],
  [/11β-HSD1/i, '11β-HSD1'],
  [/RXRα|retinoid X receptor/i, 'RXRα'],
  [/microRNA/i, 'microRNA'],
  [/alpha-1 antitrypsin/i, 'Z-AAT'],
  [/A3 adenosine/i, 'A3 adenosine'],
  [/glucocorticoid receptor/i, 'glucocorticoid receptor'],
  [/mitochondrial uncoupl/i, 'mitochondrial uncoupler'],
  [/phosphodiesterase/i, 'PDE'],
];
export function shortMechanism(m: string | null | undefined): string | null {
  const text = m ?? '';
  if (!text || /not (publicly|established|disclosed)/i.test(text) && !TARGETS.some(([re]) => re.test(text))) return null;
  const hits = TARGETS.map(([re, label]) => ({ label, at: text.search(re) })).filter((h) => h.at >= 0);
  const labels = [...new Set(hits.sort((a, b) => a.at - b.at).map((h) => h.label))].filter((l, _, all) => !(l === 'PPAR' && all.includes('pan-PPAR')));
  const modality = /siRNA|RNA-interference|RNAi|small interfering RNA/i.test(text) ? 'siRNA' : /antisense/i.test(text) ? 'antisense' : /gene therapy/i.test(text) ? 'gene therapy' : /antibody/i.test(text) ? 'antibody' : null;
  const action = /inhibit/i.test(text) ? 'inhibitor' : /antagonis/i.test(text) ? 'antagonist' : /modulator/i.test(text) ? 'modulator' : /agonist|analog|activat/i.test(text) ? 'agonist' : null;
  if (!labels.length) {
    const phrase = text.split(/[;,.(]/)[0].trim();
    return phrase.split(' ').length <= 4 ? phrase : null;
  }
  const targets = labels.slice(0, 3).join(' / ');
  if (modality) return `${targets} ${modality}`;
  return labels.length === 1 && action ? `${targets} ${action}` : targets;
}

/** "$1.2B", "up to $5.2 billion", "$50M upfront" → dollars. Other currencies count as 0, never as dollars. */
export function dollars(s: string | null | undefined): number {
  const text = s ?? '';
  if (!/\$|\bUSD\b/.test(text) || /€|£|¥|\b(RMB|CNY|EUR|GBP|JPY|KRW)\b/i.test(text)) return 0;
  const m = text.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)\s*(billion|bn|b|million|mn|m)\b/i);
  if (!m) return 0;
  const n = Number(m[1]);
  return /^b/i.test(m[2]) ? n * 1e9 : n * 1e6;
}

const ACTIVE_WINDOW_DAYS = 60;
const ACTIVE = new Set(['RECRUITING', 'NOT_YET_RECRUITING', 'ACTIVE_NOT_RECRUITING', 'ENROLLING_BY_INVITATION']);
export const DEALS_SINCE = '2025-05-01';
const BD = new Set(['license', 'acquisition', 'collaboration', 'option', 'divestiture']);
const firstWord = (x: string) => x.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ')[0];
const sameCompany = (a: string, b: string) => firstWord(a).length > 2 && firstWord(a) === firstWord(b);

/** A deal's headline value in dollars: v1 runs give USD millions; older records are parsed from the stated text. */
export const dealValue = (d: Deal): number => {
  if (d.currency) return d.currency === 'USD' ? (d.total_m ?? d.upfront_m ?? 0) * 1e6 : 0;
  return dollars(d.total) || dollars(d.upfront);
};

/** The upfront payment in dollars, when stated (USD only for v1 records). */
export const dealUpfront = (d: Deal): number => (d.currency ? (d.currency === 'USD' ? (d.upfront_m ?? 0) * 1e6 : 0) : dollars(d.upfront));

/**
 * Licensing, M&A and partnership deals for a drug in this indication, once each:
 * both parties often record the same deal. Portfolio, commercial and research
 * deals (deals@2 `about`) stay on the rows but not in this count.
 */
export function bdDeals(s: Space): Deal[] {
  const out: Deal[] = [];
  for (const f of Object.values(s.facts))
    for (const d of f.deals ?? []) {
      if (!BD.has(d.type) || !isAssetDeal(d.about)) continue;
      const dup = out.find((x) => x.date && d.date && Math.abs(Date.parse(x.date) - Date.parse(d.date)) <= 3 * 86_400_000 && x.parties.filter((p) => d.parties.some((q) => sameCompany(p, q))).length >= 2);
      if (dup) {
        // Keep the record that states a total.
        if (!dealValue(dup) && dealValue(d)) Object.assign(dup, d);
      } else out.push({ ...d, parties: d.parties ?? [] });
    }
  return out;
}

const isDay = (d: string | null | undefined): d is string => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
const present = <T>(x: T | undefined | null): x is T => x != null;

export function mapView(s: Space, scope: Scope, today: string) {
  const trialsBy = new Map(s.trials.map((t) => [t.nct, t]));
  const allDeals = Object.entries(s.facts).flatMap(([owner, f]) => (f.deals ?? []).map((deal) => ({ owner, deal, parties: deal.parties ?? [] })));
  const rows: Row[] = [];
  for (const c of s.companies) {
    if (c.web_only && !s.included.has(c.name)) continue;
    const f = s.facts[c.key];
    const acquired = new Map(c.acquisitions.map((a) => [a.sponsor, a]));
    const dots: Dot[] = [...c.trials, ...c.investigator_trials]
      .map((n) => trialsBy.get(n))
      .filter(present)
      .map((t) => ({ nct: t.nct, label: t.acronym || t.nct, x: t.first_posted, kind: t.run_by, phase: t.phase_level, acquiredFrom: acquired.has(t.sponsor) ? t.sponsor.replace(/,?\s*Inc\.?$/, '') : null, done: !ACTIVE.has(t.status) }));
    // A deal another company recorded with this one as a party, unless this company recorded it too.
    const near = (a: string | null, b: string | null) => Boolean(a && b && Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * 86_400_000);
    const theirs = allDeals.filter((x) => x.owner !== c.key && x.parties.some((p) => sameCompany(p, c.name)) && !(f?.deals ?? []).some((own) => near(own.date, x.deal.date))).map((x) => x.deal);
    // Marks keep the trial ID the research run gave (v1), so a click can open exactly that trial.
    // A drug-level mark lists the row's trials of that drug (registry interventions), so its card can lead into them.
    const trialsOf = (drug: string | null | undefined) => {
      if (!drug) return [];
      const known = c.drugs.find((x) => x.name.toLowerCase() === drug.toLowerCase() || drug.toLowerCase().includes(x.name.split('(')[0].trim().toLowerCase()));
      const names = [drug, ...(known ? [known.name, ...known.codes] : [])].map((x) => x.split('(')[0].trim().toLowerCase()).filter((x) => x.length > 3);
      return dots.filter((d) => {
        const t = trialsBy.get(d.nct)!;
        const text = [t.title, ...t.interventions.flatMap((i) => [i.name, ...i.other_names])].join(' ').toLowerCase();
        return names.some((n) => text.includes(n));
      }).slice(0, 6).map((d) => ({ nct: d.nct, label: d.phase ? `${d.label} · Phase ${d.phase}` : d.label }));
    };
    // A portfolio or commercial deal says so before its terms, so a whole-company price is not read as the asset's.
    const terms = (x: { upfront?: string | null; total?: string | null; about?: string }) => [isAssetDeal(x.about) ? '' : dealAboutLabel(x.about), x.upfront, x.total].filter(Boolean).join(' · ') || null;
    const marks: { date: string | null; type: string; headline: string; source_url: string | null; nct?: string | null; drug?: string | null; detail?: string | null }[] = [
      ...(f?.milestones ?? []),
      ...[...(f?.deals ?? []), ...theirs].map((x) => ({ ...x, type: 'deal', drug: x.drugs?.[0] ?? null, detail: terms(x) })),
      ...(f?.financings ?? []).map((x) => ({ ...x, type: 'financing', drug: null, detail: x.amount })),
      ...(f?.regulatory ?? []).filter((r) => r.status === 'done').map((r) => ({ date: r.date, type: 'regulatory', headline: regulatoryEvent(r.agency, r.kind), source_url: r.source_url, drug: r.drug, detail: null })),
      // News from the indication's daily Monitor, joined to this company by the pipeline.
      ...s.events.filter((e) => e.origin === 'monitor' && e.company === c.key).map((e) => ({ date: e.date, type: e.type, headline: e.headline, source_url: e.source_url, nct: e.nct ?? null, drug: e.drug ?? null, detail: 'From the daily news monitor' })),
    ];
    const news: Mark[] = marks
      .filter((m, i, all) => all.findIndex((x) => x.date === m.date && x.headline === m.headline) === i)
      .flatMap((m) => (isDay(m.date) ? [{ date: m.date, type: m.type, headline: m.headline, source: m.source_url ?? null, host: hostOf(m.source_url), nct: m.nct ?? null, drug: m.drug ?? null, detail: m.detail ?? null, trials: m.nct ? [] : trialsOf(m.drug) }] : []));
    const next = (f?.next ?? []).flatMap((n) => {
      const date = n.earliest ?? n.latest;
      return isDay(date) && date >= today ? [{ date, window: n.timing_text ?? null, type: 'next', headline: n.what, source: n.source_url ?? null, host: hostOf(n.source_url), nct: n.nct ?? null, drug: n.drug ?? null, detail: n.stated_by ? `Stated by ${n.stated_by}` : null, trials: n.nct ? [] : trialsOf(n.drug) }] : [];
    });
    const SHORT: Record<string, string> = { breakthrough: 'BTD', prime: 'PRIME', fast_track: 'Fast Track', orphan: 'Orphan', priority_review: 'Priority review' };
    const designations = [...new Set((f?.regulatory ?? []).filter((r) => r.status === 'done' && SHORT[r.kind]).map((r) => SHORT[r.kind]))];
    const drugs = drugLabels(c.drugs ?? []).slice(0, 2);
    rows.push({
      key: c.key,
      name: c.name,
      host: companyHost(c, f),
      lead: drugs.join(' · '),
      stage: c.approved ? 'Approved' : STAGE[Math.min(c.max_phase, 4)],
      approved: c.approved,
      // v1 drugs carry a short mechanism phrase from the run; older records go through shortMechanism.
      // One tag per mechanism: "CGRP receptor antagonist" and "CGRP-receptor antagonist" are the same.
      mechanisms: [...new Map((c.drugs ?? []).map((x) => (x.phase && x.mechanism.length <= 32 ? x.mechanism : shortMechanism(x.mechanism))).filter(present).map((m) => [m.toLowerCase().replace(/[-\s]+/g, ' '), m] as const)).values()].slice(0, 2),
      dots,
      news,
      next,
      trials: dots.length,
      webOnly: c.web_only,
      acquisitions: c.acquisitions.map((a) => ({ from: a.sponsor, closed: a.closed, source: a.source })),
      designations,
    });
  }
  // Furthest along first; within a stage, registry companies before web-only ones, then by trials.
  rows.sort((a, b) => Number(b.approved) - Number(a.approved) || stageRank(b.stage) - stageRank(a.stage) || Number(a.webOnly) - Number(b.webOnly) || b.trials - a.trials);
  if (scope === 'all' && s.unassigned.length) {
    rows.push({
      key: '_unassigned',
      name: 'Academic and generic trials',
      host: null,
      lead: 'Investigator-sponsored, no company owner',
      stage: '',
      approved: false,
      mechanisms: [],
      dots: s.unassigned.map((n) => trialsBy.get(n)).filter(present).map((t) => ({ nct: t.nct, label: t.acronym || t.nct, x: t.first_posted, kind: 'investigator' as const, phase: t.phase_level, acquiredFrom: null, done: !ACTIVE.has(t.status) })),
      news: [],
      next: [],
      trials: s.unassigned.length,
      webOnly: false,
      acquisitions: [],
      designations: [],
    });
  }
  const onMap = new Set(rows.filter((r) => r.key !== '_unassigned').flatMap((r) => r.dots.map((d) => d.nct)));
  const deals = bdDeals(s).filter((x) => (x.date ?? '') >= DEALS_SINCE);
  const dealDollars = deals.reduce((n: number, x) => n + dealValue(x), 0);
  // The deals behind the headline number, largest first, so the figure can be checked.
  const dealList = deals
    .slice()
    .sort((a, b) => dealValue(b) - dealValue(a) || (b.date ?? '').localeCompare(a.date ?? ''))
    .map((x) => ({ date: x.date, headline: x.headline, parties: x.parties, value: dealValue(x), total: x.total, upfront: x.upfront, source: x.source_url, host: hostOf(x.source_url) }));
  const registryCompanies = s.companies.filter((c) => !c.web_only).length;

  return {
    disease: { key: s.config.key, name: s.config.name, subtitle: s.config.subtitle ?? null, area: s.config.area ?? null },
    updated: s.fetched,
    scope: s.scope,
    stats: {
      trials: s.trials.filter((t) => ACTIVE.has(t.status)).length,
      completed: s.trials.filter((t) => !ACTIVE.has(t.status)).length,
      all: s.trials.length,
      onMap: onMap.size,
      companies: rows.filter((r) => r.key !== '_unassigned').length,
      registryCompanies,
      webCompanies: rows.filter((r) => r.webOnly).length,
      sponsors: new Set(s.trials.filter((t) => t.run_by === 'company').map((t) => t.sponsor)).size,
      investigators: s.clinicians.filter((c) => c.roles.length).length,
      dealDollars,
      dealUpfront: deals.reduce((n: number, x) => n + dealUpfront(x), 0),
      deals: deals.length,
    },
    rows,
    rail: railClinicians(s, 12),
    dealList,
    feed: feedView(s, rows, today),
    pulse: pulseView(s, rows, today),
    monthly: monthlyBars(s, today),
  };
}

export function railClinicians(s: Space, n: number): RailClinician[] {
  return s.clinicians
    .filter((c) => c.us && c.npi)
    .slice(0, n)
    .map((c) => ({
      key: c.key,
      name: c.name,
      specialty: c.npi?.taxonomy ?? c.profile?.specialty ?? null,
      place: [c.npi?.city, c.npi?.state].filter(present).map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(', ').replace(/, (\w\w)$/i, (m) => m.toUpperCase()),
      registryRoles: new Set(c.roles.map((r) => r.nct)).size,
      webRoles: c.web_roles.length,
      papers: c.pubmed?.verified ? c.pubmed.count : null,
      npi: Boolean(c.npi),
      initials: c.name.split(' ').filter(Boolean).map((p: string) => p[0]).slice(0, 2).join('').toUpperCase(),
    }));
}

function feedView(s: Space, rows: Row[], today: string): FeedItem[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const since = new Date(Date.parse(today) - ACTIVE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return s.events
    .filter((e) => e.date >= since && e.date <= today && byKey.has(e.company))
    .slice(0, 40)
    .map((e) => {
      const r = byKey.get(e.company)!;
      const seen = e.nct ? s.firstSeen[e.nct] : undefined;
      return {
        id: e.id,
        date: e.date,
        company: r.name,
        companyKey: r.key,
        host: r.host,
        origin: e.origin,
        type: e.type,
        headline: e.headline,
        source: e.source_url,
        nct: e.nct,
        webEarlier: seen && seen.days_earlier > 0 && seen.first_announced ? { days: seen.days_earlier, date: seen.first_announced, source: seen.source_url } : undefined,
      };
    });
}

/** The last week at a glance, and the last 14 days as daily counts for a sparkline. */
export function pulseView(s: Space, rows: Row[], today: string) {
  const onMap = new Set(rows.map((r) => r.key));
  const day = (n: number) => new Date(Date.parse(today) - n * 86_400_000).toISOString().slice(0, 10);
  const since = day(6);
  const recent = s.events.filter((e) => e.date >= day(13) && e.date <= today && onMap.has(e.company));
  const week = recent.filter((e) => e.date >= since);
  return {
    since,
    registered: week.filter((e) => e.origin === 'registry' && e.type === 'trial_registered').length,
    changes: week.filter((e) => e.origin === 'registry' && e.type !== 'trial_registered').length,
    news: week.filter((e) => e.origin !== 'registry').length,
    days: Array.from({ length: 14 }, (_, i) => {
      const date = day(13 - i);
      const on = recent.filter((e) => e.date === date);
      return { date, registry: on.filter((e) => e.origin === 'registry').length, news: on.filter((e) => e.origin !== 'registry').length };
    }),
  };
}

function monthlyBars(s: Space, today: string) {
  const out: { month: string; count: number }[] = [];
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7);
    out.push({ month: m, count: s.monthly[m]?.all ?? 0 });
  }
  return out;
}

export type MapView = ReturnType<typeof mapView>;
