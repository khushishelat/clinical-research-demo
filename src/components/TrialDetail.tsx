import type { Trial, EnrichmentItem } from "@/lib/types";

const KIND_STYLE: Record<EnrichmentItem["kind"], { label: string; cls: string }> = {
  PRESS_RELEASE: { label: "Press release", cls: "bg-brand-wash text-grey-800" },
  EARNINGS: { label: "Earnings", cls: "bg-grey-200 text-grey-700" },
  FDA_FILING: { label: "FDA filing", cls: "bg-info/15 text-grey-800" },
  PUBLICATION: { label: "Publication", cls: "bg-success/15 text-grey-800" },
  NEWS: { label: "News", cls: "bg-grey-200 text-grey-700" },
};

export default function TrialDetail({ trial }: { trial: Trial | null }) {
  if (!trial) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px] text-grey-500 text-sm px-8 text-center">
        Select a trial to inspect its registry record, detected changes, and
        enrichment.
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      {/* Registry record */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-grey-500">{trial.nctId}</span>
        <a
          href={`https://clinicaltrials.gov/study/${trial.nctId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] font-mono text-brand hover:underline"
        >
          registry ↗
        </a>
      </div>
      <h2 className="text-xl font-semibold tracking-tight leading-snug mt-2">
        {trial.title}
      </h2>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mt-4 text-[13px]">
        <Field label="Sponsor" value={trial.sponsor} />
        <Field label="Phase" value={trial.phase} />
        <Field label="Status" value={trial.status.replaceAll("_", " ")} />
        <Field
          label="Enrollment"
          value={trial.enrollment != null ? trial.enrollment.toLocaleString() : "—"}
          mono
        />
        <Field label="Study type" value={trial.studyType} />
        <Field
          label="Sites"
          value={trial.locationCount != null ? String(trial.locationCount) : "—"}
          mono
        />
        <Field label="Start" value={trial.startDate ?? "—"} mono />
        <Field label="Primary completion" value={trial.primaryCompletionDate ?? "—"} mono />
        <Field label="Last update" value={trial.lastUpdatePosted ?? "—"} mono />
      </dl>

      {(trial.conditions.length > 0 || trial.interventions.length > 0) && (
        <div className="mt-4 space-y-2 text-[13px]">
          {trial.conditions.length > 0 && (
            <TagRow label="Conditions" items={trial.conditions} />
          )}
          {trial.interventions.length > 0 && (
            <TagRow label="Interventions" items={trial.interventions} />
          )}
        </div>
      )}

      {/* Detected change */}
      {trial.change && (
        <div className="mt-6 rounded-lg border border-brand/30 bg-brand-wash/30 p-4">
          <p className="text-[11px] font-mono uppercase tracking-wide text-grey-600">
            Detected change · {trial.change.detectedAt}
          </p>
          <p className="text-[15px] font-medium mt-1">{trial.change.detail}</p>
          {trial.change.basis.length > 0 && (
            <div className="mt-2">
              {trial.change.basis.map((c, i) => (
                <Cite key={i} title={c.title} url={c.url} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Enrichment */}
      <div className="mt-6">
        <h3 className="text-[11px] font-mono uppercase tracking-wide text-grey-500">
          Enrichment · {trial.enrichment.length}
        </h3>
        {trial.enrichment.length === 0 ? (
          <p className="text-[13px] text-grey-500 mt-2">
            No press, earnings, or filing signals linked yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {trial.enrichment.map((e, i) => (
              <li key={i} className="border-l-2 border-grey-300 pl-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${KIND_STYLE[e.kind].cls}`}
                  >
                    {KIND_STYLE[e.kind].label}
                  </span>
                  {e.date && (
                    <span className="text-[11px] font-mono text-grey-500">
                      {e.date}
                    </span>
                  )}
                </div>
                <a
                  href={e.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[14px] font-medium leading-snug hover:underline block mt-1"
                >
                  {e.headline}
                </a>
                <p className="text-[13px] text-grey-600 mt-0.5 leading-relaxed">
                  {e.summary}
                </p>
                <p className="text-[11px] font-mono text-grey-500 mt-1">
                  {e.source}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Citations */}
      {trial.citations.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[11px] font-mono uppercase tracking-wide text-grey-500">
            Sources · {trial.citations.length}
          </h3>
          <div className="mt-2 space-y-1">
            {trial.citations.map((c, i) => (
              <Cite key={i} title={c.title} url={c.url} numbered={i + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-mono uppercase tracking-wide text-grey-500">
        {label}
      </dt>
      <dd className={`mt-0.5 ${mono ? "font-mono text-[12px]" : ""}`}>{value}</dd>
    </div>
  );
}

function TagRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex gap-2 items-start">
      <span className="text-[11px] font-mono uppercase tracking-wide text-grey-500 shrink-0 pt-0.5 w-24">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((t, i) => (
          <span
            key={i}
            className="text-[12px] px-2 py-0.5 rounded-full bg-grey-100 border border-grey-200"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function Cite({
  title,
  url,
  numbered,
}: {
  title: string;
  url: string;
  numbered?: number;
}) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[12px] text-grey-600 hover:text-brand hover:underline block truncate"
    >
      {numbered != null && (
        <span className="font-mono text-grey-400 mr-1">[{numbered}]</span>
      )}
      {title}
    </a>
  );
}
