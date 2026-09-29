import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Ask } from '@/components/Ask';
import { CheckedWith } from '@/components/Landscape';
import { LiveFlag, LiveStatus } from '@/components/LiveFlag';
import { Card, Chip, ConnectorMarker, Disclaimer, HandChecked, Label, RoleBadge, SourceChip, Unconfirmed } from '@/components/ui';
import { nctIdsIn } from '@/lib/domain/programs';
import type { BasisEntry, Milestone, RegistryRecord } from '@/lib/domain/types';
import { daysBetween, fmtDate, milestoneLabel, phaseShort, statusLabel } from '@/lib/view/format';
import { namesOf } from '@/lib/view/names';
import { getView } from '../../../data';

export const dynamic = 'force-dynamic';

export default async function TrialPage({ params }: PageProps<'/c/[key]/t/[nct]'>) {
  const { key, nct } = await params;
  const view = await getView(key);
  if (!view || !/^NCT\d{8}$/.test(nct)) notFound();
  const { pack } = view;
  const row = pack.rows.find((r) => r.nct_id === nct);
  const found = row ? undefined : pack.found_beyond_registry_search.find((f) => f.nct_id === nct);
  if (!row && !found) notFound();
  const names = namesOf(pack);
  const check = row?.check ?? found?.check ?? null;
  const rec = check?.registry_record ?? null;
  const program = pack.snapshot?.programs.find((p) => p.key_trials.flatMap(nctIdsIn).includes(nct));
  const status = row?.status ?? found?.registry?.status ?? '';
  const updated = row?.last_update_posted ?? null;
  const m = check?.latest_milestone && check.latest_milestone.type !== 'no_public_update' ? check.latest_milestone : null;
  const basis = (field: string) => check?.basis.find((b) => b.field === field);
  const pubmedCalls = check?.connector_log.filter((l) => l.connector === 'pubmed') ?? [];
  const trialCalls = check?.connector_log.filter((l) => l.connector === 'clinical_trials') ?? [];
  const hand = check?.hand_checked ?? [];
  const unverified = (pack.review ?? []).filter((r) => r.nct_id === nct && r.verdict === 'unverified');
  const title = rec?.title ?? row?.title ?? found?.registry?.title ?? '';
  const sponsor = row?.lead_sponsor ?? found?.registry?.lead_sponsor ?? '';
  const flag = check?.flag;

  return (
    <div className="pb-8">
      <p className="mt-8 font-mono text-[12px] uppercase tracking-[0.05em] text-muted">
        <Link href={`/c/${key}`} className="hover:text-ink">
          ← {pack.about.company} · Landscape
        </Link>
        {program ? <span> · {program.asset.split('(')[0].trim()}</span> : null}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h2 className="text-[36px] leading-tight">{names[nct]}</h2>
        <RoleBadge role={row?.role ?? 'partner_led'} />
        {found ? <Chip tone="dashed">Found by research</Chip> : null}
        {check ? <LiveFlag keyName={key} nctId={nct} recorded={flag} /> : null}
      </div>
      <p className="mt-2 max-w-[860px] text-[16px] text-muted">{title}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[12px] text-muted">
        <span>{phaseShort(row?.phases ?? found?.registry?.phase ?? '')}</span>
        <span>· Sponsor: {sponsor}</span>
        <a href={`https://clinicaltrials.gov/study/${nct}`} target="_blank" rel="noreferrer" className="rounded-[3px] border border-line-strong px-2 py-0.5 text-ink hover:border-ink">
          {nct} ↗
        </a>
        <span>· Rechecked weekly · next {fmtDate(view.refresh.next, { year: false })}</span>
      </div>
      {check ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CheckedWith calls={check.connector_calls} citations={check.citations} seconds={check.seconds} />
          <HandChecked checks={hand} />
        </div>
      ) : (
        <p className="mt-3 text-[14px] text-muted">Not checked yet · in the {fmtDate(view.refresh.next, { year: false })} check. The registry record below is live.</p>
      )}
      {check?.updated_by ? <p className="mt-2 font-mono text-[11px] uppercase text-muted">Updated from a Monitor event · {fmtDate(check.updated_by.date)} · {check.updated_by.summary}</p> : null}

      <Card className="mt-8 p-6">
        <Label>Registry vs. latest news</Label>
        {m && updated ? <p className="mt-2 text-[18px]">{comparison(status, updated, m)}</p> : null}
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <Label>ClinicalTrials.gov</Label>
            <p className="mt-1 text-[20px]">
              <LiveStatus keyName={key} nctId={nct} recorded={status} />
            </p>
            {updated ? <p className="text-[13px] text-muted">Last updated {fmtDate(updated)}</p> : null}
            <div className="mt-2">
              <SourceChip url={`https://clinicaltrials.gov/study/${nct}`} date={updated} />
            </div>
          </div>
          <div>
            <Label>Latest news</Label>
            {m ? (
              <>
                <p className="mt-1 text-[20px]">{milestoneLabel(m.type)}</p>
                <p className="mt-1 text-[14px]">{m.description}</p>
                <Sources basis={basis('latest_milestone')} fallback={m.source_url} nct={nct} date={m.date} />
              </>
            ) : (
              <p className="mt-1 text-[15px] text-muted">{check ? 'No dated public update found for this trial.' : 'Not checked yet.'}</p>
            )}
          </div>
        </div>
        {rec && rec.sites ? <SiteStatus rec={rec} calls={trialCalls} /> : null}
      </Card>

      {rec ? <RegistryRecordDrawer rec={rec} nct={nct} calls={trialCalls} /> : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h3 className="text-[18px]">Timeline</h3>
          <Timeline updated={updated} milestones={[...(check?.earlier_milestones ?? []), ...(m ? [m] : [])]} catalyst={check?.next_catalyst ?? null} />
        </Card>
        <Card className="p-6">
          <h3 className="text-[18px]">Next catalyst</h3>
          {check?.next_catalyst?.description ? (
            <>
              <p className="mt-2 text-[16px]">{check.next_catalyst.timing_text}</p>
              <p className="mt-1 text-[14px]">{check.next_catalyst.description}</p>
              {check.next_catalyst.stated_by ? <p className="mt-1 text-[12px] text-muted">Stated by {check.next_catalyst.stated_by}</p> : null}
              {check.next_catalyst.earliest !== check.next_catalyst.latest ? <p className="mt-1 text-[12px] text-muted">Guided window, not a data date.</p> : null}
              <Sources basis={basis('next_catalyst')} nct={nct} />
            </>
          ) : (
            <p className="mt-2 text-[14px] text-muted">Not guided.</p>
          )}
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[18px]">Results and publications</h3>
          <ConnectorMarker connector="pubmed" calls={pubmedCalls} />
        </div>
        {check?.results_publications.length ? (
          <ul className="mt-3 space-y-2 text-[14px]">
            {check.results_publications.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        ) : (
          <div className="mt-3">
            <p className="text-[32px] leading-none">0</p>
            <p className="text-[14px]">papers found for this trial</p>
            <p className="mt-2 text-[13px] text-muted">
              {rec?.has_results ? 'The registry has posted results.' : 'No results posted on the registry either.'}
              {pubmedCalls.length ? ` An honest zero: ${pubmedCalls.length} PubMed ${pubmedCalls.length === 1 ? 'search' : 'searches'} ran.` : check ? ' PubMed was available and not called for this trial.' : ''}
            </p>
          </div>
        )}
        {pubmedCalls.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {pubmedCalls.map((c, i) => (
              <li key={i} className="rounded-[3px] bg-wash px-2 py-1 font-mono text-[11px]">
                {queryOf(c.arguments)}
              </li>
            ))}
          </ul>
        ) : null}
        {unverified.map((u) => (
          <p key={u.claim} className="mt-3 text-[14px]">
            <Unconfirmed note={u.note}>{u.claim}</Unconfirmed>
          </p>
        ))}
      </Card>

      {rec ? (
        <Card className="mt-6 p-6">
          <h3 className="text-[18px]">Sites</h3>
          <p className="mt-1 text-[13px] text-muted">From the registry record · shown at country level · site contacts are in the record and not shown, because they name real people.</p>
          <p className="mt-3 text-[15px]">
            {rec.sites} sites in {rec.countries.length} {rec.countries.length === 1 ? 'country' : 'countries'}: {rec.countries.slice(0, 18).join(', ')}
            {rec.countries.length > 18 ? '…' : ''}
          </p>
        </Card>
      ) : null}

      <Ask keyName={key} company={pack.about.company} nctId={nct} trialName={names[nct]} />
      <Disclaimer />
    </div>
  );
}

