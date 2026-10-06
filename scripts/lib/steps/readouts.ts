// Daily readout check: trials that have reached a readout point since the company
// was last researched (Phase 2 or later, and past primary completion, closed to
// enrollment, or named in a data disclosure) get one READOUT run each (core).
// Results that are reported join the company's facts; every run's basis joins
// the company's basis file as readouts.<nct>.<field>, so the table shows its
// reasoning either way. A trial whose last check found no results is checked
// again once a month (run-log key readout@1:<nct>:<YYYY-MM>), since trials past
// primary completion are the ones about to report; nothing is paid for twice.

import type { Company, Facts, Readout } from '../../../src/lib/space/types';
import { groupRuns, log, parallel, runLog, spacePath, store, today as todayOf, type Disease } from '../pipeline';
import { assertNoContacts, redactContacts, type Trial } from '../registry';
import { READOUT } from '../specs';
import { readoutTrials, readoutUnit } from '../units';

type FactsDoc = { disease: string; built: string; spec: string[]; facts: Record<string, Facts> };
type BasisDoc = { company: string; run_id: string; basis: { field: string; citations?: { excerpts?: string[] }[] }[] };

export async function readoutsStep(d: Disease, today = todayOf()): Promise<number> {
  const doc = await store.get<FactsDoc>(spacePath(d, 'facts.json'));
  const { trials } = (await store.get<{ trials: Trial[] }>(spacePath(d, 'trials.json'))) ?? { trials: [] };
  const { companies } = (await store.get<{ companies: Company[] }>(spacePath(d, 'companies.json'))) ?? { companies: [] };
  if (!doc) return 0;
  const byNct = new Map(trials.map((t) => [t.nct, t]));
  const rl = await runLog(d, 'enrich');
  const month = today.slice(0, 7);
  const RECHECK_DAYS = 30;
  // The key to run for a trial now, or null: its first check, a run still in progress, or a
  // monthly re-check when the latest finished check found no results.
  const keyFor = (nct: string): string | null => {
    const runs = Object.entries(rl.log)
      .filter(([k]) => k === `${READOUT.key}:${nct}` || k.startsWith(`${READOUT.key}:${nct}:`))
      .sort((a, b) => b[1].created.localeCompare(a[1].created));
    const [k, latest] = runs[0] ?? [];
    if (!latest) return `${READOUT.key}:${nct}`;
    if (!latest.status) return k;
    const stale = Date.parse(today) - Date.parse(latest.created) > RECHECK_DAYS * 86_400_000;
    return latest.status === 'completed' && !(latest.content as Readout | undefined)?.has_data && stale ? `${READOUT.key}:${nct}:${month}` : null;
  };
  const due = companies
    .filter((c) => doc.facts[c.key])
    .flatMap((c) => readoutTrials(c, byNct, doc.facts[c.key], today).map((t) => ({ c, t, key: keyFor(t.nct) })))
    .filter((x): x is { c: Company; t: Trial; key: string } => x.key !== null);
  if (!due.length) {
    log(d, 'readouts: no trial due for a check');
    return 0;
  }
  const client = parallel(d, 'readouts');
  if (!client) return 0;
  log(d, `readouts: ${due.length} trial${due.length === 1 ? '' : 's'} due for a check`);
  const res = await groupRuns(client, rl, d, 'readouts', due.map(({ c, t, key }) => ({ ...readoutUnit(d, today, t, c), key })), 12);

  let reported = 0;
  for (const { c, t, key } of due) {
    const rr = res[key];
    if (rr?.status !== 'completed') continue;
    const content = rr.content as Omit<Readout, 'nct'> | undefined;
    const f = doc.facts[c.key];
    if (content?.has_data) {
      f.readouts = [...(f.readouts ?? []).filter((x) => x.nct !== t.nct), { ...content, nct: t.nct, _run: rr.run_id }];
      reported += 1;
    }
    // The run's reasoning and sources, as in step 4, with contact lines removed from excerpts.
    const path = spacePath(d, `basis/${c.key}.json`);
    const file = (await store.get<BasisDoc>(path)) ?? { company: c.name, run_id: rr.run_id, basis: [] };
    const prefix = `readouts.${t.nct}.`;
    const added = ((rr.basis ?? []) as any[]).map((b) => ({ ...b, field: prefix + b.field, citations: (b.citations ?? []).map((x: any) => ({ ...x, excerpts: (x.excerpts ?? []).map(redactContacts) })) }));
    const next = { ...file, basis: [...file.basis.filter((b) => !b.field.startsWith(prefix)), ...added] };
    assertNoContacts(`basis ${c.key}`, next);
    await store.put(path, next);
  }
  assertNoContacts('facts', doc.facts);
  await store.put(spacePath(d, 'facts.json'), { ...doc, built: new Date().toISOString() });
  log(d, `readouts: ${due.length} checked · ${reported} reported results`);
  return due.length;
}
