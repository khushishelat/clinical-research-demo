# Trial Check

Competitive landscapes by indication: every company developing drugs in it,
their active trials, what they've disclosed, and the investigators running the
trials.

Pick an indication. Each row is a company and its lead assets; each dot is one
of its trials, placed at first posting and sized by phase. Black dots are
industry-sponsored trials, grey dots are investigator-sponsored trials (ISTs)
of the company's asset, and an orange ring marks an acquired asset. Orange
squares are dated disclosures (readouts, deals, regulatory news) and dashed
diamonds are company-guided catalysts. Click a trial for its investigators and
disclosures, or an investigator for their trial roles and publications. The
table view shows every researched field with its sources.

**The MASH landscape** (built Oct 2, 2026):

- 168 active trials, 98 of them on company rows
- 68 companies: 48 registry sponsors, plus 22 found by web research and
  approved by a person
- 749 investigators (PIs and study chairs) named in the registry; 229 US
  investigators matched to the NPI Registry
- About $19B in disclosed licensing and M&A value since May 2025, across 12
  asset deals such as Novo Nordisk–Akero, Madrigal–Ribo and Roche–89bio
  (headline USD values only; whole-company, commercial and research deals are
  shown on the rows but not counted)
- 6 trials disclosed before ClinicalTrials.gov listed them, such as Altimmune's
  PERFORMA, 28 days earlier

**Indications built so far** (October 2026, same pipeline and specs for each):

| Indication | Area | Trials | Companies | Investigators | Asset deals since May 2025 | Cost to build |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| MASH | Cardiometabolic | 168 active | 68 | 749 | ≈$19B, 12 deals | $29.50 |
| Obesity | Cardiometabolic | 476 active + 232 completed since 2024 (Phase 2+) | 106 | 1,754 | ≈$39B, 27 deals | $58.54 |
| Alzheimer's disease | Neuroscience | 292 active + 115 completed | 125 | 471 | ≈$10B, 18 deals | $59.22 |
| Migraine | Neuroscience | 153 active + 79 completed | 37 | 158 | 1 deal, value not disclosed | $17.96 |
| Alopecia areata | Immunology | 48 active + 19 completed | 29 | 165 | ≈$2.2B, 4 deals | $26.09 |

Cost is list price for the completed Task runs of one build on the current
specs. It scales with the number of companies (three `pro` runs each) and of
late-stage trials. Alopecia areata's figure includes about $12 spent on
sponsors of other alopecias before its scope was narrowed to trials that name
it. Pancreatic cancer is configured but not built.

It's for BD, competitive-intelligence and investment analysts who cover an
indication or therapeutic area rather than one company.

## Where the data comes from

Every fact on screen comes from one of these, and nothing is entered by hand:

- **ClinicalTrials.gov API v2**: trials, sponsors, arms, investigators and sites
- **NPI Registry API**: NPI match, specialty and practice city
- **PubMed E-utilities**: publication counts and recent publications
- **Parallel Task API runs** with Data Connectors: asset owners and
  mechanisms, the web's company list, readouts, deals, approvals, guided
  catalysts, investigators' disclosed roles, Medicare coverage, first-disclosure
  dates and the weekly brief

What is written by hand: the indication list, therapeutic areas, search terms,
subtitles and scope (for example, alopecia areata keeps only trials whose
conditions name it, because the registry search also returns other alopecias) in
`scripts/diseases.json`, and matching rules in code (name and credential
cleaning, comparator words such as "placebo").

## How it's built

