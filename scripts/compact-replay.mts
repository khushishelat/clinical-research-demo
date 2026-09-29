// Builds fixtures/replay/<key>.json from full Task run event logs, so the
// replay overlay plays the recorded run from real events (searches, pages
// read, connector calls) instead of spacing calls evenly.
//
//   npm run compact-replay -- <session dir> [<later session dir> ...]
//
// Each session dir holds runs/<company>-<kind>[-<nct>].events.json, as
// written by the validation runner (parallel-integrations-and-demos,
// solutions/clinical-pipeline-monitoring/prototypes/trial-check/validation).
// When a run appears in several sessions, the latest one wins, because that
// is the run the recorded pack was built from. Times are seconds from the
// start of each run's own session, so runs overlap as they did.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compactRunEvent, runKey, thinStats, type CompactEvent } from '../src/lib/domain/events';

const sessions = process.argv.slice(2);
if (!sessions.length) throw new Error('Pass one or more session directories.');

type RunLog = { company: string; kind: string; nct_id?: string; session: string; events: { t: number; event: any }[] };
const runs = new Map<string, RunLog>();
for (const dir of sessions) {
  for (const file of readdirSync(join(dir, 'runs')).filter((f) => f.endsWith('.events.json'))) {
    const m = file.match(/^([a-z0-9]+)-(snapshot|mechanism|trial_check|found_check)(?:-(NCT\d{8}))?\.events\.json$/);
    if (!m) continue;
    const [, company, kind, nct_id] = m;
    runs.set(`${company}|${kind}|${nct_id ?? ''}`, { company, kind, nct_id, session: basename(dir), events: JSON.parse(readFileSync(join(dir, 'runs', file), 'utf8')) });
  }
}

// Investigator-led trials can list a person as lead sponsor. The packs show
// "[Investigator]" for those; scrub the same names from search text, and
// drop pages read whose URL names them.
const PERSON_EXCLUDE = /(univ|hosp|cent|inst|coll|found|group|clinic|society|trust|school|academ|oncolog|cancer|health|medical|research|network|ltd|llc|inc|corp|nhs|council|ministry|agency|department|consort|alliance|faculty|fundac|assoc|org)/i;
const people = new Set<string>();
for (const dir of sessions) {
  for (const file of readdirSync(dir).filter((f) => /^stage1-.*\.json$/.test(f))) {
    const body = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    const trials: any[] = Array.isArray(body) ? body : Array.isArray(body.trials) ? body.trials : Object.values(body).filter(Array.isArray).flat();
    for (const t of trials) if (t?.role === 'investigator_led' && t.lead_sponsor && !PERSON_EXCLUDE.test(t.lead_sponsor)) people.add(t.lead_sponsor);
  }
}
const personPatterns = [...people].flatMap((name) => {
  const parts = name.split(/[\s,.]+/).filter((p) => p.length > 1);
  const last = parts.at(-1) ?? name;
  return [new RegExp(`\\b${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\W+(?:\\w\\.?\\W+)?')}\\b`, 'gi'), ...(last.length > 3 ? [new RegExp(`\\b${last}\\b`, 'gi')] : [])];
});
const scrub = (text: string) => personPatterns.reduce((acc, re) => acc.replace(re, '[Investigator]'), text).replace(/\[Investigator\](\W+\[Investigator\])+/g, '[Investigator]');
const namesPerson = (url: string) => personPatterns.some((re) => new RegExp(re.source, 'i').test(url.replace(/[-_/]/g, ' ')));

const out = join(import.meta.dirname, '..', 'fixtures', 'replay');
mkdirSync(out, { recursive: true });
const byCompany = new Map<string, RunLog[]>();
for (const r of runs.values()) byCompany.set(r.company, [...(byCompany.get(r.company) ?? []), r]);

console.log(`scrubbing ${people.size} person-name sponsor(s) from search text`);
for (const [company, logs] of byCompany) {
  const events: CompactEvent[] = [];
  const summary = [];
  for (const log of logs) {
    const run = runKey({ kind: log.kind, nct_id: log.nct_id });
    const compact = log.events
      .map((x) => compactRunEvent(x.event, run, x.t))
      .filter((e): e is CompactEvent => e !== null && !(e.k === 'extract' && namesPerson(e.url)))
      .map((e) => (e.k === 'search' ? { ...e, m: scrub(e.m) } : e));
    const states = compact.filter((e) => e.k === 'state');
    const start = log.events[0]?.t ?? 0;
    const end = log.events.at(-1)?.t ?? start;
    summary.push({ run, kind: log.kind, ...(log.nct_id ? { nct_id: log.nct_id } : {}), start, end, status: states.at(-1)?.k === 'state' ? (states.at(-1) as any).status : 'unknown', session: log.session });
    // Keep only the terminal state; the start is implied by the first event.
    events.push(...compact.filter((e) => e.k !== 'state'), ...states.slice(-1));
  }
  events.sort((a, b) => a.t - b.t);
  const thinned = thinStats(events);
  const duration = Math.max(...summary.map((s) => s.end));
  const body = {
    key: company,
    built_from: [...new Set(summary.map((s) => s.session))],
    note: 'Compact log of the recorded run. Search objectives, pages read and connector calls are real; times are seconds from the start of each run’s session.',
    duration_s: duration,
    runs: summary.sort((a, b) => a.start - b.start),
    events: thinned,
  };
  writeFileSync(join(out, `${company}.json`), JSON.stringify(body));
  const counts = thinned.reduce<Record<string, number>>((acc, e) => ((acc[e.k] = (acc[e.k] ?? 0) + 1), acc), {});
  console.log(`${company}: ${summary.length} runs, ${thinned.length} events ${JSON.stringify(counts)}, ${duration}s`);
}
