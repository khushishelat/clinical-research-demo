# Trial Check

Every company racing in a disease, every active drug trial, and the clinicians
who run them.

Pick a disease. Each row is a company; each dot is one of its trials, placed
where it was first posted and sized by phase. Orange squares are dated news,
dashed diamonds are what the company says comes next, and an orange ring means
the trial came with an acquisition. Click a dot to see who runs the trial;
click a clinician for their roles and papers. The dataset view shows every
researched field with its sources.

**The MASH map** (built Oct 2, 2026):

- 167 active drug trials, 95 of them on company rows
- 63 companies: 46 that sponsor trials in the registry, plus 17 the web found
  and a person approved
- 749 named investigators; 229 US clinicians matched to the NPI Registry
- About $12B in licensing and M&A since May 2025, across 14 deals (stated USD
  totals only; financings and other currencies are not counted)
- 4 trials announced publicly before ClinicalTrials.gov listed them, such as
  Altimmune's PERFORMA, 28 days earlier

It's for BD, competitive-intelligence and investment analysts who follow a
disease area rather than one company.

## Where the data comes from

Every fact on screen comes from one of these, and nothing is entered by hand:

- **ClinicalTrials.gov API v2**: trials, sponsors, arms, investigators and sites
- **NPI Registry API**: NPI match, specialty and practice city
- **PubMed E-utilities**: paper counts and recent papers
- **Parallel Task API runs** with Data Connectors: owners, drugs and
  mechanisms, the web's company list, milestones, deals, approvals, next steps,
  clinicians' public roles, Medicare coverage, first-announced dates and the
  weekly brief

What is written by hand: the disease list, search terms and map subtitles in
`scripts/diseases.json`, and matching rules in code (name and credential
cleaning, comparator words such as "placebo").

## How it's built

One command builds a disease end to end:

```bash
npm run pipeline -- --disease mash
```

| Step | Source | Parallel processor | Data Connectors | MASH runs | MASH cost |
| --- | --- | --- | --- | ---: | ---: |
| 02 Registry | ClinicalTrials.gov API | | | | free |
| 03 Who owns each sponsor | Task API, one run per sponsor | `pro` | ChEMBL, ClinicalTrials.gov | 48 | $4.80 |
| 03 The web's company list | Task API, chained by `previous_interaction_id` until a page adds fewer than 2 new companies (at most 4 pages) | `ultra` | ClinicalTrials.gov, ChEMBL | 4 | $1.20 |
| 03 Same company, different names | Task API | `core` | | 1 | $0.03 |
| 04 Company facts | Task Group, one run per company, per-field citations | `pro` | ClinicalTrials.gov, PubMed | 63 | $6.30 |
| 04 Medicare coverage | Task API | `core` | CMS Coverage | 1 | $0.03 |
| 05 Clinicians | NPI Registry and PubMed APIs | | | | free |
| 05 Names with several NPI matches | Task Group | `base` | NPI Registry | 26 | $0.26 |
| 05 Authorship of common names | Task Group | `core` | PubMed | 13 | $0.33 |
| 05 Roles named on the web | Task Group, one run per company | `pro` | PubMed, NPI Registry | 63 | $6.30 |
| 05 Profiles of the top 25 | Task Group | `core` | NPI Registry, PubMed, ClinicalTrials.gov | 30 | $0.75 |
| 06 Events | Code, from steps 2–4 | | | | free |
| 08 First announced | Task Group, trials registered in the last 90 days | `base` | | 16 | $0.16 |
| 09 Weekly brief | Task API, from the week's sourced events only | `core` | | 1 | $0.03 |
| **Total** | | | | **266** | **$20.17** |

Costs are [list prices](https://docs.parallel.ai/getting-started/pricing) per completed run. The connectors used here are free.

The pipeline stops once, after step 3: companies found only on the web wait in
`review/companies.json` until a person sets `include` to true or false.

## The recipe (steal this)

Trial Check is one instance of a reusable pattern: an official database, a
noisy web, and a join between them.

1. **The pipeline writes, the app reads.** Every stored document is typed once,
   in `src/lib/space/types.ts`, for both sides. The app makes no Parallel calls.
2. **Lists without a list API.** The company list is built by chaining Task
   runs with `previous_interaction_id`, each page asking for companies not yet
   named, until a page adds fewer than two new ones or four pages have run.
3. **Connectors where a judgment needs a database.** Direct API calls do the
   bulk lookups for free. Only ambiguous cases go to a Task run: a name with
   several NPI records, or a common name in PubMed.
4. **One person, once.** Web-found companies need a yes or no before they cost
   anything further.
5. **Never bill twice.** Every step keeps a run log and reuses finished runs, so
   re-running a disease pays only for new work.
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

To add a disease, append it to `scripts/diseases.json` and run the pipeline with
its key. Each map is as of its last pipeline run, shown in the header; there is
no scheduled refresh yet.

```bash
npm test
npm run typecheck
npm run lint
```

## Routes

| Route | |
| --- | --- |
| `/` | Redirects to the default disease, or explains how to build one |
| `/d/:disease` | The map, with the clinician and what-changed rails |
| `/d/:disease/data` | The dataset: click any cell for its sources; replay of the research run; CSV download |
| `/d/:disease/brief` | The weekly brief |
| `GET /api/d/:disease/trial/:nct`, `/clinician/:key`, `/basis/:company`, `/replay/:job`, `/export` | Data behind the pages |

## Not advice

Research support from public sources, not investment or medical advice. Coverage
of trials and disclosures is not complete.