function comparison(status: string, updated: string, m: Milestone): string {
  if (!m.date) return `The registry says ${statusLabel(status)}.`;
  const gap = daysBetween(m.date, updated);
  if (m.type === 'enrollment_completed' && ['RECRUITING', 'NOT_YET_RECRUITING', 'ENROLLING_BY_INVITATION'].includes(status)) {
    return gap > 0
      ? `The registry was updated ${gap} days after the disclosure but still says ${statusLabel(status)}.`
      : `The company disclosed enrollment complete on ${fmtDate(m.date)}; the registry, last updated ${fmtDate(updated)}, still says ${statusLabel(status)}.`;
  }
  return `Latest public news ${fmtDate(m.date)}; registry last updated ${fmtDate(updated)}.`;
}

function Sources({ basis, fallback, nct, date }: { basis?: BasisEntry; fallback?: string | null; nct: string; date?: string | null }) {
  const urls = [...new Set([...(basis?.citations ?? []).map((c) => c.url), ...(fallback ? [fallback] : [])])];
  if (!urls.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {urls.slice(0, 4).map((u) => (
        <SourceChip key={u} url={u} nctId={nct} date={u === fallback ? date : undefined} />
      ))}
    </div>
  );
}

const STATUS_ORDER = ['RECRUITING', 'ACTIVE_NOT_RECRUITING', 'NOT_YET_RECRUITING', 'COMPLETED', 'WITHDRAWN', 'TERMINATED'];

