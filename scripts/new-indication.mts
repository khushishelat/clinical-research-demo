// Step 1: propose a new indication. A free ClinicalTrials.gov preview of the name, one
// scoping Task run (SCOPE, core, about $0.03), then the size decisions in code, and an
// estimate of what the build will cost. Writes the entry to scripts/diseases.json for a
// person to review; builds nothing.
//   npm run new-indication -- "Pancreatic cancer"
//   npm run new-indication -- "Pancreatic cancer" --key pancreatic --print   (write nothing)

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimate, formatEstimate } from './lib/estimate';
import { flag, parallel, runLog, runOnce, today, type Disease } from './lib/pipeline';
import { fetchTrials, inScope, isActive, type Trial } from './lib/registry';
import { SCOPE } from './lib/specs';

const FILE = join(process.cwd(), 'scripts/diseases.json');
/** Above this many active drug trials, the build keeps Phase 2 and later only. */
const LARGE_TRIALS = 400;
/** From this many company sponsors, the web's company list is built once per region. */
const LARGE_SPONSORS = 80;
const REGIONS = ['the United States or Europe', 'China', 'Japan, South Korea or elsewhere in Asia-Pacific', 'the rest of the world'];
/** Trials finished since January two years back stay on the map: recent readouts are much of the picture. */
const COMPLETED_SINCE = `${Number(today().slice(0, 4)) - 2}-01-01`;

const arg = (n: string) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : undefined);
const typed = process.argv[2];
if (!typed || typed.startsWith('--')) {
  console.error('Usage: npm run new-indication -- "<indication name>" [--key <key>] [--print]');
  process.exit(1);
}
const config = JSON.parse(readFileSync(FILE, 'utf8')) as { diseases: Disease[]; exclude: string[] };
if (config.exclude.some((e) => typed.toLowerCase().includes(e))) throw new Error(`${typed} is on the exclude list in scripts/diseases.json.`);
const key = arg('key') ?? typed.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
if (config.diseases.some((d) => d.key === key) && !flag('print')) throw new Error(`"${key}" is already in scripts/diseases.json. Pass --key to choose another, or --print to only show a proposal.`);
const probe = { key, name: typed, query_cond: typed, pubmed_terms: typed, specialties: [], include_completed_since: COMPLETED_SINCE } as Disease;

// 1. What ClinicalTrials.gov returns for the name, free: drug trials and the condition terms they list.
const found = await fetchTrials(probe);
const active = found.filter((t) => isActive(t.status));
const terms = new Map<string, number>();
for (const t of active) for (const c of new Set(t.conditions.map((x) => x.toLowerCase().trim()))) terms.set(c, (terms.get(c) ?? 0) + 1);
const sponsorCounts = (ts: Trial[]) => [...ts.filter((t) => t.run_by === 'company').reduce((m, t) => m.set(t.sponsor, (m.get(t.sponsor) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const preview = {
  search: typed,
  active_drug_trials: active.length,
  completed_since: { date: COMPLETED_SINCE, trials: found.length - active.length },
  registry_conditions: [...terms].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([term, trials]) => ({ term, trials })),
  top_company_sponsors: sponsorCounts(active).slice(0, 12).map(([sponsor, trials]) => ({ sponsor, trials })),
};
console.log(`[${key}] ClinicalTrials.gov: ${active.length} active drug trials for "${typed}", ${preview.completed_since.trials} finished since ${COMPLETED_SINCE}`);
console.log(`  conditions they list: ${preview.registry_conditions.slice(0, 10).map((x) => `${x.term} (${x.trials})`).join(', ')}`);
if (!active.length) throw new Error(`No active drug trials for "${typed}". Try the name trials use, e.g. "nonalcoholic steatohepatitis".`);

// 2. One scoping run proposes the terms, the condition filter and the labels.
const client = parallel(probe, 'scope');
if (!client) process.exit(1);
const rl = await runLog(probe, 'scope');
const rec = await runOnce(client, rl, `${SCOPE.key}:${key}`, { processor: SCOPE.processor, connectors: SCOPE.connectors, schema: SCOPE.schema, input: SCOPE.input(typed, preview), metadata: { job: 'scope', disease: key } });
if (!rec.content) throw new Error(`Scoping run ${rec.run_id} ${rec.status}; run this again for one fresh try.`);
const c = rec.content as { name: string; subtitle: string; area: string; registry_terms: string[]; conditions_only: string | null; pubmed_terms: string[]; specialties: string[] };

const quote = (t: string) => (/[\s'-]/.test(t) ? `"${t.replace(/"/g, '')}"` : t);
const uniq = (xs: string[]) => [...new Map(xs.map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), x])).values()];
const entry: Disease = {
  key,
  name: c.name,
  subtitle: c.subtitle,
  area: c.area,
  query_cond: uniq(c.registry_terms).map(quote).join(' OR '),
  pubmed_terms: uniq(c.pubmed_terms).map(quote).join(' OR '),
  specialties: uniq(c.specialties.map((s) => s.toLowerCase())),
  include_completed_since: COMPLETED_SINCE,
  ...(c.conditions_only ? { default_scope: { conditions_only: c.conditions_only.toLowerCase().trim() } } : {}),
  monitor: true,
};

// 3. Size decisions in code, from the registry with the proposed terms.
const all = await fetchTrials(entry);
let kept = all.filter(inScope(entry));
const notes: string[] = [];
if (entry.default_scope?.conditions_only) notes.push(`condition filter "${entry.default_scope.conditions_only}" keeps ${kept.length} of ${all.length} trials${kept.length < all.length / 2 ? ': most are dropped, so check against the conditions listed above' : ''}`);
if (kept.filter((t) => isActive(t.status)).length > LARGE_TRIALS) {
  entry.default_scope = { ...entry.default_scope, min_phase: 2 };
  const before = kept.length;
  kept = kept.filter(inScope(entry));
  notes.push(`over ${LARGE_TRIALS} active trials, so Phase 2 and later only: ${kept.length} of ${before} trials`);
}
const sponsors = sponsorCounts(kept).length;
if (sponsors >= LARGE_SPONSORS) {
  entry.chain_regions = REGIONS;
  notes.push(`${sponsors} company sponsors, so the web's company list is built once per region`);
}
if (!kept.length) throw new Error(`The proposed scope keeps no trials. Check conditions_only in this entry:\n${JSON.stringify(entry, null, 2)}`);

console.log(`\n[${key}] proposed entry (scoping run ${rec.run_id}):\n${JSON.stringify(entry, null, 2)}`);
for (const n of notes) console.log(`  · ${n}`);
console.log(`\n${formatEstimate(estimate(entry, kept, today()))}\n`);

if (flag('print')) process.exit(0);
config.diseases.push(entry);
writeFileSync(FILE, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Added "${key}" to scripts/diseases.json. Review it (git diff), edit anything that looks wrong, then build:
  npm run pipeline -- --disease ${key} --yes`);
