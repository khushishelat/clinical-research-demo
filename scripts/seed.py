#!/usr/bin/env python3
"""Seed the demo's trial watchlist from Parallel's clinical_trials connector.

For each sponsor, runs a Task API call with the clinical_trials data source,
then extracts the structured registry records from the run's mcp_tool_calls
(the connector returns real JSON — no need to re-extract via schema).

Output: src/data/seed-trials.json

Auth: stored `custom.parallel` connector via dynamic credential surrogates.

Usage:
    python3 scripts/seed.py
"""
from __future__ import annotations

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

PROMPT = """Using the ClinicalTrials.gov connector, search for interventional \
trials sponsored by {sponsor} related to obesity, overweight, diabetes, or \
weight management, in Phase 2 or Phase 3. Include recruiting, active, and \
not-yet-recruiting studies. Return up to 15 trials, preferring the most \
recently updated. Briefly list each trial's NCT ID, title, phase, and status."""


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


def run_task(sponsor: str) -> dict:
    payload = {
        "input": PROMPT.format(sponsor=sponsor),
        "processor": "base",
        "advanced_settings": {"data_sources": {"free": ["clinical_trials"]}},
    }
    task = api("POST", "/v1/tasks/runs", payload)
    run_id = task["run_id"]
    print(f"[{sponsor}] run {run_id}", flush=True)
    deadline = time.time() + 600
    while time.time() < deadline:
        status = api("GET", f"/v1/tasks/runs/{run_id}")
        state = status.get("status")
        if state == "completed":
            return api("GET", f"/v1/tasks/runs/{run_id}/result")
        if state in ("failed", "cancelled"):
            raise SystemExit(f"[{sponsor}] run {state}: {status}")
        time.sleep(8)
    raise SystemExit(f"[{sponsor}] timed out waiting for {run_id}")


def try_parse(content) -> dict | list | None:
    """Parse content that may be JSON, double-encoded JSON, or junk."""
    if isinstance(content, (dict, list)):
        return content
    if not isinstance(content, str):
        return None
    for _ in range(3):
        try:
            parsed = json.loads(content)
        except (json.JSONDecodeError, TypeError):
            return None
        if isinstance(parsed, (dict, list)):
            # keep unwrapping if the dict is just {"...": "..."}? no — return it
            return parsed
        content = parsed
    return None


def extract_items(result: dict) -> list[dict]:
    """Pull registry records out of the run's clinical_trials tool calls."""
    items: list[dict] = []
    calls = (result.get("output") or {}).get("mcp_tool_calls") or []
    for call in calls:
        if call.get("server_name") != "clinical_trials":
            continue
        parsed = try_parse(call.get("content"))
        if isinstance(parsed, dict) and isinstance(parsed.get("items"), list):
            items.extend(parsed["items"])
    return items


def normalize_phase(raw) -> str:
    if isinstance(raw, list):
        raw = raw[0] if raw else ""
    mapping = {
        "PHASE1": "Phase 1",
        "PHASE2": "Phase 2",
        "PHASE3": "Phase 3",
        "PHASE4": "Phase 4",
        "PHASE1_PHASE2": "Phase 1/2",
        "PHASE2_PHASE3": "Phase 2/3",
        "NA": "N/A",
    }
    key = str(raw).strip().upper().replace(" ", "_")
    return mapping.get(key, str(raw))


def normalize(item: dict, sponsor: str) -> dict | None:
    nct = item.get("nct_id") or ""
    if not nct:
        return None

    def num(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "nctId": nct,
        "title": item.get("title", ""),
        "sponsor": item.get("sponsor") or sponsor,
        "phase": normalize_phase(item.get("phase", "")),
        "status": str(item.get("status", "UNKNOWN")).upper(),
        "conditions": item.get("conditions") or [],
        "interventions": item.get("interventions") or [],
        "studyType": item.get("study_type") or "INTERVENTIONAL",
        "enrollment": num(item.get("enrollment")),
        "startDate": item.get("start_date"),
        "primaryCompletionDate": item.get("primary_completion_date"),
        "lastUpdatePosted": item.get("last_updated") or item.get("last_update_posted"),
        "locationCount": num(item.get("locations_count")),
        "change": None,
        "enrichment": [],
        "citations": [
            {
                "title": f"ClinicalTrials.gov — {nct}",
                "url": f"https://clinicaltrials.gov/study/{nct}",
            }
        ],
    }


def main() -> None:
    all_trials: list[dict] = []
    for sponsor in SPONSORS:
        result = run_task(sponsor)
        items = extract_items(result)
        print(f"[{sponsor}] extracted {len(items)} records", flush=True)
        for it in items:
            t = normalize(it, sponsor)
            if t:
                all_trials.append(t)

    seen = set()
    deduped = []
    for t in all_trials:
        if t["nctId"] not in seen:
            seen.add(t["nctId"])
            deduped.append(t)

    with open(OUT_PATH, "w") as f:
        json.dump(deduped, f, indent=2)
    print(f"wrote {len(deduped)} trials to {OUT_PATH}", flush=True)


if __name__ == "__main__":
    main()