function SiteStatus({ rec, calls }: { rec: RegistryRecord; calls: { tool: string; arguments: string }[] }) {
  const entries = Object.entries(rec.site_status).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  const top = entries[0];
  return (
    <div className="mt-6 border-t border-line pt-5">
      <div className="flex h-3 overflow-hidden rounded-full bg-wash">
        {entries.map(([k, v]) => (
          <div key={k} title={`${v} ${statusLabel(k)}`} style={{ width: `${(v / total) * 100}%` }} className={k === 'RECRUITING' ? 'bg-orange' : k === 'ACTIVE_NOT_RECRUITING' ? 'bg-ink' : 'bg-line-strong'} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 font-mono text-[11px] uppercase">
        {entries
          .sort((a, b) => STATUS_ORDER.indexOf(a[0]) - STATUS_ORDER.indexOf(b[0]))
          .map(([k, v]) => (
            <span key={k}>
              {v} {statusLabel(k)}
            </span>
          ))}
      </div>
      {top ? (
        <p className="mt-3 text-[15px]">
          {top[1]} of {total} sites show &quot;{statusLabel(top[0])}&quot;.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <ConnectorMarker connector="clinical_trials" calls={calls} />
        <Label>From the registry record alone · no web source</Label>
      </div>
    </div>
  );
}

function RegistryRecordDrawer({ rec, nct, calls }: { rec: RegistryRecord; nct: string; calls: { tool: string; arguments: string }[] }) {
  const rows: [string, string][] = [
    ['NCT ID', nct],
    ['Official title', rec.title ?? ''],
    ['Acronym', rec.acronym ?? '—'],
    ['Enrollment', rec.enrollment ? rec.enrollment.toLocaleString('en-US') : '—'],
    ['Start date', fmtDate(rec.start_date)],
    ['Primary completion', fmtDate(rec.primary_completion_date)],
    ['Completion', fmtDate(rec.completion_date)],
    ['Interventions', rec.interventions.join(' · ')],
    ['Primary outcomes', rec.primary_outcomes.join(' · ')],
    ['Secondary outcomes', String(rec.secondary_outcome_count)],
    ['Results posted', rec.has_results ? 'Yes' : 'No'],
    ['Sites', `${rec.sites} in ${rec.countries.length} countries`],
    ['Site contacts', 'In the record, not shown. They name real people.'],
  ];
  return (
    <details className="group mt-4 rounded-[4px] border border-line bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4">
        <span className="font-mono text-[12px] uppercase tracking-[0.05em]">Full registry record</span>
        <span className="font-mono text-[12px] group-open:rotate-90">▸</span>
      </summary>
      <div className="border-t border-line px-6 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <ConnectorMarker connector="clinical_trials" calls={calls} />
          <code className="rounded-[3px] bg-wash px-2 py-0.5 font-mono text-[11px]">
            clinical_trials.get_trial_details {calls.find((c) => c.tool === 'get_trial_details')?.arguments ?? ''}
          </code>
        </div>
        <p className="mt-2 text-[13px] text-muted">Connector output from the recorded check. Nothing here is edited by the model.</p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-[200px_minmax(0,1fr)]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-mono text-[11px] uppercase text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </details>
  );
}

function Timeline({ updated, milestones, catalyst }: { updated: string | null; milestones: Milestone[]; catalyst: { earliest: string | null; latest: string | null; timing_text: string | null } | null }) {
  const dated = milestones.filter((m) => m.date).sort((a, b) => a.date!.localeCompare(b.date!));
  const items = [
    ...dated.map((m) => ({ date: m.date!, kind: 'disclosure' as const, text: `${milestoneLabel(m.type)}` })),
    ...(updated ? [{ date: updated, kind: 'registry' as const, text: 'Registry updated' }] : []),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (!items.length) return <p className="mt-2 text-[14px] text-muted">No dated events.</p>;
  return (
    <ol className="mt-4 space-y-3 border-l border-line pl-4">
      {items.map((it, i) => (
        <li key={i} className="relative text-[14px]">
          <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ${it.kind === 'registry' ? 'border border-ink bg-card' : 'bg-ink'}`} />
          <span className="font-mono text-[12px] text-muted">{fmtDate(it.date)}</span> · {it.text}
          {it.kind === 'registry' ? <span className="text-muted"> (ClinicalTrials.gov)</span> : null}
        </li>
      ))}
      {catalyst?.latest ? (
        <li className="relative text-[14px]">
          <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-dashed border-ink bg-card" />
          <span className="font-mono text-[12px] text-muted">{catalyst.timing_text}</span> · Next catalyst
        </li>
      ) : null}
    </ol>
  );
}

function queryOf(args: string) {
  try {
    return JSON.parse(args).query ?? args;
  } catch {
    return args.slice(0, 80);
  }
}
