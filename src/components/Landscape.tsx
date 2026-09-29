'use client';

// The landscape (HANDOFF-v2.1 section 2): What's new, the hero, catalysts,
// then programs and trials. Registry status is re-read on open and each flag
// is recomputed against it (section 5).

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { Freshness } from '@/lib/domain/freshness';
import type { StoredEvent } from '@/lib/domain/monitor';
import type { Flag, RunBy } from '@/lib/domain/types';
import { fmtDate, isFlagLoud, milestoneLabel, milestoneOf, monthsSince, phaseShort, plural, statusLabel } from '@/lib/view/format';
import type { AreaView, CatalystView, LandscapeView, ProgramView } from '@/lib/view/landscape';
import type { SlimFound, SlimRow } from '@/lib/view/slim';
import { Card, Chip, ConnectorMarker, cx, FlagBadge, HandChecked, Label, RoleBadge, SourceChip } from './ui';
import { useRegistry } from './useRegistry';

type Props = { view: LandscapeView; names: Record<string, string>; keyName: string; nextRefresh: string; events: StoredEvent[]; today: string };
type Filter = 'all' | 'news' | 'flagged' | 'found';

export function Landscape({ view, names, keyName, nextRefresh, events, today }: Props) {
  const { data: registry } = useRegistry(keyName);
  const [filter, setFilter] = useState<Filter>('all');
  const [runBy, setRunBy] = useState<RunBy | 'any'>('any');
  const [milestone, setMilestone] = useState<string>('any');
  const rows = useMemo(() => new Map(view.pack.rows.map((r) => [r.nct_id, r])), [view.pack.rows]);
  const found = useMemo(() => new Map(view.pack.found_beyond_registry_search.map((f) => [f.nct_id, f])), [view.pack.found_beyond_registry_search]);
  const fresh = (id: string): Freshness | undefined => registry?.freshness[id];
  const flagOf = (r: SlimRow): Flag => fresh(r.nct_id)?.flag ?? r.check?.flag ?? 'no_news';
  const lagging = view.pack.rows.filter((r) => isFlagLoud(flagOf(r)) && fresh(r.nct_id)?.state !== 'changed_pending').length;
  const milestoneTypes = [...new Set(view.pack.rows.map((r) => milestoneOf(r)?.type).filter((t): t is string => Boolean(t)))];

  const rowPasses = (r: SlimRow) =>
    (filter === 'all' || (filter === 'news' && Boolean(milestoneOf(r)?.date)) || (filter === 'flagged' && isFlagLoud(flagOf(r)))) &&
    (runBy === 'any' || r.role === runBy) &&
    (milestone === 'any' || milestoneOf(r)?.type === milestone);
  const foundPasses = (f: SlimFound) => (filter === 'all' || filter === 'found' || (filter === 'news' && Boolean(milestoneOf(f)?.date))) && (runBy === 'any' || runBy === 'partner_led') && (milestone === 'any' || milestoneOf(f)?.type === milestone);
  const ctx: RowCtx = { keyName, names, fresh, flagOf, nextRefresh, today };

  return (
    <div className="pb-8">
      {registry && registry.changed > 0 ? (
        <div className="mt-6 rounded-[4px] border border-ink bg-card px-4 py-3 text-[14px]">
          {plural(registry.changed, 'registry record')} changed since this research was recorded on {fmtDate(view.pack.about.recorded)}. Flags below use today&apos;s statuses; the weekly re-run on {fmtDate(nextRefresh, { year: false })} rechecks them.
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <WhatsNew view={view} names={names} keyName={keyName} events={events} />
        <div className="flex flex-col gap-4">
          <Hero view={view} company={view.pack.about.company} lagging={lagging} registryNow={registry?.trials ?? null} />
          {view.related.length ? (
            <div>
              <Label>Related</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {view.related.slice(0, 8).map((r) =>
                  r.key ? (
                    <Link key={r.name} href={`/c/${r.key}`} title={r.scope} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-ink bg-card px-3 text-[13px] hover:bg-wash">
                      {r.name} <span className="font-mono text-[9px] uppercase tracking-[0.05em] text-muted">Instant</span>
                    </Link>
                  ) : (
                    <span key={r.name} title={r.scope} className="inline-flex h-8 items-center rounded-full border border-line-strong px-3 text-[13px] text-muted">
                      {r.name}
                    </span>
                  )
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <Catalysts items={view.catalysts} today={today} keyName={keyName} />

      <section className="mt-10">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[22px]">Programs and trials</h2>
          <div className="flex flex-wrap items-center gap-2">
            <FilterButton on={filter === 'all'} onClick={() => setFilter('all')} label={`All ${view.stats.registry + view.stats.found} trials`} />
            <FilterButton on={filter === 'news'} onClick={() => setFilter('news')} label={`Dated news · ${view.pack.rows.filter((r) => milestoneOf(r)?.date).length}`} />
            <FilterButton on={filter === 'flagged'} onClick={() => setFilter('flagged')} label={`Flagged · ${lagging}`} />
            {view.stats.found ? <FilterButton on={filter === 'found'} onClick={() => setFilter('found')} label={`Found by research · ${view.stats.found}`} /> : null}
            <select value={runBy} onChange={(e) => setRunBy(e.target.value as RunBy | 'any')} aria-label="Run by" className="h-8 rounded-[4px] border border-line-strong bg-card px-2 font-mono text-[11px] uppercase">
              <option value="any">Run by: any</option>
              <option value="company_led">Company</option>
              <option value="partner_led">Partner</option>
              <option value="investigator_led">Investigator</option>
            </select>
            <select value={milestone} onChange={(e) => setMilestone(e.target.value)} aria-label="Milestone type" className="h-8 rounded-[4px] border border-line-strong bg-card px-2 font-mono text-[11px] uppercase">
              <option value="any">Milestone: any</option>
              {milestoneTypes.map((t) => (
                <option key={t} value={t}>
                  {milestoneLabel(t)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filter === 'flagged' && lagging === 0 ? (
          <Card className="mt-4 p-6">
            <p className="text-[28px]">0</p>
            <p className="text-[15px]">registry lags</p>
            <p className="mt-2 max-w-[560px] text-[14px] text-muted">Every trial the company called complete or stopped also says so in the registry.</p>
          </Card>
        ) : (
          <Card className="mt-4 overflow-hidden">
            <HeaderRow />
            {view.areas.map((a) => (
              <Area key={a.area} area={a} rows={rows} found={found} rowPasses={rowPasses} foundPasses={foundPasses} ctx={ctx} />
            ))}
            <Other ids={view.other} rows={rows} found={found} rowPasses={rowPasses} foundPasses={foundPasses} ctx={ctx} />
          </Card>
        )}
      </section>
    </div>
  );
}

type RowCtx = { keyName: string; names: Record<string, string>; fresh: (id: string) => Freshness | undefined; flagOf: (r: SlimRow) => Flag; nextRefresh: string; today: string };

function FilterButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cx('h-8 rounded-[4px] px-3 font-mono text-[11px] uppercase tracking-[0.04em]', on ? 'bg-ink text-page' : 'border border-line-strong bg-card hover:border-ink')}>
      {label}
    </button>
  );
}

function WhatsNew({ view, names, keyName, events }: { view: LandscapeView; names: Record<string, string>; keyName: string; events: StoredEvent[] }) {
  const recent = events.filter((e) => e.match !== 'none').slice(0, 3);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="text-[20px]">What&apos;s new</h2>
          <span className="text-[13px] text-muted">Dated milestones across the company, newest first</span>
        </div>
        <Label>{view.whatsNewTotal} dated items</Label>
      </div>
      <ul>
        {recent.map((e) => (
          <li key={e.event_id} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-b border-line px-5 py-3 sm:grid-cols-[110px_150px_minmax(0,1fr)]">
            <span className="font-mono text-[12px] text-muted">{fmtDate(e.event_date ?? e.received.slice(0, 10))}</span>
            <span className="hidden sm:block">
              <Chip tone="dashed">{e.followup?.status === 'applied' ? 'Checked' : 'New · checking'}</Chip>
            </span>
            <span className="text-[14px]">
              {e.summary} <span className="text-[12px] text-muted">· from a daily Monitor</span>
            </span>
          </li>
        ))}
        {view.whatsNew.map((n, i) => (
          <li key={`${n.date}-${i}`} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-b border-line px-5 py-3 last:border-b-0 sm:grid-cols-[110px_150px_minmax(0,1fr)_auto]">
            <span className="font-mono text-[12px] text-muted">{fmtDate(n.date)}</span>
            <span className="hidden sm:block">{n.kind === 'program' && n.type === 'approved' ? <Chip tone="ink">✓ Approved</Chip> : <Chip>{milestoneLabel(n.type)}</Chip>}</span>
            <span className="min-w-0 text-[14px]">
              {n.nct_id ? (
                <Link href={`/c/${keyName}/t/${n.nct_id}`} className="font-medium underline decoration-line-strong hover:decoration-ink">
                  {names[n.nct_id] ?? n.nct_id}
                </Link>
              ) : (
                <span className="font-medium">{programLabel(n.program)}</span>
              )}{' '}
              · {n.text}
            </span>
            <span className="hidden sm:block">{n.flag && isFlagLoud(n.flag) ? <FlagBadge flag={n.flag as Flag} /> : null}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Hero({ view, company, lagging, registryNow }: { view: LandscapeView; company: string; lagging: number; registryNow: number | null }) {
  const s = view.stats;
  const short = company.split(' ')[0];
  return (
    <>
      <Card dark className="p-5">
        {s.found ? (
          <>
            <div className="flex items-end gap-4">
              <div>
                <p className="text-[44px] leading-none text-[#858483]">{s.registry}</p>
                <p className="mt-1 text-[13px] text-[#adadac]">in the registry search</p>
              </div>
              <span className="pb-6 text-[#858483]">→</span>
              <div>
                <p className="text-[44px] leading-none">{s.registry + s.found}</p>
                <p className="mt-1 text-[13px]">found by research</p>
              </div>
            </div>
            <p className="mt-4 text-[14px]">+{s.found} run by partners and not listed under {short}, found by drug-name searches.</p>
          </>
        ) : (
          <>
            <Label className="text-[#adadac]">0 found by research</Label>
            <p className="mt-2 text-[44px] leading-none">{s.registry}</p>
            <p className="mt-1 text-[14px]">in the registry search. Nothing missing.</p>
            <p className="mt-3 text-[13px] text-[#adadac]">Searched by drug name and code for partner-run trials. None turned up beyond the sponsor search.</p>
          </>
        )}
        <div className="mt-4">
          <ConnectorMarker connector="clinical_trials" dark />
        </div>
      </Card>
      <Card className="px-5 py-2 text-[14px]">
        <Stat label="With dated public news" value={`${s.withNews} of ${s.registry}`} />
        <Stat label={<span className="inline-flex items-center gap-2">{lagging ? <span className="h-2.5 w-2.5 rounded-[2px] bg-orange-wash" /> : null}Registry lagging</span>} value={String(lagging)} />
        <Stat label="Programs disclosed" value={String(s.programs)} />
        {s.investigatorTrials ? <Stat label="Investigator-sponsored" value={`${s.investigatorTrials} at ${s.investigatorSites} sites`} /> : <Stat label="Run by the company or partners" value={`${s.registry} of ${s.registry}`} />}
        {registryNow !== null && registryNow !== s.registry ? <Stat label="Active in the registry today" value={String(registryNow)} /> : null}
      </Card>
    </>
  );
}

function Stat({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-b-0">
      <span>{label}</span>
      <span className="font-mono text-[13px]">{value}</span>
    </div>
  );
}

function Catalysts({ items, today, keyName }: { items: CatalystView[]; today: string; keyName: string }) {
  if (!items.length) return null;
  const start = Date.parse(today);
  const end = start + 270 * 86_400_000;
  const pos = (d: string | null) => (d ? Math.min(100, Math.max(0, ((Date.parse(d) - start) / (end - start)) * 100)) : 0);
  const months: { label: string; at: number }[] = [];
  const d = new Date(today);
  for (let i = 0; i <= 9; i += 1) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    const at = pos(m.toISOString().slice(0, 10));
    if (at > 0 && at < 100) months.push({ label: m.getUTCMonth() === 0 ? `Jan ${m.getUTCFullYear()}` : m.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), at });
  }
  const dated = items.filter((c) => c.dated);
  const windows = items.filter((c) => !c.dated);
  return (
    <Card className="mt-6 px-5 py-4">
      <div className="flex items-center justify-between">
        <Label>Upcoming catalysts · {items.length}</Label>
        <span className="flex items-center gap-4 font-mono text-[10px] uppercase text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-ink" /> Dated
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1 w-4 bg-line-strong" /> Guided window
          </span>
        </span>
      </div>
      {/* Desktop: a timeline strip. Mobile: a list. */}
      <div className="relative mt-4 hidden h-[168px] sm:block">
        <div className="absolute left-0 top-0 h-full border-l border-orange">
          <span className="absolute -top-1 left-1 font-mono text-[9px] uppercase text-orange">Today</span>
        </div>
        {dated.slice(0, 5).map((c, i) => (
          <div key={c.id} className="absolute top-3 -translate-x-1/2 text-center" style={{ left: `${pos(c.earliest)}%`, top: `${12 + (i % 2) * 24}px` }}>
            <Link href={c.nct_id ? `/c/${keyName}/t/${c.nct_id}` : '#'} className="block whitespace-nowrap text-[12px] leading-tight" title={c.what}>
              <span className="font-medium">{fmtDate(c.earliest, { year: false })}</span>
              <br />
              <span className="text-muted">{c.label}</span>
            </Link>
          </div>
        ))}
        <div className="absolute left-0 right-0 top-[76px] border-t border-line">
          {dated.map((c) => (
            <span key={c.id} className="absolute -top-[5px] h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${pos(c.earliest)}%` }} />
          ))}
          {months.map((m) => (
            <span key={m.label} className="absolute top-2 font-mono text-[10px] text-faint" style={{ left: `${m.at}%` }}>
              {m.label}
            </span>
          ))}
        </div>
        {windows.slice(0, 4).map((c, i) => (
          <div key={c.id} className="absolute" style={{ left: `${pos(c.earliest)}%`, width: `${Math.max(4, pos(c.latest) - pos(c.earliest))}%`, top: `${104 + i * 16}px` }}>
            <div className="h-1 rounded-full bg-line-strong" />
            <p className="mt-0.5 truncate text-[11px] text-muted" title={c.what}>
              {c.label} · {c.what}
            </p>
          </div>
        ))}
      </div>
      <ul className="mt-3 space-y-2 sm:hidden">
        {items.map((c) => (
          <li key={c.id} className="text-[13px]">
            <span className="font-mono text-[11px] text-muted">{c.dated ? fmtDate(c.earliest) : `${fmtDate(c.earliest)} to ${fmtDate(c.latest)}`}</span> · {c.label} · {c.what}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const COLS = 'md:grid md:grid-cols-[minmax(0,1.3fr)_110px_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_120px] md:gap-4';

function HeaderRow() {
  return (
    <div className={cx('hidden border-b border-line bg-page px-5 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-muted', COLS)}>
      <span>Trial</span>
      <span>Run by</span>
      <span>Registry</span>
      <span>Latest news</span>
      <span>Next catalyst</span>
      <span>Flag</span>
    </div>
  );
}

type AreaProps = {
  rows: Map<string, SlimRow>;
  found: Map<string, SlimFound>;
  rowPasses: (r: SlimRow) => boolean;
  foundPasses: (f: SlimFound) => boolean;
  ctx: RowCtx;
};

const SHOWN_PROGRAMS = 5;

function Area({ area, ...p }: AreaProps & { area: AreaView }) {
  const [more, setMore] = useState(false);
  const [showInvestigator, setShowInvestigator] = useState(false);
  const visible = area.programs.filter((g) => g.rowIds.some((id) => p.rows.has(id) && p.rowPasses(p.rows.get(id)!)) || g.foundIds.some((id) => p.found.has(id) && p.foundPasses(p.found.get(id)!)));
  // Programs with registry rows and flags first; the rest fold away.
  const ranked = [...visible].sort((a, b) => score(b, p) - score(a, p));
  const shown = more ? ranked : ranked.slice(0, SHOWN_PROGRAMS);
  const hidden = ranked.slice(SHOWN_PROGRAMS);
  const inv = area.investigator.rowIds.map((id) => p.rows.get(id)!).filter((r) => r && p.rowPasses(r));
  if (!visible.length && !inv.length) return null;
  return (
    <div className="border-b border-ink last:border-b-0">
      <div className="flex items-baseline gap-3 border-b border-line bg-page px-5 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em]">{area.area}</span>
        <Label>
          {plural(area.programs.length, 'program')}
          {hidden.length && !more ? ` · ${shown.length} shown` : ''}
        </Label>
      </div>
      {shown.map((g) => (
        <ProgramBlock key={g.id} g={g} {...p} />
      ))}
      {inv.length ? (
        <div className="border-b border-line px-5 py-3">
          <button type="button" onClick={() => setShowInvestigator((v) => !v)} className="flex w-full flex-wrap items-center gap-3 text-left">
            <Chip tone="wash">Investigator</Chip>
            <span className="text-[14px]">
              {plural(inv.length, 'investigator-sponsored trial')} at {plural(new Set(inv.map((r) => r.lead_sponsor)).size, 'institution')}
            </span>
            <span className="text-[13px] text-muted">
              · {[...new Set(inv.map((r) => r.lead_sponsor))].filter((s) => s !== '[Investigator]').slice(0, 3).join(', ')} · {inv.filter((r) => r.check && r.check.flag !== 'no_news').length} with news
            </span>
            <span className="ml-auto font-mono text-[11px] uppercase">{showInvestigator ? 'Hide rows ▾' : 'Show rows ▸'}</span>
          </button>
          {showInvestigator ? (
            <div className="mt-2 border-l border-line pl-3">
              {inv.map((r) => (
                <TrialLine key={r.nct_id} row={r} ctx={p.ctx} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {hidden.length && !more ? (
        <button type="button" onClick={() => setMore(true)} className="flex w-full items-center justify-between border-b border-line px-5 py-3 text-left text-[14px] text-muted hover:bg-page">
          <span>
            {plural(hidden.length, `more ${area.area.toLowerCase()} program`)} · {hidden.slice(0, 4).map((g) => g.program.asset.split('(')[0].trim()).join(', ')}
          </span>
          <span className="font-mono text-[11px] uppercase text-ink">Show ▸</span>
        </button>
      ) : null}
    </div>
  );
}

function score(g: ProgramView, p: AreaProps) {
  const rs = g.rowIds.map((id) => p.rows.get(id)).filter(Boolean) as SlimRow[];
  return (rs.some((r) => isFlagLoud(p.ctx.flagOf(r))) ? 100 : 0) + rs.length * 10 + g.foundIds.length + (g.program.latest_milestone_date ? Number(g.program.latest_milestone_date.slice(0, 4)) / 10000 : 0);
}

function ProgramBlock({ g, rows, found, rowPasses, foundPasses, ctx }: AreaProps & { g: ProgramView }) {
  const rs = g.rowIds.map((id) => rows.get(id)!).filter((r) => r && rowPasses(r));
  const fs = g.foundIds.map((id) => found.get(id)!).filter((f) => f && foundPasses(f));
  const p = g.program;
  return (
    <div className="border-b border-line">
      <div className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_minmax(0,1fr)] md:gap-6">
        <div className="min-w-0">
          <p className="text-[15px] font-medium leading-snug">
            {p.asset.split('(')[0].trim()} · <span className="font-normal">{p.indication}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {g.approvedIn ? <Chip tone="ink">✓ Approved{g.approvedIn !== 'Yes' ? ` · ${g.approvedIn}` : ''}</Chip> : <Chip>{p.status.replace(/_/g, ' ')}</Chip>}
            <span className="text-[12px] text-muted">
              {g.rowIds.length} in registry search{g.foundIds.length ? <span className="text-ink"> · +{g.foundIds.length} found</span> : null}
            </span>
          </div>
        </div>
        <div className="min-w-0 text-[14px]">
          <Label>Latest{p.latest_milestone_date ? ` · ${fmtDate(p.latest_milestone_date)}` : ''}</Label>
          <p className="mt-1 line-clamp-2">{p.latest_milestone}</p>
          <div className="mt-1.5">
            <SourceChip url={p.source_url} />
          </div>
        </div>
        <div className="text-[14px]">
          <Label>Next</Label>
          <p className="mt-1">{p.next_catalyst?.description ? `${shortText(p.next_catalyst.description)} · ${p.next_catalyst.timing_text ?? ''}` : 'Not guided'}</p>
        </div>
      </div>
      {rs.map((r) => (
        <TrialLine key={r.nct_id} row={r} ctx={ctx} />
      ))}
      {fs.map((f, i) => (
        <FoundLine key={f.nct_id} f={f} ctx={ctx} marker={i === 0} />
      ))}
    </div>
  );
}

/** "ivonescimab (SMT112, AK112) · First-line PD-L1-positive NSCLC, …" → "ivonescimab · First-line PD-L1-positive NSCLC" */
function programLabel(text: string) {
  const [asset, indication = ''] = text.split(' · ');
  const ind = indication.split(/[,;(]/)[0].trim();
  return `${asset.split('(')[0].trim()}${ind ? ` · ${ind.length > 60 ? `${ind.slice(0, 57)}…` : ind}` : ''}`;
}

const shortText = (s: string) => {
  const first = s.split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
  return first.length > 80 ? `${first.slice(0, 77)}…` : first;
};

function Other({ ids, ...p }: AreaProps & { ids: { rowIds: string[]; foundIds: string[] } }) {
  const rs = ids.rowIds.map((id) => p.rows.get(id)!).filter((r) => r && p.rowPasses(r));
  const fs = ids.foundIds.map((id) => p.found.get(id)!).filter((f) => f && p.foundPasses(f));
  if (!rs.length && !fs.length) return null;
  return (
    <div>
      <div className="flex items-baseline gap-3 border-b border-line bg-page px-5 py-2">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em]">Other trials</span>
        <Label>Not tied to a disclosed program</Label>
      </div>
      {rs.map((r) => (
        <TrialLine key={r.nct_id} row={r} ctx={p.ctx} />
      ))}
      {fs.map((f, i) => (
        <FoundLine key={f.nct_id} f={f} ctx={p.ctx} marker={i === 0} />
      ))}
    </div>
  );
}

export function CheckedWith({ calls, citations, seconds }: { calls: Record<string, number>; citations: number; seconds: number | null }) {
  const all = ['clinical_trials', 'pubmed', 'biorxiv'];
  const names: Record<string, string> = { clinical_trials: 'ClinicalTrials.gov', pubmed: 'PubMed', biorxiv: 'bioRxiv', chembl: 'ChEMBL' };
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-muted">
      <span>Checked with</span>
      {[...new Set([...all, ...Object.keys(calls)])].map((c) => (
        <Chip key={c} tone={calls[c] ? 'wash' : 'dashed'}>
          {names[c] ?? c} {calls[c] ?? 0}
        </Chip>
      ))}
      <span>· {citations} citations{seconds ? ` · ${seconds} s` : ''}</span>
    </div>
  );
}

function RegistryCell({ row, ctx }: { row: SlimRow; ctx: RowCtx }) {
  const f = ctx.fresh(row.nct_id);
  if (f && f.state !== 'unchanged') {
    return (
      <div className="text-[13px]">
        <p>
          <span className="text-muted line-through">{statusLabel(f.recorded_status)}</span> → {statusLabel(f.status)}
        </p>
        {f.state === 'caught_up' ? <Chip tone="ok">✓ Registry caught up</Chip> : null}
        {f.changed_on ? <p className="text-[12px] text-muted">Registry updated {fmtDate(f.changed_on)}</p> : null}
      </div>
    );
  }
  return (
    <div className="text-[13px]">
      <p>{statusLabel(row.status)}</p>
      {row.last_update_posted ? <p className="text-[12px] text-muted">Updated {fmtDate(row.last_update_posted)}</p> : null}
    </div>
  );
}

function lagSentence(row: SlimRow, today: string): string | null {
  const all = [row.check?.latest_milestone, ...(row.check?.earlier_milestones ?? [])];
  const done = all.find((m) => m?.type === 'enrollment_completed' && m.date);
  if (!done?.date) return null;
  const months = monthsSince(done.date, new Date(today));
  return `Registry still says ${statusLabel(row.status)} ${months >= 2 ? `${months} months` : 'weeks'} after enrollment completed (${fmtDate(done.date)}).`;
}

function TrialLine({ row, ctx }: { row: SlimRow; ctx: RowCtx }) {
  const m = milestoneOf(row);
  const flag = ctx.flagOf(row);
  const f = ctx.fresh(row.nct_id);
  const pending = f?.state === 'changed_pending';
  const lag = flag === 'registry_lagging' && !pending ? lagSentence(row, ctx.today) : null;
  const href = `/c/${ctx.keyName}/t/${row.nct_id}`;
  const checks = row.check?.hand_checked ?? [];
  return (
    <div className={cx('border-t border-line px-5 py-3', isFlagLoud(flag) && !pending && 'bg-[#fffaf7]')}>
      <div className={cx('grid grid-cols-2 gap-x-4 gap-y-2', COLS)}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <Link href={href} className="text-[15px] font-medium underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            {ctx.names[row.nct_id] ?? row.nct_id}
          </Link>
          <p className="font-mono text-[11px] text-muted">
            {row.nct_id} · {phaseShort(row.phases)}
          </p>
        </div>
        <div>
          <RoleBadge role={row.role} />
          {row.role !== 'company_led' ? <p className="mt-1 truncate text-[12px] text-muted">{row.lead_sponsor}</p> : null}
        </div>
        <RegistryCell row={row} ctx={ctx} />
        <div className="col-span-2 min-w-0 md:col-span-1">
          {m ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Chip>{milestoneLabel(m.type)}</Chip>
                {m.date ? <span className="font-mono text-[11px] text-muted">{fmtDate(m.date)}</span> : null}
                <HandChecked checks={checks} />
              </div>
              <p className="mt-1 line-clamp-2 text-[14px]">{m.description}</p>
              <div className="mt-1">
                <SourceChip url={m.source_url} date={m.date} nctId={row.nct_id} />
              </div>
            </>
          ) : row.check ? (
            <p className="text-[14px] text-muted">No public update found</p>
          ) : (
            <p className="text-[13px] text-muted">Not checked yet · in the {fmtDate(ctx.nextRefresh, { year: false })} check</p>
          )}
        </div>
        <div className="text-[13px]">{row.check?.next_catalyst?.timing_text ? <p>{row.check.next_catalyst.timing_text}</p> : <p className="text-muted">Not guided</p>}</div>
        <div>
          <FlagBadge flag={flag} pending={pending} />
        </div>
      </div>
      {lag ? <p className="mt-2 text-[13px]">{lag}</p> : null}
      {row.check?.updated_by ? <p className="mt-2 font-mono text-[10px] uppercase text-muted">Updated from a Monitor event · {fmtDate(row.check.updated_by.date)}</p> : null}
      {row.check ? (
        <div className="mt-2">
          <CheckedWith calls={row.check.connector_calls} citations={row.check.citations} seconds={row.check.seconds} />
        </div>
      ) : null}
    </div>
  );
}

function FoundLine({ f, ctx, marker }: { f: SlimFound; ctx: RowCtx; marker: boolean }) {
  const m = milestoneOf(f);
  const r = f.registry;
  return (
    <div className="border-t border-line bg-page/60 px-5 py-3">
      <div className={cx('grid grid-cols-2 gap-x-4 gap-y-2', COLS)}>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <Link href={`/c/${ctx.keyName}/t/${f.nct_id}`} className="text-[15px] font-medium underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            {ctx.names[f.nct_id] ?? f.nct_id}
          </Link>
          <p className="font-mono text-[11px] text-muted">
            {f.nct_id} · {phaseShort(r?.phase ?? '')}
          </p>
        </div>
        <div>
          <RoleBadge role="partner_led" />
          <p className="mt-1 truncate text-[12px] text-muted">{r?.lead_sponsor}</p>
        </div>
        <div className="text-[13px]">{statusLabel(r?.status)}</div>
        <div className="col-span-2 min-w-0 md:col-span-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone="dashed" title="Found by searching the drug and its codes, via the ClinicalTrials.gov connector. Partner-sponsored, so a sponsor search misses it.">
              Found by research
            </Chip>
            {marker ? <ConnectorMarker connector="clinical_trials" /> : null}
          </div>
          {m ? (
            <>
              <p className="mt-1 text-[14px]">
                <span className="font-mono text-[11px] text-muted">{milestoneLabel(m.type)} · {fmtDate(m.date)}</span> · {m.description}
              </p>
              <div className="mt-1">
                <SourceChip url={m.source_url} date={m.date} nctId={f.nct_id} />
              </div>
            </>
          ) : null}
        </div>
        <div className="text-[13px] text-muted">{f.check?.next_catalyst?.timing_text ?? (f.check ? 'Not guided' : '')}</div>
        <div>{f.check ? <FlagBadge flag={f.check.flag} /> : <span className="font-mono text-[10px] uppercase text-muted">Not checked yet · in {fmtDate(ctx.nextRefresh, { year: false })} check</span>}</div>
      </div>
    </div>
  );
}
