import { NextResponse } from "next/server";
import type { Trial } from "@/lib/types";
import seedTrials from "@/data/seed-trials.json";

export const dynamic = "force-dynamic";

/**
 * Serves the trial watchlist.
 *
 * The seed baseline was pulled from ClinicalTrials.gov via Parallel's
 * clinical_trials connector (see scripts/seed.py), so it is real
 * registry data — just not refreshed on a schedule yet. The `source`
 * label says "seed" honestly; live scheduled refresh via snapshot
 * monitors is the follow-up.
 */
export async function GET() {
  const trials = (seedTrials as Trial[]) ?? [];
  return NextResponse.json({
    trials,
    source: "seed" as const,
    lastUpdated: process.env.SEED_UPDATED_AT ?? new Date().toISOString().slice(0, 10),
    count: trials.length,
  });
}
