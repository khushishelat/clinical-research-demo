import { NextResponse } from "next/server";
import type { Trial } from "@/lib/types";
import seedTrials from "@/data/seed-trials.json";

export const dynamic = "force-dynamic";

/**
 * Serves the trial watchlist.
 * - If PARALLEL_API_KEY is set, this route can trigger a live refresh via
 *   the Task API (wired up separately); for now it always serves the
 *   seeded baseline so the demo is deterministic and fast.
 */
export async function GET() {
  const trials = (seedTrials as Trial[]) ?? [];
  return NextResponse.json({
    trials,
    lastUpdated: process.env.SEED_UPDATED_AT ?? new Date().toISOString().slice(0, 10),
    live: Boolean(process.env.PARALLEL_API_KEY),
  });
}
