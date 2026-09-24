import { SPONSORS } from "@/lib/types";

interface HeaderProps {
  activeSponsor: string; // "all" or sponsor id
  onSponsorChange: (id: string) => void;
  lastUpdated?: string;
  live: boolean;
}

export default function Header({
  activeSponsor,
  onSponsorChange,
  lastUpdated,
  live,
}: HeaderProps) {
  return (
    <header className="border-b border-grey-200 bg-off-white/95 backdrop-blur sticky top-0 z-20">
      <div className="max-w-7xl mx-auto px-6 pt-6 pb-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                Pipeline Watch
              </h1>
              <span
                className={`inline-flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                  live
                    ? "border-success/40 text-grey-700"
                    : "border-grey-300 text-grey-500"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    live ? "bg-success animate-pulse" : "bg-grey-400"
                  }`}
                />
                {live ? "LIVE" : "SEED DATA"}
              </span>
            </div>
            <p className="text-sm text-grey-600 mt-1 max-w-xl">
              Competitive clinical trial intelligence — new registrations, phase
              transitions, and status changes across GLP-1 pipelines, enriched
              with press, earnings, and FDA filings.
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-mono text-grey-500 uppercase tracking-wide">
              Powered by Parallel
            </p>
            <p className="text-[11px] font-mono text-grey-500 mt-0.5">
              connectors: clinical_trials · pubmed · pr newswire
            </p>
            {lastUpdated && (
              <p className="text-[11px] font-mono text-grey-500 mt-0.5">
                updated {lastUpdated}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-4 flex-wrap">
          <SponsorPill
            active={activeSponsor === "all"}
            onClick={() => onSponsorChange("all")}
            label="All sponsors"
          />
          {SPONSORS.map((s) => (
            <SponsorPill
              key={s.id}
              active={activeSponsor === s.id}
              onClick={() => onSponsorChange(s.id)}
              label={s.shortName}
              sub={s.focus}
            />
          ))}
        </div>
      </div>
    </header>
  );
}

function SponsorPill({
  active,
  onClick,
  label,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  sub?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-full text-[13px] font-medium border transition-colors cursor-pointer ${
        active
          ? "bg-index-black text-off-white border-index-black"
          : "bg-transparent text-grey-700 border-grey-300 hover:border-grey-500"
      }`}
    >
      {label}
      {sub && (
        <span
          className={`ml-1.5 text-[11px] font-normal ${
            active ? "text-grey-400" : "text-grey-500"
          }`}
        >
          {sub}
        </span>
      )}
    </button>
  );
}
