# Recorded research packs

These are real Trial Check runs on public data, recorded on Sep 28, 2026 with
Parallel's Task API and Data Connectors. The app serves them in fixture mode,
and in live mode whenever storage has no newer pack.

## What each pack holds

| Field | What it is |
| --- | --- |
| `rows` | Stage 1 registry trials (ClinicalTrials.gov API v2, active statuses, company as lead sponsor or collaborator), each with its `pro` trial check. A check includes `basis` citations, `connector_log` (the `mcp_tool_calls`) and `registry_record`, which is parsed from `clinical_trials.get_trial_details`. |
| `found_beyond_registry_search` | Partner-run trials the company snapshot found by drug-name and code searches. Each one is confirmed on the registry and must pass the found-trial filter in `src/lib/domain/join.ts`. The Sep 28 run did not trial-check these; the weekly re-run does. |
| `snapshot`, `mechanism` | The `ultra` company snapshot and the `pro` mechanism run, with their basis and connector logs |
| `review` | Hand checks (from `review.json`). A ✓ shows only while the checked claim is unchanged: the same milestone type, date and source URL. |

## Provenance

- **Where results go.** The weekly refresh (`/api/cron/refresh`) writes new
  packs to storage as `packs/<key>/<date>.json` and `latest.json`. From then
  on, the app serves the newest stored pack, and these files are only the
  fallback. The "Research recorded" date on each page shows which one you are
  seeing.
- **Replays.** `fixtures/replay/<key>.json` holds compact event logs from the
  same runs, built with `npm run compact-replay`.
- **Investigators.** Person-name lead sponsors are replaced with
  "[Investigator]", in the packs and in replay search text.

## Model output, labeled

- Flags are computed in code from the milestone types and the registry status.
  The model never sets them.
- Claims a reviewer couldn't confirm are shown as "Unconfirmed" and never set a
  flag.
