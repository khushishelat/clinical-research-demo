'use client';

// Narrowing step for sponsors with more than 60 trials (HANDOFF-v2.1
// section 7). Counts come from stage 1 fields, so they update with no model
// call. Unselected trials still list from the registry, unchecked.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { areaOf } from '@/lib/domain/programs';
import type { TrialRow } from '@/lib/domain/types';
import { Card, cx, Label } from './ui';

type Row = Omit<TrialRow, 'check'>;
/** One run checks at most this many trials. */
const MAX_TRIALS = 76;

export function Narrow({ keyName, name }: { keyName: string; name: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [phases, setPhases] = useState<Set<string>>(new Set());
  const [areas, setAreas] = useState<Set<string>>(new Set());
  const [includeInvestigator, setIncludeInvestigator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/registry/${keyName}?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((b) => setRows(b.stage1 ?? b.new_trials ?? []))
      .catch(() => setRows([]));
  }, [keyName, name]);

  const phaseOf = (r: Row) => (r.phases.length ? r.phases.map((p) => p.replace('PHASE', 'Phase ').replace('EARLY_', 'Early ')).join('/') : 'Not applicable');
  const areaFor = (r: Row) => areaOf(`${r.condition} ${r.title}`);
  const count = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ((acc[x] = (acc[x] ?? 0) + 1), acc), {});
  const phaseCounts = useMemo(() => count((rows ?? []).map(phaseOf)), [rows]);
  const areaCounts = useMemo(() => count((rows ?? []).map(areaFor)), [rows]);
  const selected = (rows ?? []).filter((r) => (!phases.size || phases.has(phaseOf(r))) && (!areas.size || areas.has(areaFor(r))) && (includeInvestigator || r.role !== 'investigator_led'));
  const minutes = Math.min(20, 8 + Math.ceil(selected.length / 40));
  const over = selected.length > MAX_TRIALS;

  async function research() {
    setBusy(true);
    setMessage(null);
    const res = await fetch('/api/research', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, only_nct_ids: selected.map((r) => r.nct_id) }) });
    const body = await res.json();
    if (body.status === 'started' || body.status === 'joined') return router.push(`/c/${body.key}?run=${body.taskgroup_id}`);
    setBusy(false);
    setMessage(body.message ?? body.error ?? 'Could not start research.');
  }

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  return (
    <div>
      <Link href="/" className="font-mono text-[12px] uppercase text-muted hover:text-ink">
        ← Change company
      </Link>
      <h1 className="mt-4 text-[36px]">{name}</h1>
      {rows === null ? (
        <p className="mt-3 text-muted">Reading the registry…</p>
      ) : (
        <>
          <p className="mt-2 text-[17px] text-muted">{rows.length} active trials is more than one run covers well. Pick the part of the pipeline you care about.</p>
          <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="space-y-6">
              <ChipGroup label="Phase" counts={phaseCounts} selected={phases} onToggle={(v) => toggle(phases, v, setPhases)} />
              <ChipGroup label="Area · from registry conditions" counts={areaCounts} selected={areas} onToggle={(v) => toggle(areas, v, setAreas)} />
              <div>
                <Label>Run by</Label>
                <div className="mt-2 space-y-2 text-[15px]">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked readOnly /> Company and partner trials
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={includeInvestigator} onChange={(e) => setIncludeInvestigator(e.target.checked)} /> Investigator-run trials
                  </label>
                </div>
              </div>
            </div>
            <Card className="h-fit p-5">
              <Label>This run</Label>
              <p className="mt-2 text-[40px] leading-none">{selected.length}</p>
              <p className="text-[14px] text-muted">of {rows.length} trials</p>
              <p className="mt-4 text-[14px]">About {minutes} minutes. You can leave; the link keeps working.</p>
              <button type="button" disabled={!selected.length || over || busy} onClick={research} className="mt-4 h-11 w-full rounded-[4px] bg-ink font-mono text-[13px] uppercase text-page disabled:opacity-40">
                {busy ? 'Starting…' : `Research ${selected.length} trials`}
              </button>
              {over ? <p className="mt-2 text-[13px] text-muted">One run checks up to {MAX_TRIALS} trials. Narrow further.</p> : null}
              <p className="mt-3 text-[12px] text-muted">The rest stay listed from the registry, unchecked.</p>
              {message ? <p className="mt-3 text-[13px]">{message}</p> : null}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ChipGroup({ label, counts, selected, onToggle }: { label: string; counts: Record<string, number>; selected: Set<string>; onToggle: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => (
            <button key={k} type="button" aria-pressed={selected.has(k)} onClick={() => onToggle(k)} className={cx('h-9 rounded-full border px-4 text-[14px]', selected.has(k) ? 'border-ink bg-ink text-page' : 'border-line-strong bg-card hover:border-ink')}>
              {k} <span className="font-mono text-[12px] opacity-70">{n}</span>
            </button>
          ))}
      </div>
    </div>
  );
}
