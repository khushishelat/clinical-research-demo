# Trial Check

Every company racing in a disease, every active drug trial, and the clinicians
who run them.

Pick a disease. Each row is a company in the race; each dot is one of its
trials, placed where it first posted on the timeline and sized by phase.
Orange squares are dated news from the web, dashed diamonds are what the
company says is next, and an orange ring means the program came with an
acquisition. The right rail shows the clinicians most involved —
NPI-verified — and what changed, with a "new" count since your last look.
Click any dot or clinician for the full drawer.

**How you know it's true.** Every researched field carries its receipts: click
any cell in the dataset view and you get the Task run's citations, its
reasoning, and how confident it was. The recorded research replay plays the
run's real event log — searches, pages read, connector calls — at 20× speed.
The weekly brief is written by a Task run from that week's sourced events
only; sources not in the input are dropped. And every event carries its
first-announced date, so you can see when the web knew before the registry did.

It's for BD, competitive-intelligence and investment analysts who track a
disease area, not one company. They need to know what changed, not re-read
registry pages.

## The recipe (steal this)

Trial Check is one instance of a reusable pattern: take a domain with an
official database and a noisy web, and build the join between them. The pieces
a deployed engineer can lift:

1. **The pipeline writes, the app reads.** Every stored document is typed once
   in `src/lib/space/types.ts` and shared by both sides. The app makes no
   Parallel calls; it only reads what the pipeline wrote.
2. **One human gate.** Web-discovered companies wait in
   `review/companies.json` until a person sets include to true or false. The
   pipeline stops and tells you who's waiting.
3. **Never bill twice.** Every step keeps a run log and reuses finished runs,
   so re-running a disease never pays for finished work again.
4. **Privacy as a constraint, not a policy.** No document holds phone numbers,
   emails, street addresses or site contacts — and any that slip through block
   the save.

## How it works

`npm run pipeline -- --disease mash` builds one disease end to end:

1. **02 registry.** ClinicalTrials.gov API v2: every active drug trial for the
   disease, with investigator names and roles.
2. **03 companies.** Sponsor → current owner: a Task `pro` run per sponsor
   (ClinicalTrials.gov and ChEMBL connectors), plus the web's company list by
   interaction chaining. Web-only companies wait for your review.
3. **04 enrich.** One `pro` run per company (ClinicalTrials.gov and PubMed
   connectors) with per-field citations; Medicare coverage via the CMS Coverage
   connector.
4. **05 clinicians.** NPI Registry and PubMed directly, connectors for
   ambiguous matches, web roles and top profiles. Profiles are US-only and
   NPI-verified.
5. **06 events, 08 first-announced, 09 brief.** Dated milestones and deals,
   when the web first announced each one, and the weekly brief.

## Run it

```bash
npm install
npm run dev
```

With no disease built, the home page tells you to run the pipeline — the repo
ships the pipeline, not the data. Copy `.env.example` to `.env.local` and set
`PARALLEL_API_KEY`; for a deployment, set `BLOB_READ_WRITE_TOKEN` and the
pipeline writes to private Vercel Blob instead of the gitignored `.data/`.

```bash
npm test
npm run typecheck
```

Diseases live in `scripts/diseases.json` — append one and build it. A person
reviews that list; entries in `exclude` are never built.

## Routes

| Route | |
| --- | --- |
| `/` | Redirects to the preferred built disease, or the empty state |
| `/d/:disease` | The map: companies × trials timeline, clinician and what-changed rails |
| `/d/:disease/data` | Dataset: one row per company, click any cell for its receipts; CSV export |
| `/d/:disease/brief` | Weekly brief, written from that week's sourced events only |
| `GET /api/d/:disease/trial/:nct`, `/clinician/:key`, `/basis/:company`, `/replay/:job`, `/export` | Data |

## Data and privacy

- **Professional facts only.** No document holds phone numbers, emails, street
  addresses or site contacts, and any that remain block the save.
- **Clinicians.** US-only, NPI-verified profiles. A removal contact belongs in
  `NEXT_PUBLIC_REMOVAL_URL`.
- **Model output is labeled** as such unless hand-checked; per-cell confidence
  is shown in the dataset view.
- **Not advice.** Research support from public sources, not investment or
  medical advice, and its coverage is not complete.
