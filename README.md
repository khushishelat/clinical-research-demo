# Trial Check

What a biotech is actually running, and what changed that the registry doesn't
show.

Enter a company. Trial Check lists every active trial it runs, partners on or
collaborates on, and checks each one against the company's own news, filings
and papers. Every trial gets its latest dated milestone and next catalyst, each
with a source, and a flag where ClinicalTrials.gov is behind what the company
already said.

**What the recorded runs found** (six companies, Sep 28, 2026):

- **Trials a sponsor search misses.** For Summit, a registry search returns 31
  trials; research finds 51, because 20 are run by partners and don't list
  Summit.
- **News the registry doesn't carry.** 19 of Summit's 31 registry trials have
  dated public news (a readout, an enrollment update, a filing) that the
  registry record doesn't show.
- **Registry lags.** These are rare (3 in 116 registry trials) and specific when
  they happen. At recording, HARMONi-3 still said Recruiting two months after
  Summit reported enrollment complete, while 241 of its 260 sites already said
  otherwise. Akeso's COMPASSION-22 still said Recruiting 18 months after
  enrollment completed. Both are hand-checked. The registry is re-read on
  every open, so a flag clears as soon as the registry catches up.

No flag is set by hand: code sets every flag from the milestone type and
today's registry status. Model output is labeled as such unless hand-checked.

It's for BD, competitive-intelligence and investment analysts who track biotech
pipelines. They need to know what changed, not re-read registry pages.

## The recipe (steal this)

Trial Check is one instance of a reusable pattern: take a domain with an
official database and a noisy web, put connectors on both, and flag the
disagreements. The pieces a deployed engineer can lift:

1. **One Task Group per entity.** An `ultra` snapshot for breadth, a `pro`
   mechanism pass and a `pro` check per item, with connectors on every run.
2. **A freshness state machine.** Re-read the database on every open, re-run
   weekly on a cron, and let daily event-stream monitors trigger
   connector-backed re-checks that patch rows.
3. **Flags in code, not in the model.** The model finds facts; code decides
   what counts as a conflict or a lag.

