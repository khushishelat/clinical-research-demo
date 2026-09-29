import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compactRunEvent } from '../src/lib/domain/events';
import { freshnessOf } from '../src/lib/domain/freshness';
import { carryOver, pinChecks } from '../src/lib/domain/handcheck';
import { filterFoundTrials, mergeCompetitors, totalsOf } from '../src/lib/domain/join';
import { matchEvent, eventContent, mergeEvents, type StoredEvent } from '../src/lib/domain/monitor';
import { patchCheck } from '../src/lib/domain/patch';
import { layoutLandscape, whatsNew } from '../src/lib/domain/programs';
import { estimateCostUsd, flagFor } from '../src/lib/domain/specs';
import { publicUrl } from '../src/lib/domain/links';
import { pack } from './helpers';

test('flag rule: conflict, lag from any milestone, news, no news', () => {
  assert.equal(flagFor('discontinued_or_terminated', 'RECRUITING'), 'conflict');
  assert.equal(flagFor('enrollment_completed', 'RECRUITING'), 'registry_lagging');
  // Newer news must not hide an earlier enrollment completion.
  assert.equal(flagFor('interim_data', 'RECRUITING', ['enrollment_completed']), 'registry_lagging');
  assert.equal(flagFor('enrollment_completed', 'ACTIVE_NOT_RECRUITING'), 'news');
  assert.equal(flagFor('no_public_update', 'RECRUITING'), 'no_news');
  assert.equal(flagFor(undefined, 'RECRUITING'), 'no_news');
});

test('cost estimate: trials x $0.10 plus snapshot and mechanism', () => {
  assert.equal(estimateCostUsd(31), 3.5);
});

test('freshness: a lag clears when the registry catches up, and downgrades when it moves sideways', () => {
  const row = pack('summit').rows.find((r) => r.nct_id === 'NCT05899608')!;
  assert.equal(row.check?.flag, 'registry_lagging');
  assert.equal(freshnessOf(row, { NCT05899608: { status: 'RECRUITING' } }).state, 'unchanged');
  const caught = freshnessOf(row, { NCT05899608: { status: 'ACTIVE_NOT_RECRUITING', last_update_posted: '2026-10-01' } });
  assert.equal(caught.state, 'caught_up');
  assert.equal(caught.flag, 'news');
  const sideways = freshnessOf(row, { NCT05899608: { status: 'ENROLLING_BY_INVITATION' } });
  assert.equal(sideways.state, 'changed_pending');
  assert.equal(sideways.flag, 'news');
  // Trial left the active search; its record says completed.
  assert.equal(freshnessOf(row, {}, { NCT05899608: { status: 'COMPLETED' } }).state, 'caught_up');
});

test('landscape: every row placed; HARMONi-3 under both NSCLC cohorts; Summit found trials inside programs', () => {
  const p = pack('summit');
  const layout = layoutLandscape(p);
  for (const r of p.rows) assert.ok(layout.placement[r.nct_id] >= 1, `${r.nct_id} placed`);
  assert.ok(layout.placement.NCT05899608 >= 2, 'HARMONi-3 appears under two programs');
  assert.equal(p.found_beyond_registry_search.length, 20);
  const inPrograms = layout.areas.flatMap((a) => a.programs.flatMap((g) => g.found.map((f) => f.nct_id)));
  assert.ok(inPrograms.length >= 15, `found trials inside programs (${inPrograms.length})`);
});

test('landscape: Axsome has 0 found-by-research trials; Arvinas has no investigator-run trials', () => {
  assert.equal(pack('axsome').found_beyond_registry_search.length, 0);
  const arv = layoutLandscape(pack('arvinas'));
  assert.equal(arv.areas.reduce((n, a) => n + a.investigator.trials, 0), 0);
});

test("what's new is newest first", () => {
  const items = whatsNew(pack('summit'), 8);
  assert.ok(items.length > 0);
  for (let i = 1; i < items.length; i += 1) assert.ok(items[i - 1].date >= items[i].date);
});

test('found-by-research filter excludes non-industry, company-listed, missing and asset-less trials', () => {
  const reg = {
    NCT00000001: { lead_sponsor: 'Big Pharma', lead_sponsor_class: 'INDUSTRY', collaborators: [], status: 'RECRUITING', phase: 'PHASE3', acronym: null, title: '', interventions: 'ivonescimab | chemo' },
    NCT00000002: { lead_sponsor: 'A University', lead_sponsor_class: 'OTHER', collaborators: [], status: 'RECRUITING', phase: '', acronym: null, title: '', interventions: 'ivonescimab' },
    NCT00000003: { lead_sponsor: 'Summit Therapeutics', lead_sponsor_class: 'INDUSTRY', collaborators: [], status: 'RECRUITING', phase: '', acronym: null, title: '', interventions: 'ivonescimab' },
    NCT00000005: { lead_sponsor: 'Other Co', lead_sponsor_class: 'INDUSTRY', collaborators: [], status: 'RECRUITING', phase: '', acronym: null, title: '', interventions: 'placebo' },
  };
  const { kept, excluded } = filterFoundTrials(['NCT00000001', 'NCT00000002', 'NCT00000003', 'NCT00000004', 'NCT00000005', 'NCT00000006'], reg, {
    match: 'summit',
    tokens: ['ivonescimab'],
    stage1Ids: new Set(['NCT00000006']),
  });
  assert.deepEqual(kept.map((k) => k.nct_id), ['NCT00000001']);
  assert.deepEqual(excluded.map((e) => e.nct_id).sort(), ['NCT00000002', 'NCT00000003', 'NCT00000004', 'NCT00000005']);
});

