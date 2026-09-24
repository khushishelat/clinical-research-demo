import type { Trial, ChangeType } from "@/lib/types";

const CHANGE_STYLE: Record<ChangeType, string> = {
  NEW: "bg-brand text-white",
  PHASE_CHANGE: "bg-index-black text-off-white",
  STATUS_CHANGE: "bg-info text-white",
};

const CHANGE_LABEL: Record<ChangeType, string> = {
  NEW: "NEW",
  PHASE_CHANGE: "PHASE CHANGE",
  STATUS_CHANGE: "STATUS CHANGE",
};

const STATUS_DOT: Record<string, string> = {
  RECRUITING: "bg-success",
  ACTIVE_NOT_RECRUITING: "bg-info",
  COMPLETED: "bg-grey-400",
  NOT_YET_RECRUITING: "bg-brand",
  SUSPENDED: "bg-error",
  TERMINATED: "bg-error",
  WITHDRAWN: "bg-grey-500",
  UNKNOWN: "bg-grey-300",
};

function formatStatus(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export default function TrialCard({
  trial,
  selected,
  onSelect,
}: {
  trial: Trial;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-5 py-4 border-b border-grey-200 transition-colors cursor-pointer ${
        selected ? "bg-brand-wash/40" : "hover:bg-grey-100/70"
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {trial.change && (
          <span
            className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${CHANGE_STYLE[trial.change.type]}`}
          >
            {CHANGE_LABEL[trial.change.type]}
          </span>
        )}
        <span className="text-[11px] font-mono text-grey-500">
          {trial.nctId}
        </span>
        <span className="text-[11px] font-mono text-grey-400 ml-auto">
          {trial.phase}
        </span>
      </div>

      <h3 className="text-[15px] font-medium leading-snug mt-1.5 line-clamp-2">
        {trial.title}
      </h3>

      <div className="flex items-center gap-3 mt-2 text-[12px] text-grey-600">
        <span className="font-medium text-grey-700">{trial.sponsor}</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[trial.status] ?? "bg-grey-300"}`}
          />
          {formatStatus(trial.status)}
        </span>
        {trial.enrollment != null && (
          <span className="font-mono text-[11px]">
            n={trial.enrollment.toLocaleString()}
          </span>
        )}
      </div>

      {trial.change && (
        <p className="text-[12px] text-grey-600 mt-1.5 font-mono">
          {trial.change.detail}
        </p>
      )}
    </button>
  );
}
