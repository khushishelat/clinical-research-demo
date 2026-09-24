"use client";

import { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import TrialCard from "@/components/TrialCard";
import TrialDetail from "@/components/TrialDetail";
import type { Trial } from "@/lib/types";

interface TrialsResponse {
  trials: Trial[];
  source: "seed" | "live";
  lastUpdated: string;
  count: number;
}

export default function Home() {
  const [data, setData] = useState<TrialsResponse | null>(null);
  const [sponsor, setSponsor] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/trials")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: TrialsResponse) => {
        setData(d);
        if (d.trials.length > 0) setSelectedId(d.trials[0].nctId);
      })
      .catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (sponsor === "all") return data.trials;
    const id = sponsor.toLowerCase();
    return data.trials.filter(
      (t) =>
        t.sponsor.toLowerCase().includes(id) ||
        (id === "lilly" && t.sponsor.toLowerCase().includes("eli lilly")) ||
        (id === "novo" && t.sponsor.toLowerCase().includes("novo nordisk"))
    );
  }, [data, sponsor]);

  const selected = useMemo(
    () => data?.trials.find((t) => t.nctId === selectedId) ?? null,
    [data, selectedId]
  );

  const stats = useMemo(() => {
    const trials = filtered;
    return {
      total: trials.length,
      phase3: trials.filter((t) => t.phase === "Phase 3").length,
      recruiting: trials.filter((t) => t.status === "RECRUITING").length,
      withSignals: trials.filter((t) => t.enrichment.length > 0).length,
    };
  }, [filtered]);

  return (
    <div className="min-h-screen flex flex-col">
      <Header
        activeSponsor={sponsor}
        onSponsorChange={(id) => {
          setSponsor(id);
          setSelectedId(null);
        }}
        lastUpdated={data?.lastUpdated}
        live={data?.source === "live"}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
        {error && (
          <div className="rounded-lg border border-error/40 bg-error/10 px-4 py-3 text-sm">
            Couldn&apos;t load trial data: {error}
          </div>
        )}

        {!data && !error && (
          <div className="py-24 text-center text-grey-500 text-sm font-mono animate-pulse">
            Loading pipeline…
          </div>
        )}

        {data && (
          <>
            {/* Stats strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <Stat label="Trials tracked" value={stats.total} />
              <Stat label="Phase 3" value={stats.phase3} accent />
              <Stat label="Recruiting" value={stats.recruiting} accent />
              <Stat label="With signals" value={stats.withSignals} accent />
            </div>

            {/* Feed + detail */}
            <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
              <section className="rounded-xl border border-grey-200 bg-white overflow-hidden">
                <div className="px-5 py-3 border-b border-grey-200 flex items-center justify-between">
                  <h2 className="text-[12px] font-mono uppercase tracking-wide text-grey-600">
                    Trial feed
                  </h2>
                  <span className="text-[11px] font-mono text-grey-500">
                    {filtered.length} shown
                  </span>
                </div>
                <div className="max-h-[720px] overflow-y-auto">
                  {filtered.length === 0 && (
                    <p className="px-5 py-10 text-sm text-grey-500 text-center">
                      No trials in this view yet.
                    </p>
                  )}
                  {filtered.map((t) => (
                    <TrialCard
                      key={t.nctId}
                      trial={t}
                      selected={t.nctId === selectedId}
                      onSelect={() => setSelectedId(t.nctId)}
                    />
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-grey-200 bg-white lg:sticky lg:top-32 max-h-[780px] overflow-y-auto">
                <TrialDetail trial={selected} />
              </section>
            </div>

            {/* Provenance footer */}
            <footer className="mt-10 border-t border-grey-200 pt-4 pb-8 flex justify-between gap-4 flex-wrap">
              <p className="text-[11px] font-mono text-grey-500 max-w-2xl leading-relaxed">
                Registry records via the Parallel clinical_trials connector
                (ClinicalTrials.gov). Enrichment via Parallel web research.
                Change detection: snapshot monitors diffing registry fields
                between runs. Every claim carries its source.
              </p>
              <p className="text-[11px] font-mono text-grey-400">
                demo · not medical advice
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-grey-200 bg-white px-4 py-3">
      <p
        className={`text-2xl font-semibold font-mono ${accent && value > 0 ? "text-brand" : ""}`}
      >
        {value}
      </p>
      <p className="text-[11px] font-mono uppercase tracking-wide text-grey-500 mt-0.5">
        {label}
      </p>
    </div>
  );
}