test('hand-check ticks carry over only for an unchanged claim', () => {
  const p = pack('summit');
  const pinned = pinChecks(p.review ?? [], p.rows, p.found_beyond_registry_search);
  const kept0 = carryOver(pinned, p);
  // Everything holds on an unchanged pack except a company-level claim whose
  // hand-check source the run itself never cited (the competitor list): it
  // drops, which is the safe direction.
  const dropped = pinned.filter((c) => !kept0.includes(c));
  assert.deepEqual(dropped.map((c) => c.claim.slice(0, 22)), ['Same-class competitors']);
  assert.ok(kept0.some((c) => c.nct_id === 'NCT07602855'), 'found-trial tick holds while still found, same lead sponsor');
  const changed = structuredClone(p);
  const row = changed.rows.find((r) => r.nct_id === 'NCT05899608')!;
  row.check!.latest_milestone = { ...row.check!.latest_milestone!, date: '2026-10-01' };
  row.check!.earlier_milestones = [];
  const kept = carryOver(pinned, changed);
  assert.ok(!kept.some((c) => c.nct_id === 'NCT05899608' && c.verdict === 'confirmed'), 'changed claim drops its tick');
});

test('competitors merge across packs sharing a ChEMBL molecule (Summit and Akeso)', () => {
  const merged = mergeCompetitors({ summit: pack('summit'), akeso: pack('akeso') });
  assert.deepEqual(merged.summit.mechanism?.competitors_merged_from?.sort(), ['akeso', 'summit']);
  assert.equal(merged.summit.mechanism?.competitors.length, merged.akeso.mechanism?.competitors.length);
});

test('monitor events match trials by NCT ID, then name, then asset', () => {
  const p = pack('summit');
  assert.deepEqual(matchEvent(p, eventContent({ content: { assets: [], nct_ids: ['nct05899608'], trial_names: [], update_type: 'interim_data', summary: '' } })), { match: 'trial', trials: ['NCT05899608'] });
  assert.equal(matchEvent(p, eventContent({ content: { assets: ['ivonescimab'], nct_ids: [], trial_names: [], update_type: 'other', summary: '' } })).match, 'program');
  assert.equal(matchEvent(p, eventContent({ content: JSON.stringify({ assets: ['unrelated'], nct_ids: [], trial_names: [], update_type: 'other', summary: 'x' }) })).match, 'none');
  const a = { event_id: 'a', event_date: '2026-10-01', received: '2026-10-02' } as StoredEvent;
  const b = { event_id: 'b', event_date: '2026-10-03', received: '2026-10-03' } as StoredEvent;
  assert.deepEqual(mergeEvents([a], [a, b]).map((e) => e.event_id), ['b', 'a']);
});

test('a follow-up check patches one row and keeps totals consistent', () => {
  const p = pack('summit');
  const row = p.rows.find((r) => r.nct_id === 'NCT06840834')!;
  const check = { ...row.check!, latest_milestone: { type: 'topline_results', description: 'x', date: '2026-10-04', source_url: 'https://example.com/pr' }, earlier_milestones: [], flag: 'news' as const };
  const next = patchCheck(p, 'NCT06840834', check)!;
  assert.equal(next.rows.find((r) => r.nct_id === 'NCT06840834')!.check!.flag, 'news');
  assert.deepEqual(next.totals.flags, totalsOf(next).flags);
  assert.ok(!next.rows.find((r) => r.nct_id === 'NCT06840834')!.check!.hand_checked?.some((c) => c.verdict === 'confirmed'), 'tick dropped for new claim');
  assert.equal(patchCheck(p, 'NCT99999999', check), null);
});

test('run events compact to searches, pages read, connector calls and stats', () => {
  assert.deepEqual(compactRunEvent({ type: 'task_run.progress_msg.tool_call', message: 'Executing MCP tool call on server pubmed with tool search_articles.' }, 'r', 3), { k: 'tool', run: 'r', t: 3, connector: 'pubmed', tool: 'search_articles' });
  assert.equal(compactRunEvent({ type: 'task_run.progress_msg.tool_call', message: 'Listing tools for MCP server pubmed.' }, 'r', 3), null);
  assert.deepEqual(compactRunEvent({ type: 'task_run.progress_msg.search', message: 'Objective: Find X' }, 'r', 1), { k: 'search', run: 'r', t: 1, m: 'Find X' });
  assert.equal(compactRunEvent({ type: 'task_run.progress_msg.plan', message: 'x' }, 'r', 1), null);
});

test('connector citations map to public pages', () => {
  assert.equal(publicUrl('https://clinicaltrials.gov/api/v2/studies/NCT05899608'), 'https://clinicaltrials.gov/study/NCT05899608');
});

test('trial names: title acronym, program lead-in, trial codes; never bare asset codes or indications', async () => {
  const { trialName } = await import('../src/lib/view/format');
  const row = (title: string, program: string | null = null) => ({ nct_id: 'NCT00000001', title, check: { program } });
  assert.equal(trialName(row('A Study of Ivonescimab (HARMONi-3)')), 'HARMONi-3');
  assert.equal(trialName(row('Phase III Study', 'HARMONi-GI3: ivonescimab plus mFOLFOX6')), 'HARMONi-GI3');
  assert.equal(trialName(row('Study', 'SEVILLA — ivonescimab versus FOLFOX')), 'SEVILLA');
  assert.equal(trialName(row('Study', 'Ivonescimab (Bi-MAPS/IFCT-2403), relapsed mesothelioma')), 'Bi-MAPS');
  assert.equal(trialName(row('Study', 'KOMZIFTI (ziftomenib): KOMET-001 in NPM1-mutated AML')), 'KOMET-001');
  assert.equal(trialName(row('Study (NSCLC)', 'AXS-05 in agitation')), 'NCT00000001');
  assert.equal(trialName(row('Study'), 'NSCLC'), 'NCT00000001', 'registry acronyms are checked too');
});
