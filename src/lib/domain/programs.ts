// Landscape layout (HANDOFF-v2.1 section 2). Rows attach to snapshot
// programs by the NCT IDs each program cites; a trial may sit under two
// programs. Areas come from a keyword map in code, never from the model.

import type { FoundTrial, Pack, Program, TrialRow } from './types';

const AREAS: [area: string, keywords: string[]][] = [
  ['Lung cancer', ['lung', 'nsclc', 'sclc', 'mesothelioma', 'thoracic']],
  ['GI cancers', ['colorectal', 'crc', 'gastric', 'stomach', 'esophag', 'gastroesophageal', 'biliary', 'cholangio', 'pancrea', 'pdac', 'hepatocellular', 'hcc', 'liver']],
  ['Breast cancer', ['breast', 'tnbc']],
  ['Genitourinary cancers', ['bladder', 'urothelial', 'renal', 'kidney', 'prostate', 'crpc']],
  ['Head and neck cancers', ['head and neck', 'hnscc', 'nasopharyngeal', 'salivary', 'oral cavity']],
  ['Gynecologic cancers', ['ovarian', 'cervical', 'endometrial', 'uterine']],
  ['Blood cancers', ['myeloma', 'lymphoma', 'leukemia', 'leukaemia', 'hematolog']],
  ['Neurology and psychiatry', ['alzheimer', 'depress', 'migraine', 'narcolepsy', 'cataplexy', 'adhd', 'sleep', 'binge', 'agitation', 'fibromyalgia', 'parkinson', 'neurodegener']],
  ['Immunology and dermatology', ['psoriasis', 'dermatitis', 'arthritis', 'lupus', 'colitis', 'crohn', 'asthma']],
  ['Infectious disease', ['infection', 'difficile', 'viral', 'bacterial']],
  ['Other solid tumors', ['solid tumor', 'solid tumour', 'sarcoma', 'melanoma', 'thymic', 'thymus', 'glioblastoma', 'glioma', 'skin', 'squamous cell carcinoma', 'adrenocortical', 'carcinoma', 'cancer', 'tumor']],
];

export type AreaOverrides = Record<string, string>;

export function areaOf(text: string, overrides: AreaOverrides = {}): string {
  const t = text.toLowerCase();
  for (const [needle, area] of Object.entries(overrides)) if (t.includes(needle.toLowerCase())) return area;
  for (const [area, keywords] of AREAS) if (keywords.some((k) => t.includes(k))) return area;
  return 'Other';
}

export const nctIdsIn = (text: string): string[] => text.match(/NCT\d{8}/g) ?? [];

export type ProgramGroup = { program: Program; rows: TrialRow[]; found: FoundTrial[] };
export type InvestigatorSummary = { trials: number; institutions: number; with_news: number; rows: TrialRow[] };
export type AreaGroup = { area: string; programs: ProgramGroup[]; investigator: InvestigatorSummary };
export type Layout = { areas: AreaGroup[]; other: { rows: TrialRow[]; found: FoundTrial[] }; placement: Record<string, number> };

const summarize = (rows: TrialRow[]): InvestigatorSummary => ({
  trials: rows.length,
  institutions: new Set(rows.map((r) => r.lead_sponsor)).size,
  with_news: rows.filter((r) => r.check && r.check.flag !== 'no_news').length,
  rows,
});

export function layoutLandscape(pack: Pack, overrides: AreaOverrides = {}): Layout {
  const programs = pack.snapshot?.programs ?? [];
  const byNct = new Map(pack.rows.map((r) => [r.nct_id, r]));
  const foundByNct = new Map(pack.found_beyond_registry_search.map((f) => [f.nct_id, f]));
  const placement: Record<string, number> = {};
  const place = (id: string) => (placement[id] = (placement[id] ?? 0) + 1);

  const groups: (ProgramGroup & { area: string })[] = programs.map((program) => {
    const ids = [...new Set(program.key_trials.flatMap(nctIdsIn))];
    const rows = ids.map((id) => byNct.get(id)).filter((r): r is TrialRow => Boolean(r) && r!.role !== 'investigator_led');
    const found = ids.map((id) => foundByNct.get(id)).filter((f): f is FoundTrial => Boolean(f));
    rows.forEach((r) => place(r.nct_id));
    found.forEach((f) => place(f.nct_id));
    return { program, rows, found, area: areaOf(`${program.indication} ${program.asset}`, overrides) };
  });

  // Investigator-run rows are summarized per area rather than listed under programs.
  const investigatorByArea = new Map<string, TrialRow[]>();
  for (const r of pack.rows.filter((row) => row.role === 'investigator_led')) {
    const area = areaOf(`${r.condition} ${r.title}`, overrides);
    investigatorByArea.set(area, [...(investigatorByArea.get(area) ?? []), r]);
    place(r.nct_id);
  }

  const areaNames = [...new Set([...groups.map((g) => g.area), ...investigatorByArea.keys()])];
  const areas: AreaGroup[] = areaNames.map((area) => ({
    area,
    programs: groups.filter((g) => g.area === area).map(({ area: _a, ...g }) => g),
    investigator: summarize(investigatorByArea.get(area) ?? []),
  }));

  const other = {
    rows: pack.rows.filter((r) => !placement[r.nct_id]),
    found: pack.found_beyond_registry_search.filter((f) => !placement[f.nct_id]),
  };
  other.rows.forEach((r) => place(r.nct_id));
  other.found.forEach((f) => place(f.nct_id));
  return { areas, other, placement };
}

export type NewsItem = {
  date: string;
  kind: 'trial' | 'program';
  nct_id?: string;
  program: string;
  type: string;
  text: string;
  source_url: string | null;
  flag?: string;
};

/** "What's new": row milestones plus program milestones that have no row, newest first. */
export function whatsNew(pack: Pack, limit = 8): NewsItem[] {
  const items: NewsItem[] = [];
  for (const r of pack.rows) {
    const m = r.check?.latest_milestone;
    if (!m || m.type === 'no_public_update' || !m.date) continue;
    items.push({ date: m.date, kind: 'trial', nct_id: r.nct_id, program: r.check?.program ?? r.title, type: m.type, text: m.description, source_url: m.source_url, flag: r.check?.flag });
  }
  const rowIds = new Set(pack.rows.map((r) => r.nct_id));
  for (const p of pack.snapshot?.programs ?? []) {
    if (!p.latest_milestone_date) continue;
    if (p.key_trials.flatMap(nctIdsIn).some((id) => rowIds.has(id))) continue;
    items.push({ date: p.latest_milestone_date, kind: 'program', program: `${p.asset} · ${p.indication}`, type: p.status, text: p.latest_milestone, source_url: p.source_url });
  }
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit);
}
