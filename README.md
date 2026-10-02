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

What is written by hand: the indication list, therapeutic areas, search terms
and subtitles in
`scripts/diseases.json`, and matching rules in code (name and credential
cleaning, comparator words such as "placebo").

## How it's built

One command builds an indication end to end:

```bash
npm run pipeline -- --disease mash
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
   in `src/lib/space/types.ts`, for both sides. The app makes no Parallel calls.
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

## Run it

```bash
npm install
cp .env.example .env.local   # set PARALLEL_API_KEY
npm run pipeline -- --disease mash
npm run dev                   # open http://localhost:3000
```

The repository ships the pipeline, not the data. Without `BLOB_READ_WRITE_TOKEN`
the pipeline writes to `.data/` (gitignored) and the app reads from there. With
it, both use private Vercel Blob, for a deployment.

To add an indication, append it to `scripts/diseases.json` and run the pipeline
with its key. Each landscape is as of its last pipeline run, shown in the header;
there is no scheduled refresh yet.

```bash
npm test
npm run typecheck
npm run lint
```

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
