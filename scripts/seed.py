#!/usr/bin/env python3
"""Seed the demo's trial watchlist from Parallel's clinical_trials connector.

For each sponsor, runs a Task API call with the clinical_trials data source
and a strict output schema, then normalizes the result into
src/data/seed-trials.json.

Auth: uses the stored `custom.parallel` connector via dynamic credential
surrogates (same mechanism as ~/workspace/skills/parallel/bin/parallel).

Usage:
    python3 scripts/seed.py
"""
from __future__ import annotations

import datetime
import json
import sys
import time
import urllib.request

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import (  # noqa: E402
    add_surrogate_to_request,
    read_json_response,
)

BASE = "https://api.parallel.ai"
CREDENTIAL = "custom.parallel"
ALLOWED_HOSTS = ("api.parallel.ai",)
OUT_PATH = "src/data/seed-trials.json"

SPONSORS = [
    "Eli Lilly and Company",
    "Novo Nordisk",
    "Pfizer Inc.",
]

OUTPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "trials": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "nctId": {"type": "string"},
                    "title": {"type": "string"},
                    "phase": {"type": "string"},
                    "status": {"type": "string"},
                    "conditions": {"type": "array", "items": {"type": "string"}},
                    "interventions": {"type": "array", "items": {"type": "string"}},
                    "enrollment": {"type": "number"},
                    "startDate": {"type": "string"},
                    "primaryCompletionDate": {"type": "string"},
                    "locationCount": {"type": "number"},
                    "studyType": {"type": "string"},
                    "lastUpdatePosted": {"type": "string"},
                    "firstPosted": {"type": "string"},
                },
                "required": ["nctId", "title", "phase", "status"],
            },
        }
    },
    "required": ["trials"],
}

PROMPT = """Using the ClinicalTrials.gov connector, find interventional trials \
sponsored by {sponsor} related to obesity, overweight, diabetes, or weight \
management, in Phase 2 or Phase 3, with status RECRUITING, ACTIVE_NOT_RECRUITING, \
or NOT_YET_RECRUITING. Return up to 15, preferring the most recently updated. \
For each trial include the registry's first posted date and last update posted \
date. Phase should be a human string like "Phase 3". Status must be one of: \
RECRUITING, ACTIVE_NOT_RECRUITING, NOT_YET_RECRUITING, COMPLETED, SUSPENDED, \
TERMINATED, WITHDRAWN."""


def api(method: str, path: str, payload: dict | None = None) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data:
        req.add_header("Content-Type", "application/json")
    add_surrogate_to_request(
        req, CREDENTIAL, entry_name="access_token", allowed_hosts=ALLOWED_HOSTS
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return read_json_response(resp)


def run_seed_task(sponsor: str) -> dict:
    payload = {
        "input": PROMPT.format(sponsor=sponsor),
        "processor": "base",
        "advanced_settings": {"data_sources": {"free": ["clinical_trials"]}},
        "output_schema": OUTPUT_SCHEMA,
    }
    task = api("POST", "/v1/tasks/runs", payload)
    run_id = task["run_id"]
    print(f"[{sponsor}] run {run_id}", flush=True)
    deadline = time.time() + 900
    while time.time() < deadline:
        status = api("GET", f"/v1/tasks/runs/{run_id}")
        state = status.get("status")
        if state == "completed":
            return api("GET", f"/v1/tasks/runs/{run_id}/result")
        if state in ("failed", "cancelled"):
            raise SystemExit(f"[{sponsor}] run {state}: {status}")
        time.sleep(8)
    raise SystemExit(f"[{sponsor}] timed out waiting for {run_id}")


def normalize_phase(raw: str) -> str:
    m = {
        "PHASE1": "Phase 1",
        "PHASE2": "Phase 2",
        "PHASE3": "Phase 3",
        "PHASE4": "Phase 4",
        "PHASE1_PHASE2": "Phase 1/2",
        "PHASE2_PHASE3": "Phase 2/3",
    }
    return m.get(raw.strip().upper().replace(" ", "_"), raw)


def normalize_trial(t: dict, sponsor: str) -> dict:
    nct = t.get("nctId", "")
    first_posted = t.get("firstPosted") or ""
    change = None
    # Mark genuinely recent registrations — grounded in the registry's
    # first-posted date, not invented.
    try:
        fp = datetime.date.fromisoformat(first_posted[:10])
        age_days = (datetime.date.today() - fp).days
        if 0 <= age_days <= 180:
            change = {
                "type": "NEW",
                "detail": f"First posted {fp.isoformat()} ({age_days}d ago)",
                "detectedAt": datetime.date.today().isoformat(),
                "basis": [
                    {
                        "title": f"ClinicalTrials.gov — {nct}",
                        "url": f"https://clinicaltrials.gov/study/{nct}",
                    }
                ],
            }
    except (ValueError, TypeError):
        pass

    def num(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "nctId": nct,
        "title": t.get("title", ""),
        "sponsor": sponsor,
        "phase": normalize_phase(str(t.get("phase", ""))),
        "status": str(t.get("status", "UNKNOWN")).upper(),
        "conditions": t.get("conditions") or [],
        "interventions": t.get("interventions") or [],
        "studyType": t.get("studyType") or "INTERVENTIONAL",
        "enrollment": num(t.get("enrollment")),
        "startDate": t.get("startDate"),
        "primaryCompletionDate": t.get("primaryCompletionDate"),
        "lastUpdatePosted": t.get("lastUpdatePosted"),
        "locationCount": num(t.get("locationCount")),
        "change": change,
        "enrichment": [],
        "citations": [
            {
                "title": f"ClinicalTrials.gov — {nct}",
                "url": f"https://clinicaltrials.gov/study/{nct}",
            }
        ]
        if nct
        else [],
    }


def main() -> None:
    all_trials = []
    for sponsor in SPONSORS:
        result = run_seed_task(sponsor)
        content = (result.get("output") or {}).get("content") or {}
        if isinstance(content, str):
            content = json.loads(content)
        trials = content.get("trials", [])
        print(f"[{sponsor}] got {len(trials)} trials", flush=True)
        for t in trials:
            all_trials.append(normalize_trial(t, sponsor))

    # De-dupe by NCT ID, keep first occurrence
    seen = set()
    deduped = []
    for t in all_trials:
        if t["nctId"] and t["nctId"] not in seen:
            seen.add(t["nctId"])
            deduped.append(t)

    with open(OUT_PATH, "w") as f:
        json.dump(deduped, f, indent=2)
    print(f"wrote {len(deduped)} trials to {OUT_PATH}")


if __name__ == "__main__":
    main()