One command builds an indication end to end (see [Add an indication](#add-an-indication) for a new one):

```bash
npm run pipeline -- --disease mash --yes
```

| Step | Source | Parallel processor | Data Connectors | MASH runs | MASH cost | Migraine runs | Migraine cost |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| 02 Registry | ClinicalTrials.gov API: active trials, plus trials completed since a set date where the indication asks for it | | | | free | | free |
| 03 Who owns each sponsor | Task API, one run per sponsor | `pro` | ChEMBL, ClinicalTrials.gov | 48 | $4.80 | 24 | $2.40 |
| 03 The web's company list | Task API, chained by `previous_interaction_id`: at least 4 pages, then until a page adds fewer than 3 new companies (at most 8) | `ultra` | ClinicalTrials.gov, ChEMBL | 4 | $1.20 | 5 | $1.50 |
| 03 Same company, different names | Task API | `core` | | 1 | $0.03 | 1 | $0.03 |
| 04 Clinical facts | Task Group, one run per company, per-field citations | `pro` | ClinicalTrials.gov, PubMed | 68 | $6.80 | 37 | $3.70 |
| 04 Deals, financings, regulatory | Task Group, one run per company, per-field citations | `pro` | | 68 | $6.80 | 37 | $3.70 |
| 04 Readouts | Task Group, one run per company trial in Phase 2+ that is past primary completion or has reported | `core` | ClinicalTrials.gov, PubMed | 22 | $0.55 | 50 | $1.25 |
| 04 Medicare coverage | Task API | `core` | CMS Coverage | 1 | $0.03 | 1 | $0.03 |
| 05 Investigators | NPI Registry and PubMed APIs | | | | free | | free |
| 05 Names with several NPI matches | Task Group | `base` | NPI Registry | 26 | $0.26 | 11 | $0.11 |
| 05 Authorship of common names | Task Group | `core` | PubMed | 13 | $0.33 | 3 | $0.08 |
| 05 Roles named in disclosures | Task Group, one run per company | `pro` | PubMed, NPI Registry | 68 | $6.80 | 37 | $3.70 |
| 05 Profiles of the top 25 | Task Group | `core` | NPI Registry, PubMed, ClinicalTrials.gov | 25 | $0.63 | 25 | $0.63 |
| 06 Events | Code, from steps 2–4 | | | | free | | free |
| 08 First disclosed | Task Group, trials registered in the last 90 days | `core` | | 17 | $0.43 | 9 | $0.23 |
| 09 Weekly brief | Task API deep research, text output: starts from the week's registry changes and disclosures, then researches what they miss; recorded for replay | `ultra2x` | ClinicalTrials.gov, PubMed | 1 | $0.60 | 1 | $0.60 |
| **Total** | | | | **362** | **$29.26** | **241** | **$17.96** |

Costs are [list prices](https://docs.parallel.ai/getting-started/pricing) per completed run for one build on the current specs. The connectors used here are free. Cost scales with the number of companies (three `pro` runs each) and late-stage trials; migraine also includes trials completed since 2024, which is where most of its readouts come from.

The pipeline stops once, after step 3: companies found only on the web wait in
`review/companies.json` until a person sets `include` to true or false.

## The task specs

Every Parallel run's processor, connectors and output schema live in
`scripts/lib/specs.ts`. Five rules keep the output joinable and auditable:

- **The model returns IDs we gave it.** Each run gets the indication's
  registry trials and the company's known drugs. Anything about a trial comes
  back with that trial's NCT ID (or null), and anything about a drug with its
  given name. Code drops any ID that isn't one of the company's trials, then
  joins exactly; nothing is matched from headline text.
- **Enums wherever code groups.** Phases, deal types, regulatory events, routes
  and comparators are fixed values, with an optional note for nuance. The run
  also says what each deal is for (an asset, a company bought for its asset, a
  whole portfolio, a commercial or research agreement), and the headline value
  counts only the first two.
- **Scope is decided in the run, not after it.** When results are too broad
  (corporate bonds listed as financings, a whole-company sale counted as an
  asset deal), the fix is a sharper field description or a new enum in the
  spec, never a second model pass over the output.
- **Amounts as stated and as numbers.** "up to $4.4B" is kept as written, with a
  currency and a value in millions; totals sum only USD.
- **Versioned specs.** Each spec has a key (`deals@3`) that prefixes its run-log
  entries. Changing a spec means a new version, so a rebuild pays for the new
  spec on purpose, and every stored record says which spec produced it.

## The recipe (steal this)

Trial Check is one instance of a reusable pattern: an official database, a
noisy web, and a join between them.

1. **The pipeline writes, the app reads.** Every stored document is typed once,
   in `src/lib/space/types.ts`, for both sides. The app starts no Parallel runs;
   its one Parallel call reads a monitor's new events when the monitor's webhook
   arrives.
2. **Lists without a list API.** The company list is built by chaining Task
   runs with `previous_interaction_id`, each page asking for companies not yet
   named: at least four pages, then until a page adds fewer than three new
   ones. A company found once stays on the list.
3. **Connectors where a judgment needs a database.** Direct API calls do the
   bulk lookups for free. Only ambiguous cases go to a Task run: a name with
   several NPI records, or a common name in PubMed.
4. **One person, once.** Web-found companies need a yes or no before they cost
   anything further.
5. **Never bill twice.** Every step keeps a run log and reuses finished runs, so
   re-running an indication pays only for new work.
6. **Privacy enforced in code.** No document holds phone numbers, emails,
   street addresses or site contacts, and a save fails if any remain. See
   [PRIVACY.md](PRIVACY.md).
7. **Monitors that each ask one question.** Every indication has a broad news
   Monitor, one per topic (data and conferences, regulatory, deals and
   financings, trial starts and stops) and one per leading company, half
   picked by size of program and half by how often they make the news. The
   output schema says whether an event is about this indication, so the run
   filters other diseases itself. Events join a company by name, drug or a
   unique partial name; the rest are kept in `monitor-unmatched.json` with the
   reason, never dropped silently. The same development found by two monitors
   is one item that names both. `npx tsx scripts/monitors.mts --disease <key> --report`
   shows what each monitor found and what only it found, so the set can be
   pruned on evidence.

## Run it

```bash
npm install
cp .env.example .env.local   # set PARALLEL_API_KEY
npm run pipeline -- --disease mash --yes   # without --yes, a first build only prints its estimate
npm run dev                   # open http://localhost:3000
```

The repository ships the pipeline, not the data. Without `BLOB_READ_WRITE_TOKEN`
the pipeline writes to `.data/` (gitignored) and the app reads from there. With
it, both use private Vercel Blob, for a deployment.

To deploy on Vercel:

1. Import the repository as a project (Next.js, no build settings to change).
2. Create a Blob store under Storage and connect it to the project. This sets
   `BLOB_READ_WRITE_TOKEN`. The app needs no Parallel API key; it makes no
   Parallel calls.
3. Copy the indications you built into the store. With the token in
   `.env.local` (`vercel env pull`), run:
   ```bash
   npm run sync-blob
   ```
4. Redeploy, so the build sees the data, then add your domain under
   Settings → Domains.

Optionally set `NEXT_PUBLIC_REMOVAL_URL` to where removal requests should go.
The default is the removal section of PRIVACY.md.

Visitors can ask for an indication from the app ("Request an indication"), which
opens a GitHub issue form. A maintainer builds it with the steps in
[Add an indication](#add-an-indication).

Once deployed, two scheduled jobs (`vercel.json`) keep every built indication
current:

- **Daily** (`/api/cron/daily`):
  - the ClinicalTrials.gov diff;
  - the indication's news Monitors (`monitor: true` in `diseases.json`):
    created when missing, replaced when the API key can't see them, and read;
  - the event feed and the first-disclosure check for new trials;
  - a readout check for trials that reach a readout point, plus a monthly re-check of those with no results yet.
- **Weekly** (`/api/cron/brief`, Mondays): the brief.

Both need `PARALLEL_API_KEY` and `CRON_SECRET` set on the project. With five
indications they cost about $40 a month: the monitors about $22 (15 per
indication, $0.01 a run, daily), the weekly brief about $13, readout checks
about $5.

In production each monitor also calls `/api/monitor/webhook` when it finds
something, so news reaches the map within minutes instead of at the next daily
job. The call is only a nudge: the route stores nothing from the request, only
re-reads the named monitor (if it is one of this app's) with its own API key.
Optionally set `PARALLEL_WEBHOOK_SECRET` (platform.parallel.ai → Settings →
Webhooks, for the account that owns `PARALLEL_API_KEY`) to refuse unsigned
requests as well.

**Changing the Parallel API key.** Stored research doesn't need the old key:
the daily job starts fresh runs, and replaces monitors the new key can't see.
The old key's monitors keep running and billing until cancelled. To cancel
them, run this with both keys in your shell:

```bash
OLD_PARALLEL_API_KEY=… PARALLEL_API_KEY=… npx tsx --env-file=.env.vercel scripts/rotate-key.mts --dry-run
```

Drop `--dry-run` once the plan looks right.

```bash
npm test
npm run typecheck
npm run lint
```

## Add an indication

Nothing is spent until you pass `--yes`, apart from one scoping run.

1. **Propose it.** A free ClinicalTrials.gov preview of the name, then one `core`
   Task run (about $0.03) that proposes the entry:
   ```bash
   npm run new-indication -- "Idiopathic pulmonary fibrosis"
   ```
   It adds the entry to `scripts/diseases.json` and prints what the build will
   cost. Check it with `git diff`, mainly the search terms (`query_cond`) and any
   condition filter (`default_scope.conditions_only`), against the condition
   terms it prints. Edit freely; `--print` shows a proposal without writing it.
2. **Check the cost** after any edit (free):
   ```bash
   npm run pipeline -- --disease idiopathic-pulmonary-fibrosis --estimate
   ```
3. **Build it.** The pipeline stops once, for companies found only on the web:
   ```bash
   npm run pipeline -- --disease idiopathic-pulmonary-fibrosis --yes
   npm run review -- --disease idiopathic-pulmonary-fibrosis   # recommendations; set include in review/companies.json
   npm run pipeline -- --disease idiopathic-pulmonary-fibrosis
   ```
4. **Ship it.** Open a pull request with the new entry. For a deployment, run
   `npm run sync-blob`; the daily job starts the indication's news Monitors.

Who decides each field:

| Field | Set by |
| --- | --- |
| `name`, `subtitle`, `area` | the scoping run (`SCOPE` in `scripts/lib/specs.ts`) |
| `query_cond`, `pubmed_terms`, `specialties` | the scoping run, given the registry preview |
| `default_scope.conditions_only` | the scoping run, when the search also returns neighboring conditions |
| `default_scope.min_phase: 2` | code, above 400 active drug trials |
| `chain_regions` | code, from 80 company sponsors |
| `include_completed_since` | code: January 1, two years back |
| `monitor` | `true` |

The estimate is a range because the number of companies is unknown until the
pipeline resolves sponsors to owners and searches the web (1.0 to 1.6 per
sponsor). For each of the five indications built so far, the actual cost fell
inside its range.

The scoping run was tested on the six configured indications. It set the same
condition filters as the hand-written entries that have one (alopecia areata,
Alzheimer's, pancreatic cancer), its search terms covered the same names, and
code chose Phase 2+ for the same two (obesity, pancreatic cancer). Differences: a
mild "migraine" filter (keeps 225 of 233 trials), regions for Alzheimer's
company list, and trials completed since 2024 for MASH.

## Routes

| Route | |
| --- | --- |
| `/` | Redirects to the default indication, or explains how to build one |
| `/d/:disease` | The landscape map, with the investigator and recent-activity rails |
| `/d/:disease/data` | The landscape table: click any cell for its sources; replay of the research run; CSV download |
| `/d/:disease/brief` | The weekly brief |
| `GET /api/d/:disease/trial/:nct`, `/clinician/:key`, `/basis/:company`, `/replay/:job`, `/export` | Data behind the pages |

## Not advice

Research support from public sources, not investment or medical advice. Coverage
of trials and disclosures is not complete.
