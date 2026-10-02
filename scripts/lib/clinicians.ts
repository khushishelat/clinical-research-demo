// Clinicians: named investigators from registry trials, matched to the NPI
// Registry (US only) and PubMed, plus roles the web names. Professional facts
// only: never phone numbers, emails, street addresses, site contacts, or any
// score of a doctor's opinion.

import { again } from './retry';
import type { Clinician } from '../../src/lib/space/types';
import { cleanPersonName, personBase, type Trial } from './registry';

export type { Clinician, Role } from '../../src/lib/space/types';

const HIDDEN_SITE = /investigational site|clinical study site|research site|site\s*\d+|study site/i;
export const cleanName = cleanPersonName;

export function splitName(n: string): { first: string; last: string } {
  const parts = cleanName(n).split(' ').filter((p) => !/^[A-Z]\.?$/.test(p));
  return { first: parts[0] ?? '', last: parts.at(-1) ?? '' };
}

/** Group registry roles into one record per person (name plus state or country). */
export function fromRegistry(trials: Trial[], companyOf: (nct: string) => string | null): Map<string, Clinician> {
  const out = new Map<string, Clinician>();
  for (const t of trials) {
    for (const p of t.people) {
      const c =
        out.get(p.key) ??
        ({ key: p.key, aliases: [], name: cleanName(p.name), ...splitName(p.name), us: false, country: null, city: null, state: null, facilities: [], roles: [], web_roles: [], npi: null, npi_status: 'not_us', pubmed: null, profile: null, sources: ['ClinicalTrials.gov'], score: 0 } as Clinician);
      c.roles.push({ nct: t.nct, role: p.role, sponsor: t.sponsor, company: companyOf(t.nct), facility: p.facility ?? p.affiliation ?? null, city: p.city ?? null, state: p.state ?? null, country: p.country ?? null });
      c.country ??= p.country ?? null;
      c.city ??= p.city ?? null;
      c.state ??= p.state ?? null;
      // Prefer a real site name over "GSK Investigational Site": another sponsor's trial often names it.
      const fac = p.facility ?? p.affiliation;
      if (fac && !c.facilities.includes(fac)) c.facilities.push(fac);
      out.set(p.key, c);
    }
  }
  // An overall official listed without a site has no country. If the registry names one other
  // person by that name, they are the same person; otherwise infer the country from the trial.
  const trialBy = new Map(trials.map((t) => [t.nct, t]));
  for (const c of [...out.values()]) {
    if (c.country) continue;
    const base = c.key.split('|')[0];
    const same = [...out.values()].filter((x) => x !== c && x.country && x.key.split('|')[0] === base);
    if (same.length === 1) {
      const into = same[0];
      into.roles.push(...c.roles);
      for (const f of c.facilities) if (!into.facilities.includes(f)) into.facilities.push(f);
      into.aliases.push(c.key, ...c.aliases);
      out.delete(c.key);
      continue;
    }
    const where = inferPlace(c.facilities.join(' · '), c.roles.map((r) => trialBy.get(r.nct)?.countries ?? []));
    c.country = where.country;
    c.state ??= where.state;
  }
  for (const c of out.values()) {
    c.facilities.sort((a, b) => Number(HIDDEN_SITE.test(a)) - Number(HIDDEN_SITE.test(b)));
    c.us = c.country === 'United States';
    c.npi_status = c.us ? 'none' : 'not_us';
    if (cleanName(c.name).length < 4) c.name = c.name.trim();
  }
  return out;
}

/** Country (and US state) of an affiliation: the trial's only country, else what the text names. */
export function inferPlace(affiliation: string, trialCountries: string[][]): { country: string | null; state: string | null } {
  const names = Object.keys(STATES);
  const byCode = Object.fromEntries(Object.entries(STATES).map(([n, c]) => [c, n]));
  const stateName = names.find((n) => new RegExp(`\\b${n}\\b`).test(affiliation)) ?? byCode[affiliation.match(/\b([A-Z]{2})\s?\d{5}\b/)?.[1] ?? ''] ?? null;
  const us = /\b(USA|U\.S\.A?\.?|United States)\b/.test(affiliation) || Boolean(stateName);
  if (us) return { country: 'United States', state: stateName };
  const only = [...new Set(trialCountries.flat())];
  if (only.length === 1) return { country: only[0], state: null };
  const named = only.find((n) => affiliation.toLowerCase().includes(n.toLowerCase()));
  return { country: named ?? null, state: null };
}

// "Jörn" and "Joern", "José" and "Jose" are the same name.
const fold = (x: string) =>
  x
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
export const sameName = (a: string, b: string) => {
  const x = splitName(a);
  const y = splitName(b);
  return fold(personBase(a)) === fold(personBase(b)) || (fold(x.last) === fold(y.last) && fold(x.first) === fold(y.first));
};

export const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Puerto Rico': 'PR', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A shared pacer: at most `perSecond` calls across all workers. */
export function pacer(perSecond: number) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + Math.ceil(1000 / perSecond);
    if (at > now) await sleep(at - now);
  };
}

export type NpiCandidate = { npi: string; first: string; last: string; credential: string; taxonomy: string; city: string; state: string };

