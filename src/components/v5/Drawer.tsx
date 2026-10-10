'use client';

// Side drawer for one trial or one clinician. Fetches its view model from the
// disease's API routes, so a link like ?trial=NCT… opens straight to it.

import { useEffect, useRef, useState } from 'react';
import type { ClinicianDetail, TrialDetail } from '@/lib/space/detail';
import { Favicon } from './Favicon';
import { RelDay } from './Live';

const REMOVAL = process.env.NEXT_PUBLIC_REMOVAL_URL || 'https://github.com/khushishelat/clinical-research-demo/blob/main/PRIVACY.md#asking-to-be-removed';
const fmt = (iso: string | null | undefined, month: 'short' | 'long' = 'short') => {
  if (!iso) return '—';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(`${day ? iso : `${iso.slice(0, 7)}-01`}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month, ...(day ? { day: 'numeric' } : {}), year: 'numeric', timeZone: 'UTC' });
};

// A response from an older build can lack newer fields; the drawer renders it anyway.
const withDefaults = (kind: 'trial' | 'clinician', body: Record<string, unknown>) =>
  kind === 'trial'
    ? ({ summary: { drug: '', mechanism: null, modality: null, route: null, design: null, endpoint: null, timeframe: null, more_endpoints: 0, designations: [] }, web: [], programWeb: [], webSources: 0, guided: [], readout: null, pivotal: null, siblings: [], named: [], fromWeb: [], firstSeen: null, ...body } as unknown as TrialDetail)
    : ({ webRoles: [], roles: [], companies: [], otherTrials: [], papers: null, ...body } as unknown as ClinicianDetail);

export function Drawer({ disease, kind, id, onClose, onOpen }: { disease: string; kind: 'trial' | 'clinician'; id: string; onClose: () => void; onOpen: (kind: 'trial' | 'clinician', id: string) => void }) {
  const [data, setData] = useState<{ id: string; body: TrialDetail | ClinicianDetail | null } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/d/${disease}/${kind}/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => live && setData({ id, body: body && withDefaults(kind, body) }))
      .catch(() => live && setData({ id, body: null }));
    return () => {
      live = false;
    };
  }, [disease, kind, id]);
  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  const ready = data?.id === id;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={kind === 'trial' ? 'Trial' : 'Investigator'}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/20" />
      <div className="drawer-in relative flex h-full w-full max-w-[640px] flex-col overflow-y-auto border-l border-line bg-card">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-card px-6 py-3">
          <button ref={closeRef} type="button" onClick={onClose} className="text-[13px] text-muted hover:text-ink">
            ← Back to the map
          </button>
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">{kind === 'trial' ? 'Trial' : 'Investigator'}</span>
        </div>
        {!ready ? (
          <div className="space-y-3 p-6" aria-busy="true">
            <div className="h-4 w-40 animate-pulse rounded bg-wash" />
            <div className="h-8 w-72 animate-pulse rounded bg-wash" />
            <div className="h-24 animate-pulse rounded bg-wash" />
          </div>
        ) : !data.body ? (
          <p className="p-6 text-[14px] text-muted">{kind === 'trial' ? 'This trial is not on this map.' : 'Profiles are shown only for US investigators verified against the NPI Registry.'}</p>
        ) : kind === 'trial' ? (
          <Trial t={data.body as TrialDetail} onOpen={onOpen} />
        ) : (
          <Clinician c={data.body as ClinicianDetail} onOpen={onOpen} />
        )}
        <p className="mt-auto border-t border-line px-6 py-4 text-[12px] text-muted">
          Shown: names, specialties, cities, trial roles and publications from public sources. Left out: phone numbers, emails and site contacts.
        </p>
      </div>
    </div>
  );
}

// What the trial is testing and how, in plain terms, before any numbers.
function TrialSummary({ s }: { s: TrialDetail['summary'] }) {
  if (!s.drug && !s.design && !s.endpoint) return null;
  return (
    <div className="mt-4 space-y-1.5 border-l-2 border-ink pl-3 text-[14px] leading-snug">
      {s.drug ? (
        <p>
          <span className="text-muted">Testing </span>
          <span className="font-medium">{s.drug}</span>
          {[s.mechanism, s.modality, s.route].filter(Boolean).length ? <span className="text-muted"> · {[s.mechanism, s.modality, s.route].filter(Boolean).join(' · ')}</span> : null}
        </p>
      ) : null}
      {s.design ? <p>{s.design}</p> : null}
      {s.endpoint ? (
        <p className="text-[13px] text-muted">
          <span className="text-ink">Primary endpoint:</span> {s.endpoint}
          {s.timeframe ? ` (${s.timeframe})` : ''}
          {s.more_endpoints ? ` · +${s.more_endpoints} more` : ''}
        </p>
      ) : null}
      {s.designations.length ? (
        <p className="flex flex-wrap gap-1.5 pt-0.5">
          {s.designations.map((d) => (
            <span key={d} className="rounded-[2px] border border-orange px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em]">
              {d}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

function DisclosureList({ items, empty = null }: { items: { date: string | null; headline: string; source: string | null; host: string | null }[]; empty?: string | null }) {
  if (!items.length) return empty ? <p className="mt-2 text-[13px] text-muted">{empty}</p> : null;
  return (
    <ul className="mt-2">
      {items.map((w, i) => (
        <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line py-2.5 text-[13px]">
          <span className="font-mono text-[11px] text-muted">{fmt(w.date)}</span>
          <span>
            {w.headline}{' '}
            {w.source ? (
              <a href={w.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted hover:text-ink">
                <Favicon host={w.host} name={w.host ?? '?'} size={12} /> {w.host}
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Facts({ items }: { items: { value: string; label: string; sub?: React.ReactNode }[] }) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.label} className="bg-card px-3 py-2.5">
          <dd className="text-[15px]">{i.value}</dd>
          {i.sub ? <div className="mt-1 text-[11px] leading-snug text-muted">{i.sub}</div> : null}
          <dt className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{i.label}</dt>
        </div>
      ))}
    </dl>
  );
}

const Tag = ({ children, dark }: { children: React.ReactNode; dark?: boolean }) => <span className={`rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.05em] ${dark ? 'bg-ink text-page' : 'border border-line-strong text-muted'}`}>{children}</span>;

function Person({ p, onOpen, children }: { p: { key: string; name: string; initials: string; profile: boolean; specialty: string; place: string; npiNote: string | null; trials: number; papers: number | null }; onOpen: (kind: 'clinician', id: string) => void; children?: React.ReactNode }) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wash font-mono text-[11px] text-muted">{p.initials}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[14px] font-medium ${p.profile ? 'group-hover:underline' : ''}`}>{p.name}</span>
        {children}
        <span className="block text-[12px] text-muted">
          {p.specialty}
          {p.place ? ` · ${p.place}` : ''}
          {p.npiNote && p.specialty !== 'Outside the US' && p.specialty !== 'Location not listed' ? ` · ${p.npiNote}` : ''}
        </span>
      </span>
      <span className="w-14 shrink-0 text-right font-mono text-[13px]">{p.trials || '—'}</span>
      <span className="w-14 shrink-0 text-right font-mono text-[13px] text-muted">{p.papers ?? '—'}</span>
    </>
  );
  return p.profile ? (
    <button type="button" onClick={() => onOpen('clinician', p.key)} className="group flex w-full items-center gap-3 border-t border-line px-6 py-3 text-left hover:bg-wash">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 border-t border-line px-6 py-3">{body}</div>
  );
}