Details in [How it works](#how-it-works) and on the "Under the hood" page.

Six companies are recorded and open instantly: Summit, Akeso (Phase 3 only),
Arvinas, Legend, Revolution Medicines and Axsome. Anyone can research a new
company. That takes about 8 minutes, and the result is shared with everyone.

## Where the connectors show up

| Connector | What it does here | Where you see it |
| --- | --- | --- |
| `clinical_trials` | Reads the full registry record (sites, site status, outcomes). Finds partner-run trials by searching drug names and codes, which a sponsor search misses. Confirms competitors' stages. | Hero count ("31 in the registry search → 51 found by research"), found-by-research badges, the registry drawer, and the site-status line: "241 of 260 sites already show Active, not recruiting." |
| `pubmed` | Looks for results papers for each trial | Results and publications, including an honest "0 papers found" with the queries that ran |
| `chembl` | Gets the lead asset's targets and mechanism, and molecules on the same targets | Competitive set |
| `biorxiv` | Looks for preprints | "Checked with" line on each row |

The "Via connector" marker appears only where a connector, not the open web,
produced the fact. Web news and filings keep plain source chips.

## How it works

1. **Find** (free, under a second). The ClinicalTrials.gov API v2 lists the
   company's active trials as lead sponsor or collaborator. This re-runs on
   every page open, so registry status is always today's.
2. **Research** (Task API, one Task Group per company):
   - an `ultra` company snapshot: programs, partnerships, partner-run trials
   - a `pro` mechanism run: ChEMBL targets and competitors
   - a `pro` trial check per trial, with connectors on every run
     (`advanced_settings.data_sources`)

   When the snapshot finishes, the partner-run trials it found are confirmed
   against the registry, and their checks join the same group.
3. **Join** (code, not the model). Trials attach to programs by NCT ID, and
   code sets the flags:

   | Flag | When |
   | --- | --- |
   | conflict | The company says the trial was stopped, but the registry says active |
   | registry lagging | Any milestone says enrollment completed, but the registry still says enrolling |
   | news | Any other dated milestone |
   | no news | Nothing found |

   A found trial is kept only if all of these hold:
   - it exists on the registry
   - it doesn't list the company
   - it has an industry lead sponsor
   - one of its interventions is a company asset

**Freshness**

- **Every open.** Registry status is re-read. A lag clears when the registry
  catches up ("✓ Registry caught up"). It drops to "Registry changed · in next
  check" when the status moves sideways.
- **Weekly.** A cron state machine re-runs every recorded company. Hand-check
  ticks carry over only when the claim is unchanged: same milestone type, date
  and source.
- **Daily.** One `event_stream` monitor per company (Monitor API, `base`)
  watches for news. Monitors can't call connectors. So a matched event starts
  a connector-backed `pro` check, with `previous_interaction_id` set to the
  event, and the result patches that row: "Updated from a Monitor event".

**Ask** is on the Responses API: `model: "parallel"`, `reasoning.effort:
"medium"`, and `data_sources` set to `clinical_trials` and `pubmed`. It streams
a quick answer with citations. Answers are labeled exploratory and never change
a flag. On the company page it lives in a collapsed Experimental disclosure
below the fold; the trial-detail page keeps an inline one.

**Replay** plays the recorded run's real event log in 30 seconds: searches,
pages read and connector calls. It makes no API calls.

## Run it

```bash
npm install
npm run dev
```

The app starts in fixture mode by default, with the six recorded companies, no
key and no API calls. For live runs, copy `.env.example` to `.env.local` and
set `DEMO_MODE=live` and `PARALLEL_API_KEY`. Setting a key alone never turns
live mode on.

```bash
npm test          # 29 tests: flags, freshness, layout, pipeline state machine, webhooks, routes
npm run typecheck
```

## Deploy (Vercel)

1. Add private Blob storage and Upstash Redis (Marketplace), and set the
   variables in `.env.example`.
2. `vercel.json` schedules two crons:
   - `/api/cron/refresh`: every 15 minutes on Mondays. Each call advances
     every company by one step.
   - `/api/cron/followups`: every 15 minutes. It drains Monitor follow-ups and
     advances research nobody is watching.
3. Create the monitors once. This bills daily until cancelled.

   ```bash
   npm run setup-monitors -- --mode=create
   ```

   It writes `data/monitors.json`; commit that file. To stop the monitors, run
   `--mode=cancel`.

**Webhooks** arrive at `/api/webhooks/parallel`.

- They're verified with the Standard Webhooks signature, de-duplicated by
  `webhook-id` and queued, and the endpoint returns 200 right away.
- A monitor webhook only carries `event_group_id`. The events are fetched
  from the API.

**Spend.** Viewers never see a price. Server-side caps protect the key:

- per-IP daily limits
- daily budgets for research, Ask and follow-ups
- a per-run cap

Research over the budget is queued, not refused.

## Routes

| Route | |
| --- | --- |
| `/` | Typeahead: recorded companies first, then the sponsor index (`data/sponsors.json`) with live counts |
| `/c/:key` | Landscape. Add `?replay=1` for the replay, or `?run=<taskgroup_id>` for a live run |
| `/c/:key/t/:nct` | Trial detail |
| `/c/:key/competitive` | Competitive set (linked from Under the hood, not a nav tab) |
| `/c/:key/company`, `/hood` | Company, Under the hood |
| `/c/:key/narrow` | Narrowing for sponsors with more than 60 trials |
| `GET /api/company/:key`, `/api/registry/:key`, `/api/events/:key`, `/api/replay/:key`, `/api/export/:key` | Data |
| `POST /api/research`, `GET /api/research/:gid/stream` | Research, streamed as server-sent events |
| `POST /api/ask` | Ask (server-sent events) |

## Data and privacy

- **Recorded packs** (`fixtures/recorded/`) are real runs on public data from
  Sep 28, 2026. Model output is labeled as such unless hand-checked. See
  `fixtures/recorded/README.md`.
- **Investigators.** Some investigator-led trials list a person as lead
  sponsor. That name shows as "[Investigator]" everywhere, including replay
  logs. Site contacts are never shown.
- **Not advice.** This is research support from public sources, not investment
  or medical advice, and its coverage of trials and disclosures is not
  complete.
