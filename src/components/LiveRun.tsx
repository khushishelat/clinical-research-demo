'use client';

// A live run, shown as the landscape filling in (HANDOFF-v2.1 section 6):
// the registry table first, a quick take from the Responses API, then rows
// fill in place as each check lands, and the pipeline arrives last.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CompactEvent } from '@/lib/domain/events';
import type { TrialCheck, TrialRow } from '@/lib/domain/types';
import type { AskEvent } from '@/lib/server/ask';
import type { StreamMessage } from '@/lib/server/stream';
import { fmtDate, milestoneLabel, phaseShort, roleLabel, statusLabel, trialName } from '@/lib/view/format';
import { readSse } from './Ask';
import { CheckedWith } from './Landscape';
import { Card, Chip, connectorName, cx, FlagBadge, Label, RoleBadge, SourceChip } from './ui';
import { useRegistry } from './useRegistry';

type Props = { keyName: string; company: string; gid: string | null; phase: string | null; startedAt: string | null; message: string | null };

export function LiveRun({ keyName, company, gid, phase, startedAt, message }: Props) {
  const router = useRouter();
  const { data: registry } = useRegistry(keyName);
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, TrialCheck>>({});
  const [landed, setLanded] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [mechanism, setMechanism] = useState<{ competitors?: unknown[] } | null>(null);
  const [feed, setFeed] = useState<CompactEvent[]>([]);
  const [calls, setCalls] = useState<Record<string, number>>({});
  const [reading, setReading] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);
  const [lost, setLost] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  const t0 = useRef<number | null>(startedAt ? Date.parse(startedAt) : null);

  useEffect(() => {
    t0.current ??= Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - (t0.current ?? Date.now())) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!gid) return;
    const es = new EventSource(`/api/research/${gid}/stream`);
    es.onmessage = (ev) => {
      const m = JSON.parse(ev.data) as StreamMessage;
      if (m.type === 'hello' && m.started_at) t0.current = Date.parse(m.started_at);
      else if (m.type === 'runs') setRuns((r) => ({ ...r, ...Object.fromEntries(m.runs.map((x) => [x.run, x.status])) }));
      else if (m.type === 'event') {
        const e = m.event;
        if (e.k === 'state') setRuns((r) => ({ ...r, [e.run]: e.status }));
        else {
          setRuns((r) => (r[e.run] && r[e.run] !== 'queued' ? r : { ...r, [e.run]: 'running' }));
          if (e.k === 'tool') setCalls((c) => ({ ...c, [e.connector]: (c[e.connector] ?? 0) + 1 }));
          if (e.k === 'stats') setReading((s) => ({ ...s, [e.run]: e.read }));
          if (e.k !== 'stats') setFeed((f) => [e, ...f].slice(0, 40));
        }
      } else if (m.type === 'result') {
        setRuns((r) => ({ ...r, [m.run]: m.status }));
        if ((m.kind === 'trial_check' || m.kind === 'found_check') && m.nct_id && m.content) {
          setChecks((c) => ({ ...c, [m.nct_id!]: m.content as TrialCheck }));
          setLanded((l) => [m.nct_id!, ...l]);
        } else if (m.kind === 'snapshot') setSnapshot(m.content);
        else if (m.kind === 'mechanism') setMechanism(m.content as { competitors?: unknown[] } | null);
      } else if (m.type === 'phase' && m.phase === 'finalized') {
        setDone(true);
        es.close();
        setTimeout(() => {
          router.replace(`/c/${keyName}`);
          router.refresh();
        }, 1200);
      } else if (m.type === 'phase' && m.phase === 'failed') {
        setLost(true);
        es.close();
      }
    };
    es.onerror = () => {
      // EventSource reconnects on its own with Last-Event-ID.
    };
    return () => es.close();
  }, [gid, keyName, router]);

  const rows: Omit<TrialRow, 'check'>[] = useMemo(() => registry?.stage1 ?? [], [registry]);
  const trialRuns = Object.entries(runs).filter(([k]) => k.startsWith('trial_check:') || k.startsWith('found_check:'));
  const finished = trialRuns.filter(([, s]) => s === 'completed' || s === 'failed' || s === 'cancelled').length;
  const snapDone = ['completed', 'failed'].includes(runs['snapshot:'] ?? '');
  const mechDone = ['completed', 'failed'].includes(runs['mechanism:'] ?? '');
  const sourcesRead = Object.values(reading).reduce((a, b) => a + b, 0);
  const estimate = Math.max(7, Math.ceil((rows.length || 20) / 40) + 7);
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const groups: [string, Omit<TrialRow, 'check'>[]][] = (['company_led', 'partner_led', 'investigator_led'] as const).map((r) => [roleLabel[r], rows.filter((x) => x.role === r)]);

  if (!gid) {
    return (
      <Card className="mt-8 p-6">
        <h2 className="text-[22px]">{phase === 'queued' ? 'Queued for research' : 'No research yet'}</h2>
        <p className="mt-2 text-[15px] text-muted">{message ?? `${company} hasn't been researched yet. Search for it to start.`}</p>
      </Card>
    );
  }

  return (
    <div className="pb-10">
      <div className="sticky top-14 z-20 mt-6 flex flex-wrap items-center gap-4 rounded-[4px] bg-ink px-5 py-3 text-page">
        {done ? <span className="text-[15px]">Research finished. Opening the landscape…</span> : lost ? <span className="text-[15px]">This run stopped. {message ?? ''}</span> : (
          <>
            <span className="pulse h-2 w-2 rounded-full bg-orange" />
            <span className="text-[15px]">Still researching.</span>
            <span className="text-[14px] text-[#adadac]">You can leave; this link keeps working.</span>
          </>
        )}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="ml-auto h-8 rounded-[4px] border border-page px-3 font-mono text-[11px] uppercase"
        >
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <span className="font-mono text-[12px]">
          {mmss(elapsed)} of about {estimate} min
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <Stage label="Registry table" detail={`${rows.length} trials, live from ClinicalTrials.gov`} state={registry ? 'done' : 'reading'} />
        <Stage label="Trial checks" detail="Rows fill in place" state={trialRuns.length && finished === trialRuns.length ? 'done' : 'reading'} progress={trialRuns.length ? `${finished} of ${trialRuns.length}` : undefined} />
        <Stage label="Pipeline" detail="Fills program headers last" state={snapDone ? 'done' : 'reading'} />
        <Stage label="Competitive set" detail="Mechanism and competitors, via ChEMBL" state={mechDone ? 'done' : 'reading'} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <QuickTake keyName={keyName} company={company} />
          <Card className="mt-6">
            <div className="flex flex-wrap items-baseline gap-3 border-b border-line px-5 py-4">
              <h2 className="text-[20px]">Trials</h2>
              <span className="text-[13px] text-muted">Grouped by who runs them until the pipeline arrives. Rows fill in as checks finish.</span>
            </div>
            {groups.map(([label, list]) =>
              list.length ? (
                <div key={label}>
                  <div className="border-b border-line bg-page px-5 py-2 font-mono text-[11px] uppercase tracking-[0.06em]">
                    {label} · {list.length}
                  </div>
                  {list.map((r) => {
                    const status = runs[`trial_check:${r.nct_id}`];
                    const c = checks[r.nct_id];
                    const m = c?.latest_milestone && c.latest_milestone.type !== 'no_public_update' ? c.latest_milestone : null;
                    return (
                      <div key={r.nct_id} className={cx('grid gap-3 border-b border-line px-5 py-3 md:grid-cols-[minmax(0,1.3fr)_100px_minmax(0,1fr)_minmax(0,2fr)_130px]', landed[0] === r.nct_id && 'just-landed')}>
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium">{trialName({ ...r, check: c })}</p>
                          <p className="font-mono text-[11px] text-muted">
                            {r.nct_id} · {phaseShort(r.phases)}
                          </p>
                        </div>
                        <RoleBadge role={r.role} />
                        <p className="text-[13px]">
                          {statusLabel(r.status)}
                          <br />
                          <span className="text-muted">{fmtDate(r.last_update_posted)}</span>
                        </p>
                        <div className="min-w-0 text-[14px]">
                          {c ? (
                            m ? (
                              <>
                                <Chip>{milestoneLabel(m.type)}</Chip> <span className="font-mono text-[11px] text-muted">{fmtDate(m.date)}</span>
                                <p className="mt-1 line-clamp-2">{m.description}</p>
                                <SourceChip url={m.source_url} date={m.date} nctId={r.nct_id} />
                              </>
                            ) : (
                              <span className="text-muted">No public update found</span>
                            )
                          ) : (
                            <span className="font-mono text-[11px] uppercase text-muted">{status === 'running' ? <span className="pulse">Checking…</span> : 'Queued'}</span>
                          )}
                          {c ? (
                            <div className="mt-1">
                              <CheckedWith calls={c.connector_calls} citations={c.citations} seconds={c.seconds} />
                            </div>
                          ) : null}
                        </div>
                        <div>{c ? <FlagBadge flag={c.flag} /> : null}</div>
                      </div>
                    );
                  })}
                </div>
              ) : null
            )}
            <div className="px-5 py-4 text-[14px]">
              <Chip tone="dashed">Found by research</Chip>{' '}
              <span className="text-muted">
                {snapshot
                  ? `${Object.keys(runs).filter((k) => k.startsWith('found_check:')).length} partner-run trials found beyond the registry search, now being checked.`
                  : 'Searching drug names and partner filings for trials the registry search missed. They join their programs when the pipeline lands.'}
              </span>
            </div>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <Card dark className="p-5">
            <Label className="text-[#adadac]">Live</Label>
            <p className="mt-2 text-[40px] leading-none">
              {finished}
              <span className="text-[20px] text-[#858483]"> / {trialRuns.length || rows.length}</span>
            </p>
            <p className="mt-1 text-[13px]">trial checks done</p>
            <p className="mt-3 font-mono text-[12px]">{sourcesRead} sources read</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['clinical_trials', 'pubmed', 'chembl', 'biorxiv'].map((cn) => (
                <span key={cn} className={cx('rounded-[3px] border px-1.5 py-0.5 font-mono text-[10px] uppercase', calls[cn] ? 'border-page text-page' : 'border-machine-line text-[#858483]')}>
                  {connectorName(cn)} · {calls[cn] ?? 0}
                </span>
              ))}
            </div>
          </Card>
          <Card className="max-h-[520px] overflow-auto p-4">
            <Label>What&apos;s happening</Label>
            <ul className="mt-2 space-y-1.5 font-mono text-[11px]">
              {feed.map((e, i) => (
                <li key={i} className="leading-snug">
                  <span className="text-faint">{e.run.replace(/^(trial_check|found_check):/, '')} </span>
                  {e.k === 'tool' ? <span className="text-ink">{e.connector}.{e.tool}</span> : e.k === 'search' ? <span className="text-muted">{e.m}</span> : e.k === 'extract' ? <span className="text-muted">Read {e.url.replace(/^https?:\/\//, '').slice(0, 60)}</span> : null}
                </li>
              ))}
              {!feed.length ? <li className="text-muted">Waiting for the first run to start…</li> : null}
            </ul>
          </Card>
          <Link href={`/c/${keyName}/hood?run=${gid}`} className="font-mono text-[11px] uppercase underline">
            Under the hood · live →
          </Link>
        </div>
      </div>
      {mechanism ? <p className="mt-4 text-[13px] text-muted">Competitive set ready: {mechanism.competitors?.length ?? 0} same-mechanism programs.</p> : null}
    </div>
  );
}

function Stage({ label, detail, state, progress }: { label: string; detail: string; state: 'done' | 'reading'; progress?: string }) {
  return (
    <div className="rounded-[4px] border border-line bg-card px-4 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{state === 'done' ? 'Done' : progress ?? <span className="pulse">Reading</span>}</p>
      <p className="mt-1 text-[14px] font-medium">{label}</p>
      <p className="text-[12px] text-muted">{detail}</p>
    </div>
  );
}

function QuickTake({ keyName, company }: { keyName: string; company: string }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<'loading' | 'done' | 'off'>('loading');
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: keyName, question: `In three sentences: what is ${company} developing in clinical trials now, and what are its next dated catalysts?` }),
        });
        if (!res.ok || !res.body) {
          if (live) setState('off');
          return;
        }
        for await (const e of readSse<AskEvent>(res)) {
          if (!live) return;
          if (e.k === 'text') setText((t) => t + e.delta);
          if (e.k === 'done') {
            setText(e.text);
            setState('done');
          }
          if (e.k === 'error') setState('off');
        }
      } catch {
        setState('off');
      }
    })();
    return () => {
      live = false;
    };
  }, [keyName, company]);
  if (state === 'off') return null;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-[18px]">Quick take</h2>
        <Chip tone="dashed">Quick answer · not checked</Chip>
        <span className="ml-auto font-mono text-[10px] uppercase text-muted">Responses API</span>
      </div>
      <p className="mt-3 text-[15px] leading-relaxed">{text ? text.replace(/\*\*/g, '') : <span className="pulse text-muted">Reading the web and the registry…</span>}</p>
      <p className="mt-2 text-[12px] text-muted">Replaced by checked rows as they finish. Never sets a flag.</p>
    </Card>
  );
}