/** NPI Registry API v2.1. Keeps only number, name, credential, primary taxonomy and practice city/state. */
export async function npiSearch(first: string, last: string, state: string | null, pace: () => Promise<void>): Promise<NpiCandidate[]> {
  await pace();
  const p = new URLSearchParams({ version: '2.1', enumeration_type: 'NPI-1', first_name: first, last_name: last, limit: '20', ...(state ? { state } : {}) });
  const res = await again(() => fetch(`https://npiregistry.cms.hhs.gov/api/?${p}`));
  if (!res.ok) return [];
  const body: any = await res.json();
  return (body.results ?? []).map((r: any) => {
    const tax = (r.taxonomies ?? []).find((t: any) => t.primary) ?? r.taxonomies?.[0] ?? {};
    const loc = (r.addresses ?? []).find((a: any) => a.address_purpose === 'LOCATION') ?? {};
    return { npi: String(r.number), first: r.basic?.first_name ?? '', last: r.basic?.last_name ?? '', credential: r.basic?.credential ?? '', taxonomy: tax.desc ?? '', city: loc.city ?? '', state: loc.state ?? '' };
  });
}

/** Narrow NPI candidates in code: exact first name, then a specialty that fits the disease. */
export function narrowNpi(c: Clinician, all: NpiCandidate[], specialties: string[]): { pick: NpiCandidate | null; left: NpiCandidate[]; how: 'npi_api' | 'npi_api_specialty' | null } {
  const exact = all.filter((x) => x.first.toLowerCase() === c.first.toLowerCase() && x.last.toLowerCase() === c.last.toLowerCase());
  const pool = exact.length ? exact : all;
  if (pool.length === 1) return { pick: pool[0], left: pool, how: 'npi_api' };
  const fit = pool.filter((x) => specialties.some((s) => x.taxonomy.toLowerCase().includes(s)));
  if (fit.length === 1) return { pick: fit[0], left: pool, how: 'npi_api_specialty' };
  return { pick: null, left: pool, how: null };
}

/** PubMed E-utilities, no key (3 requests a second). Count, count since 2024, and the 3 most recent papers with this author's affiliations. */
export async function pubmedLookup(c: Clinician, terms: string, pace: () => Promise<void>) {
  const author = `"${c.last}, ${c.first}"[fau]`;
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  const q = async (term: string, retmax: number) => {
    await pace();
    const p = new URLSearchParams({ db: 'pubmed', term, retmode: 'json', retmax: String(retmax), sort: 'pub_date', tool: 'trial-check' });
    const r: any = await again(async () => (await fetch(`${base}/esearch.fcgi?${p}`)).json());
    return { count: Number(r.esearchresult?.count ?? 0), ids: (r.esearchresult?.idlist ?? []) as string[] };
  };
  const all = await q(`${author} AND (${terms})`, 3);
  if (!all.count) return { count: 0, since_2024: 0, recent: [], affiliations: [] as string[] };
  const recent2024 = await q(`${author} AND (${terms}) AND 2024:3000[dp]`, 0);
  await pace();
  const xml = await again(async () => (await fetch(`${base}/efetch.fcgi?${new URLSearchParams({ db: 'pubmed', id: all.ids.join(','), retmode: 'xml', tool: 'trial-check' })}`)).text());
  const recent: { pmid: string; title: string; year: string }[] = [];
  const affiliations: string[] = [];
  for (const art of xml.split('<PubmedArticle>').slice(1)) {
    const pmid = art.match(/<PMID[^>]*>(\d+)<\/PMID>/)?.[1] ?? '';
    const title = (art.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/)?.[1] ?? '').replace(/<[^>]+>/g, '').trim();
    const year = art.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/)?.[1] ?? art.match(/<MedlineDate>(\d{4})/)?.[1] ?? '';
    recent.push({ pmid, title, year });
    for (const au of art.split('<Author ').slice(1)) {
      if (!new RegExp(`<LastName>${c.last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</LastName>`, 'i').test(au)) continue;
      for (const m of au.matchAll(/<Affiliation>([\s\S]*?)<\/Affiliation>/g)) affiliations.push(m[1]);
    }
  }
  return { count: all.count, since_2024: recent2024.count, recent, affiliations };
}

const words = (s: string) => (s ?? '').toLowerCase().match(/[a-z]{4,}/g) ?? [];
const GENERIC = new Set(['university', 'hospital', 'medical', 'center', 'centre', 'health', 'clinic', 'research', 'institute', 'school', 'medicine', 'department', 'college', 'clinical', 'sciences', 'investigational', 'site', 'study', 'llc', 'group']);

/** An affiliation names the person's city or a distinctive word of their institution. */
export function affiliationMatches(c: Clinician, affiliations: string[]): boolean {
  const hay = affiliations.join(' ').toLowerCase();
  if (!hay) return false;
  const cities = [c.city, c.npi?.city].filter(Boolean).map((x) => x!.toLowerCase());
  if (cities.some((x) => hay.includes(x))) return true;
  const inst = c.facilities.flatMap(words).filter((w) => !GENERIC.has(w));
  return inst.some((w) => hay.includes(w));
}
