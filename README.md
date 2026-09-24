# Pipeline Watch

Competitive clinical trial intelligence — a Parallel Web Systems demo.

Watches the GLP-1 pipelines of **Eli Lilly**, **Novo Nordisk**, and **Pfizer**:
new registrations, phase transitions, and status changes, enriched with press
releases, earnings calls, and FDA filings. Every claim carries its source.

## How it works

1. **Seed** — `scripts/seed.py` runs one Task API call per sponsor with the
   free `clinical_trials` data connector attached (`advanced_settings.data_sources`),
   using a strict `output_schema` so registry records come back as structured JSON.
   Output lands in `src/data/seed-trials.json`.
2. **Watch** (next) — snapshot monitors diff registry fields between runs to
   detect phase/status transitions; event-stream monitors catch new registrations.
3. **Enrich** (next) — follow-up Task runs with the PR Newswire connector + web
   research attach press/earnings/filing signals to trials.
4. **Serve** — Next.js renders the trial feed, detail panels with citations,
   and stats from the seed baseline.

## Run it

```bash
npm install
npm run dev
```

Re-seed the baseline (needs a Parallel API key — see below):

```bash
python3 scripts/seed.py
```

## Env

| Var | Purpose |
|---|---|
| `PARALLEL_API_KEY` | Live refresh via the Parallel API (optional; demo serves seed data without it) |
| `SEED_UPDATED_AT` | Override the "updated" stamp shown in the header |

For local seeding from this machine, auth goes through the stored Parallel
connector (never paste a raw key into the repo).

## Deploy

Standard Next.js on Vercel. Set `PARALLEL_API_KEY` in the project env for live
data; otherwise the seeded baseline is served.

## Notes

- Registry data: ClinicalTrials.gov via Parallel's `clinical_trials` connector.
- Demo only — not medical advice.