function Trial({ t, onOpen }: { t: TrialDetail; onOpen: (kind: 'trial' | 'clinician', id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? t.named : t.named.slice(0, 8);
  return (
    <div>
      <div className="px-6 pt-6">
        <p className="text-[13px] text-muted">
          {t.company?.name ?? t.sponsor}
          {t.lead ? ` · ${t.lead}` : ''}
          {t.runBy === 'investigator' ? ` · investigator-sponsored by ${t.sponsor}` : ''}
        </p>
        <h2 className="mt-1 text-[28px] leading-tight">{t.acronym || t.nct}</h2>
        <p className="mt-1 text-[15px] text-muted">{t.title}</p>
        <p className="mt-3 flex flex-wrap items-center gap-1.5">
          <Tag dark>{t.phase}</Tag>
          <Tag>{t.status}</Tag>
          <a href={`https://clinicaltrials.gov/study/${t.nct}`} target="_blank" rel="noreferrer" className="rounded-[2px] border border-line-strong px-1.5 py-0.5 font-mono text-[10px] tracking-[0.05em] text-muted hover:border-ink hover:text-ink">
            {t.nct} ↗
          </a>
        </p>
        {t.changes.length ? (
          <ul aria-label="Registry changes" className="mt-3 space-y-1 font-mono text-[11px]">
            {t.changes.slice(0, 4).map((c) => (
              <li key={`${c.date}-${c.text}`} className="flex flex-wrap items-center gap-x-2">
                <span className="h-1.5 w-1.5 bg-ink" />
                <span className="text-muted">
                  <RelDay iso={c.date} />
                </span>
                <span>{c.text}</span>
                <span className="text-faint">· ClinicalTrials.gov update</span>
              </li>
            ))}
          </ul>
        ) : null}
        <TrialSummary s={t.summary} />
        <Facts
          items={[
            { value: t.enrollment ? t.enrollment.toLocaleString('en-US') : '—', label: 'Enrollment' },
            { value: `${t.sites}${t.countries > 1 ? ` · ${t.countries}` : ''}`, label: t.countries > 1 ? 'Sites · countries' : 'Sites' },
            {
              value: fmt(t.firstPosted),
              label: 'First posted',
              sub: t.firstSeen ? (
                <span>
                  <span className="mr-1 inline-block h-1.5 w-1.5 bg-orange" />
                  Disclosed {t.firstSeen.days}d before registry
                  {t.firstSeen.source ? (
                    <>
                      {' · '}
                      <a href={t.firstSeen.source} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                        source
                      </a>
                    </>
                  ) : null}
                </span>
              ) : undefined,
            },
            { value: fmt(t.primaryCompletion), label: 'Primary completion' },
          ]}
        />
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">Registry · ClinicalTrials.gov{t.pivotal ? ` · pivotal, ${t.pivotal}` : ''}</p>
      </div>

      {t.readout ? (
        <section className="mx-6 mt-6 rounded-[4px] border border-line p-4">
          <p className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] font-medium">Latest readout</span>
            <span className="font-mono text-[11px] text-muted">
              {fmt(t.readout.date)}
              {t.readout.analysis ? ` · ${t.readout.analysis.split(/[.;]/)[0]}` : ''}
            </span>
          </p>
          {t.readout.endpoint ? <p className="mt-1 text-[13px] text-muted">{t.readout.endpoint.length > 180 ? `${t.readout.endpoint.slice(0, 179).trimEnd()}…` : t.readout.endpoint}</p> : null}
          <ul className="mt-2 space-y-1 text-[13px]">
            {t.readout.arms.map((a) => (
              <li key={a.arm} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-3">
                <span className="text-muted">{a.arm}</span>
                <span>{a.result}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 font-mono text-[11px] text-muted">
            {[t.readout.n ? `n = ${t.readout.n}` : null, t.readout.p_value ? `p ${/^[<>=]/.test(t.readout.p_value) ? '' : '= '}${t.readout.p_value}` : null].filter(Boolean).join(' · ')}
            {t.readout.source_url ? (
              <>
                {' · '}
                <a href={t.readout.source_url} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                  source ↗
                </a>
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      {t.guided.length ? (
        <section className="mt-6 px-6">
          <h3 className="flex items-center gap-2 text-[14px]">
            <span className="h-2.5 w-2.5 rotate-45 border border-dashed border-orange" /> Expected next
          </h3>
          <ul className="mt-2">
            {t.guided.map((g, i) => (
              <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-line py-2.5 text-[13px]">
                <span className="font-mono text-[11px] text-muted">{g.window ?? '—'}</span>
                <span>
                  {g.what}{' '}
                  {g.source ? (
                    <a href={g.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted hover:text-ink">
                      <Favicon host={g.host} name={g.host ?? '?'} size={12} /> {g.host}
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {t.siblings.length ? (
        <section className="mt-6 px-6">
          <h3 className="text-[14px]">Other trials of {t.lead}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.siblings.map((o) => (
              <button
                key={o.nct}
                type="button"
                onClick={() => onOpen('trial', o.nct)}
                className="rounded-[3px] border border-line-strong px-2 py-1 text-[12px] hover:border-ink"
              >
                <span className="font-medium">{o.label}</span> <span className="text-muted">· {o.phase}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {t.web.length || t.programWeb.length ? (
        <section className="mt-6 px-6">
          <h3 className="flex items-center gap-2 text-[14px]">
            <span className="h-2 w-2 bg-orange" /> News
            <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
              Parallel web research · {t.webSources} source{t.webSources === 1 ? '' : 's'}
            </span>
          </h3>
          {t.firstSeen ? (
            <p className="mt-2 text-[13px] text-muted">
              First disclosed {fmt(t.firstSeen.date)}, {t.firstSeen.days} days before the registry listing
              {t.firstSeen.what ? `: ${t.firstSeen.what}` : ''}
              {t.firstSeen.source ? (
                <>
                  {' · '}
                  <a href={t.firstSeen.source} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                    source ↗
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <DisclosureList items={t.web} empty={t.programWeb.length ? 'No news about this trial specifically.' : null} />
          {t.programWeb.length ? (
            <>
              <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{t.lead} program</p>
              <DisclosureList items={t.programWeb} />
            </>
          ) : null}
        </section>
      ) : null}

      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-6">
          <h3 className="text-[14px]">
            {t.named.length} investigator{t.named.length === 1 ? '' : 's'} in the registry
          </h3>
          {t.hiddenSites ? <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Sites appear as “{t.hiddenLabel}”</span> : null}
        </div>
        {t.named.length ? (
          <>
            <div className="mt-2 flex gap-3 px-6 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
              <span className="w-9" />
              <span className="flex-1">Investigator · specialty · city (NPI)</span>
              <span className="w-14 text-right" title="Active trials in this indication">Trials</span>
              <span className="w-14 text-right" title="Publications in this indication">Pubs</span>
            </div>
            <div className="mt-1">
              {shown.map((p) => (
                <Person key={p.key} p={p} onOpen={onOpen}>
                  {p.note ? <span className="block text-[12px] text-ink">{p.note}</span> : null}
                </Person>
              ))}
            </div>
            {t.named.length > 8 ? (
              <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t border-line px-6 py-3 text-left font-mono text-[11px] uppercase tracking-[0.04em] text-muted hover:bg-wash hover:text-ink">
                {all ? 'Show fewer' : `Show ${t.named.length - 8} more investigators`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="mx-6 mt-2 rounded-[4px] bg-wash px-4 py-3 text-[13px] text-muted">
            The registry lists {t.sites} site{t.sites === 1 ? '' : 's'} for this trial but names no investigators.{' '}
            <a href={`https://clinicaltrials.gov/study/${t.nct}`} target="_blank" rel="noreferrer" className="underline">
              ClinicalTrials.gov
            </a>
          </p>
        )}
      </section>

      {t.fromWeb.length ? (
        <section className="mt-6">
          <h3 className="flex items-center gap-2 px-6 text-[14px]">
            <span className="h-2 w-2 bg-orange" /> {t.fromWeb.length} investigator{t.fromWeb.length === 1 ? '' : 's'} named in the news{' '}
            <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-faint">· Parallel web research</span>
          </h3>
          <div className="mt-2">
            {t.fromWeb.map((p) => (
              <Person key={p.key} p={p} onOpen={onOpen}>
                <span className="block text-[12px] text-ink">
                  {p.role}, {p.program}
                  {p.source ? (
                    <>
                      {' · '}
                      <a href={p.source} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-mono text-[11px] text-muted hover:text-ink">
                        {p.host}
                        {p.date ? ` · ${fmt(p.date)}` : ''}
                      </a>
                    </>
                  ) : null}
                </span>
              </Person>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Clinician({ c, onOpen }: { c: ClinicianDetail; onOpen: (kind: 'trial' | 'clinician', id: string) => void }) {
  return (
    <div>
      <div className="flex items-start gap-4 px-6 pt-6">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-wash font-mono text-[15px] text-muted">{c.initials}</span>
        <div>
          <h2 className="text-[28px] leading-tight">{c.name}</h2>
          <p className="mt-1 text-[14px] text-muted">
            {c.specialty} · {c.place} ·{' '}
            <a href={c.npiUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
              NPI verified
            </a>
          </p>
          {c.institution ? <p className="mt-0.5 text-[13px] text-muted">{c.institution}</p> : null}
        </div>
      </div>
      <div className="px-6">
        <Facts
          items={[
            { value: String(c.activeTrials), label: 'Active trials in indication' },
            { value: String(c.webRoles.length), label: 'Disclosed roles' },
            { value: c.papers ? String(c.papers.count) : '—', label: 'Publications in indication' },
            { value: c.papers ? String(c.papers.since2024) : '—', label: 'Since 2024' },
          ]}
        />
        {c.focus ? <p className="mt-4 text-[14px]">{c.focus}</p> : null}
        {c.companies.length ? (
          <div className="mt-5">
            <h3 className="text-[14px]">
              Works with {c.companies.length} sponsor{c.companies.length === 1 ? '' : 's'} on this map
            </h3>
            <p className="mt-2 flex flex-wrap gap-1.5">
              {c.companies.map((co) => (
                <span key={co.name} className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-[12px]">
                  <Favicon host={co.host} name={co.name} size={14} /> {co.name}
                </span>
              ))}
            </p>
          </div>
        ) : null}
      </div>

      <section className="mt-6">
        <h3 className="px-6 text-[14px]">Trial roles</h3>
        <ul className="mt-2">
          {c.roles.map((r) => (
            <li key={r.nct}>
              <button type="button" onClick={() => onOpen('trial', r.nct)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-line px-6 py-3 text-left hover:bg-wash">
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium">{r.label}</span>
                  <span className="block text-[12px] text-muted">
                    {r.company} · {r.phase || 'Phase n/a'} · {r.role}
                    {r.where ? ` · ${r.where}` : ''}
                  </span>
                </span>
                <span className="font-mono text-[11px] text-muted">{r.nct}</span>
              </button>
            </li>
          ))}
          {c.webRoles.map((w, i) => (
            <li key={`w${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-line px-6 py-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-[14px] font-medium">
                  <span className="h-2 w-2 bg-orange" />{' '}
                  {w.nct ? (
                    <button type="button" onClick={() => onOpen('trial', w.nct!)} className="hover:underline">
                      {w.program}
                    </button>
                  ) : (
                    w.program
                  )}
                </span>
                <span className="block text-[12px] text-muted">
                  {w.company} · {w.role}
                  {w.date ? ` · ${fmt(w.date)}` : ''}
                </span>
              </span>
              {w.source ? (
                <a href={w.source} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted hover:text-ink">
                  {w.host} ↗
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {c.papers?.recent.length ? (
        <section className="mt-6">
          <h3 className="flex items-baseline justify-between px-6 text-[14px]">
            Recent publications <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-muted">PubMed</span>
          </h3>
          <ul className="mt-2">
            {c.papers.recent.slice(0, 5).map((p) => (
              <li key={p.pmid} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-line px-6 py-3 text-[13px]">
                <span>
                  {p.title} <span className="text-muted">· {p.year}</span>
                </span>
                <a href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted hover:text-ink">
                  PMID {p.pmid}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {c.otherTrials.length ? (
        <section className="mt-6">
          <h3 className="px-6 text-[14px]">Other registered trials</h3>
          <ul className="mt-2">
            {c.otherTrials.map((o) => (
              <li key={o.nct} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-t border-line px-6 py-2.5 text-[13px]">
                <span>
                  {o.condition} <span className="text-muted">· {o.role}</span>
                </span>
                <a href={`https://clinicaltrials.gov/study/${o.nct}`} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted hover:text-ink">
                  {o.nct} ↗
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-6 px-6 text-[12px] text-muted">
        Is this you?{' '}
        <a href={REMOVAL} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          Ask to have this profile removed
        </a>
        .
      </p>
    </div>
  );
}
