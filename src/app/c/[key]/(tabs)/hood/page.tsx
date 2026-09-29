import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { notFound } from 'next/navigation';
import { Disclaimer } from '@/components/ui';
import type { CompactEvent } from '@/lib/domain/events';
import type { CompanyConfig } from '@/lib/domain/types';
import { companyByKey, ctx } from '@/lib/server/context';
import { buildRunInputs } from '@/lib/server/runs';
import { domainOf } from '@/lib/view/format';
import { namesOf } from '@/lib/view/names';
import { getView } from '../../data';

export const dynamic = 'force-dynamic';

type ReplayFile = { duration_s: number; runs: { run: string; start: number; end: number }[]; events: CompactEvent[] };

export default async function HoodPage({ params }: PageProps<'/c/[key]/hood'>) {
  const { key } = await params;
  const view = await getView(key);
  if (!view) notFound();
  const { pack } = view;
  const c = ctx();
  const company: CompanyConfig = companyByKey(key, c) ?? { key, name: pack.about.company, match: pack.about.company.toLowerCase(), aliases: [], lead_asset: '' };
  const stage1 = pack.rows.map(({ check: _c, ...r }) => r);
  const { inputs } = buildRunInputs({ company, today: pack.about.recorded, stage1, tag: { app: 'trial-check', job: 'refresh' } });
  const replay = await readFile(join(process.cwd(), 'fixtures/replay', `${key}.json`), 'utf8').then((s) => JSON.parse(s) as ReplayFile, () => null);
  const names = namesOf(pack);

  // The example check: the first registry lag, else the first checked company trial.
  const example = pack.rows.find((r) => r.check?.flag === 'registry_lagging') ?? pack.rows.find((r) => r.check && r.role === 'company_led') ?? pack.rows.find((r) => r.check);
  const exRun = example ? `trial_check:${example.nct_id}` : null;
  const exEvents = replay && exRun ? replay.events.filter((e) => e.run === exRun) : [];

  const logs = [...pack.rows.flatMap((r) => r.check?.connector_log ?? []), ...(pack.snapshot_connector_log ?? []), ...(pack.mechanism_connector_log ?? [])];
  const byConnector: Record<string, Record<string, number>> = {};
  for (const l of logs) (byConnector[l.connector] ??= {})[l.tool] = (byConnector[l.connector][l.tool] ?? 0) + 1;
  const citations = pack.rows.reduce((n, r) => n + (r.check?.citations ?? 0), 0);
  const checked = pack.rows.filter((r) => r.check).length;
  const runs = checked + (pack.snapshot ? 1 : 0) + (pack.mechanism ? 1 : 0);

  const trialInput = inputs.find((i) => (i.metadata as { nct_id?: string } | null)?.nct_id === example?.nct_id) ?? inputs[2];
  const request = {
    inputs: [summarize(inputs[0]), summarize(inputs[1]), summarize(trialInput), `… ${Math.max(0, inputs.length - 3)} more trial checks`],
  };

  return (
    <div className="-mx-4 mt-6 bg-machine px-4 pb-10 pt-8 font-mono text-[13px] leading-[1.25rem] text-machine-text sm:-mx-8 sm:px-8">
      <p className="text-[#858483]">{'// '}how the {pack.about.company} check ran</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] uppercase">
        <Step n={1} label="Find" detail={`ClinicalTrials.gov API v2 · ${pack.rows.length} trials · under a second`} />
        <span className="text-[#858483]">→</span>
        <Step n={2} label="Research" detail={`1 Task Group · 3 task specs · ${runs} runs`} />
        <span className="text-[#858483]">→</span>
        <Step n={3} label="Join" detail="code matches trial IDs and sets flags" />
      </div>
      <div className="mt-6 flex flex-wrap gap-8 border-y border-machine-line py-4 text-[12px] uppercase">
        <Stat k="Runs" v={runs} />
        <Stat k="Connector calls" v={logs.length} />
        <Stat k="Citations" v={citations} />
        <Stat k="Found beyond registry" v={pack.found_beyond_registry_search.length} />
        {replay ? <Stat k="Wall time" v={`about ${Math.round(replay.duration_s / 60)} min`} /> : null}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <Head>Request · POST /v1/tasks/groups/{pack.about.taskgroup_id}/runs</Head>
          <pre className="mt-2 overflow-auto rounded-[4px] border border-machine-line p-4 text-[12px]">{JSON.stringify(request, null, 2)}</pre>
          <p className="mt-2 text-[#adadac]">
            Added with retries off. If a response is lost, the app lists the group&apos;s runs by metadata and adds only what is missing, so nothing is billed twice.
          </p>
        </section>
        <section>
          <Head>
            Events · {example ? names[example.nct_id] : ''} check{example?.check?.seconds ? ` · completed · ${example.check.seconds} s` : ''}
          </Head>
          <ul className="mt-2 max-h-[420px] space-y-1 overflow-auto rounded-[4px] border border-machine-line p-4 text-[12px]">
            {exEvents.length ? (
              exEvents.map((e, i) => (
                <li key={i} className="grid grid-cols-[48px_150px_minmax(0,1fr)] gap-2">
                  <span className="text-[#858483]">{e.t}s</span>
                  <span className="text-[#adadac]">{e.k === 'tool' ? 'progress_msg.tool_call' : e.k === 'search' ? 'progress_msg.search' : e.k === 'extract' ? 'progress_msg.extract' : e.k === 'stats' ? 'progress_stats' : 'task_run.state'}</span>
                  <span className="truncate">
                    {e.k === 'tool' ? (
                      <>
                        MCP tool call on <span className="text-page">{e.connector}</span> · {e.tool}
                      </>
                    ) : e.k === 'search' ? (
                      e.m
                    ) : e.k === 'extract' ? (
                      `Extract: ${e.url.replace(/^https?:\/\//, '')}`
                    ) : e.k === 'stats' ? (
                      `considered ${e.considered} · read ${e.read}`
                    ) : (
                      `status: ${e.status}`
                    )}
                  </span>
                </li>
              ))
            ) : (
              <li className="text-[#adadac]">No event log recorded for this company.</li>
            )}
          </ul>
        </section>
        {example?.check ? (
          <section>
            <Head>Output · {names[example.nct_id]}</Head>
            <pre className="mt-2 overflow-auto rounded-[4px] border border-machine-line p-4 text-[12px]">
              {JSON.stringify({ latest_milestone: example.check.latest_milestone, next_catalyst: example.check.next_catalyst && { timing_text: example.check.next_catalyst.timing_text, earliest: example.check.next_catalyst.earliest, latest: example.check.next_catalyst.latest } }, null, 2)}
              {'\n\n// set in code, not by the model\n'}
              {JSON.stringify({ registry_status: example.status, flag: example.check.flag }, null, 2)}
            </pre>
          </section>
        ) : null}
        <section>
          <Head>mcp_tool_calls · all {runs} runs</Head>
          <div className="mt-2 space-y-2 rounded-[4px] border border-machine-line p-4 text-[12px]">
            {['clinical_trials', 'pubmed', 'chembl', 'biorxiv'].map((cn) => {
              const tools = byConnector[cn] ?? {};
              const total = Object.values(tools).reduce((a, b) => a + b, 0);
              return (
                <p key={cn}>
                  <span className="text-page">{cn}</span> <span className="text-[#adadac]">{total}</span>
                  {total ? ` · ${Object.entries(tools).map(([t, n]) => `${t} ${n}`).join(' · ')}` : ' · enabled, never called'}
                </p>
              );
            })}
          </div>
          {example?.check ? (
            <>
              <Head className="mt-6">basis · per field</Head>
              <div className="mt-2 space-y-1 rounded-[4px] border border-machine-line p-4 text-[12px]">
                {example.check.basis
                  .filter((b) => !b.field.includes('.'))
                  .map((b) => (
                    <p key={b.field}>
                      <span className="text-page">{b.field}</span> <span className="text-[#858483]">←</span> {b.citations.map((ci) => domainOf(ci.url)).join(', ') || 'no citation'}
                      {b.confidence ? <span className="text-[#858483]"> · {b.confidence}</span> : null}
                    </p>
                  ))}
              </div>
            </>
          ) : null}
        </section>
        <section>
          <Head>Competitive set · {pack.mechanism?.competitors.length ?? 0} same-mechanism programs</Head>
          <p className="mt-2 text-[#adadac]">
            ChEMBL targets for the lead asset and molecules on the same targets, ranked by highest phase reached.{' '}
            <a href={`/c/${key}/competitive`} className="text-page underline decoration-machine-line underline-offset-4 hover:decoration-page">
              Open the full view →
            </a>
          </p>
        </section>
      </div>
      <p className="mt-8 text-[#adadac]">
        Group events are followed with last_event_id and a small pool of run event streams; when a stream drops, the app lists the group&apos;s runs and fetches any finished run it missed.
      </p>
      <div className="text-[#adadac] [&_footer]:border-machine-line [&_footer]:text-[#adadac]">
        <Disclaimer />
      </div>
    </div>
  );
}

function summarize(input: ReturnType<typeof buildRunInputs>['inputs'][number] | undefined) {
  if (!input) return null;
  const kind = (input.metadata as { kind?: string } | null)?.kind;
  const spec = kind === 'snapshot' ? 'COMPANY_SNAPSHOT' : kind === 'mechanism' ? 'MECHANISM' : 'TRIAL_CHECK';
  return { processor: input.processor, task_spec: `<${spec}>`, input: input.input, metadata: input.metadata, advanced_settings: input.advanced_settings };
}

function Step({ n, label, detail }: { n: number; label: string; detail: string }) {
  return (
    <span className="rounded-[4px] border border-machine-line px-3 py-2">
      <span className="text-page">
        {n} · {label}
      </span>{' '}
      <span className="normal-case text-[#adadac]">· {detail}</span>
    </span>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return (
    <span>
      <span className="text-[#adadac]">{k}</span> <span className="text-page">{v}</span>
    </span>
  );
}

function Head({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <h3 className={`text-[11px] uppercase tracking-[0.06em] text-[#adadac] ${className}`}>{children}</h3>;
}
