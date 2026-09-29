import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import type { Pack } from '../src/lib/domain/types';
import type { StoredEvent } from '../src/lib/domain/monitor';
import { drainFollowups, handleWebhook } from '../src/lib/server/followups';
import { allowRequest, reserveBudget, verifyWebhook } from '../src/lib/server/guards';
import { memoryKv } from '../src/lib/server/kv';
import { advance, newJob, type JobState } from '../src/lib/server/pipeline';
import { refreshTick, isoWeek, nextRefreshDate } from '../src/lib/server/refresh';
import { companyFromName, requestResearch, advanceRequest } from '../src/lib/server/research';
import { paths } from '../src/lib/server/store';
import { typeahead } from '../src/lib/server/typeahead';
import { FakeParallel, WEBHOOK_SECRET, company, pack, recordedOutput, recordedRegistry, testContext } from './helpers';

const sign = (body: string, id = 'msg_1', ts = Math.floor(new Date('2026-10-05T12:00:00Z').getTime() / 1000)) => {
  const key = Buffer.from(WEBHOOK_SECRET.slice(6), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return new Map([['webhook-id', id], ['webhook-timestamp', String(ts)], ['webhook-signature', `v1,${sig}`]]);
};

test('webhook signature: valid, tampered, stale, and multi-signature headers', () => {
  const body = '{"type":"x"}';
  const h = sign(body);
  const now = Math.floor(new Date('2026-10-05T12:00:00Z').getTime() / 1000);
  const hdr = { id: h.get('webhook-id')!, timestamp: h.get('webhook-timestamp')!, signature: h.get('webhook-signature')! };
  assert.equal(verifyWebhook(WEBHOOK_SECRET, hdr, body, now), true);
  assert.equal(verifyWebhook(WEBHOOK_SECRET, hdr, body + ' ', now), false);
  assert.equal(verifyWebhook(WEBHOOK_SECRET, hdr, body, now + 301), false);
  assert.equal(verifyWebhook(WEBHOOK_SECRET, { ...hdr, signature: `v1,bogus ${hdr.signature}` }, body, now), true);
  assert.equal(verifyWebhook('', hdr, body, now), false);
});

test('budgets and per-client limits', async () => {
  const kv = memoryKv();
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(await reserveBudget(kv, 'ask', 3, 5, now), true);
  assert.equal(await reserveBudget(kv, 'ask', 3, 5, now), false, 'over cap reserves nothing');
  assert.equal(await reserveBudget(kv, 'ask', 2, 5, now), true, 'the failed reservation was released');
  assert.equal(await reserveBudget(kv, 'ask', 1, 5, new Date('2026-10-06T00:00:01Z')), true, 'new day, new cap');
  for (let i = 0; i < 2; i += 1) assert.equal(await allowRequest(kv, 'research', 'ip', 2, now), true);
  assert.equal(await allowRequest(kv, 'research', 'ip', 2, now), false);
});

function liveSummit() {
  const fake = new FakeParallel((m) => recordedOutput(pack('summit'), m));
  const c = testContext({ parallel: fake.asClient(), registry: recordedRegistry('summit') });
  return { fake, c };
}

test('pipeline: stage 1 → group → snapshot adds found checks once → finalized pack', async () => {
  const { fake, c } = liveSummit();
  const job = newJob(company('summit'), 'research', c.now());
  const saved: JobState[] = [];
  const save = async (s: JobState) => void saved.push(structuredClone(s));

  let step = await advance(job, c, save);
  assert.equal(step.state.phase, 'submitted');
  assert.equal(job.runs.added, 33, '31 trial checks + snapshot + mechanism');
  assert.ok(saved.some((s) => s.phase === 'created' && s.taskgroup_id), 'group ID saved before runs were added');

  step = await advance(job, c, save);
  assert.equal(step.status, 'waiting', 'nothing finished yet');

  fake.complete((m) => m.kind === 'snapshot');
  step = await advance(job, c, save);
  assert.equal(step.status, 'advanced');
  assert.equal(Object.keys(job.found).length, 20, 'Summit: 20 found-by-research trials confirmed and added');
  assert.equal(job.runs.added, 53);

  step = await advance(job, c, save);
  assert.equal(step.status, 'waiting');
  assert.equal(job.runs.added, 53, 'found checks are added once');

  fake.complete();
  step = await advance(job, c, save);
  assert.equal(step.status, 'finalized');
  const latest = await c.store.get<Pack>(paths.latestPack('summit'));
  assert.ok(latest);
  assert.equal(latest!.rows.length, 31);
  assert.equal(latest!.found_beyond_registry_search.length, 20);
  assert.ok(latest!.found_beyond_registry_search.every((f) => f.check), 'every found trial checked');
  assert.equal(latest!.about.recorded, '2026-10-05');
  assert.ok(await c.store.get(paths.datedPack('summit', '2026-10-05')));
  assert.equal(job.actual_cost_usd, 5.5, '52 pro + 1 ultra at list price');
  assert.equal(fake.addCalls, 2);
});

test('pipeline: a lost addRuns response never double-adds', async () => {
  const { fake, c } = liveSummit();
  fake.loseNextAddResponse = true;
  const job = newJob(company('summit'), 'research', c.now());
  const step = await advance(job, c, async () => {});
  assert.equal(step.state.phase, 'created', 'group kept; adds unconfirmed');
  await advance(job, c, async () => {});
  assert.equal(job.phase, 'submitted');
  const runs = fake.runs.get(job.taskgroup_id!)!;
  assert.equal(runs.length, 33, 'the retry added nothing that was already there');
});

test('pipeline: over the daily budget queues instead of starting', async () => {
  const { c } = liveSummit();
  await reserveBudget(c.kv, 'research', 14, 15, c.now());
  const job = newJob(company('summit'), 'research', c.now());
  const step = await advance(job, c, async () => {});
  assert.equal(step.status, 'queued');
  assert.equal(job.taskgroup_id, null);
});

test('weekly refresh: one blob per week; each call advances every company; carries found trials and ticks', async () => {
  const fakes = new FakeParallel((m) => recordedOutput(pack(m.company), m));
  const registries: Record<string, ReturnType<typeof recordedRegistry>> = {};
  const c = testContext({ parallel: fakes.asClient() });
  c.registry = {
    companyTrials: (co) => (registries[co.key] ??= recordedRegistry(co.key)).companyTrials(co),
    // Lookups can span companies (found trials); try every recorded pack.
    lookup: async (ids) => Object.assign({}, ...(await Promise.all(c.companies.map((co) => (registries[co.key] ??= recordedRegistry(co.key)).lookup(ids))))),
  };
  let tick = await refreshTick(c);
  assert.equal(tick.week, '2026-W41');
  assert.equal(Object.values(tick.companies).filter((x) => x.phase === 'submitted').length, 6);
  fakes.complete((m) => m.kind === 'snapshot');
  tick = await refreshTick(c);
  fakes.complete();
  tick = await refreshTick(c);
  tick = await refreshTick(c);
  assert.deepEqual(new Set(Object.values(tick.companies).map((x) => x.phase)), new Set(['finalized']));
  const summit = await c.store.get<Pack>(paths.latestPack('summit'));
  assert.equal(summit!.about.recorded, '2026-10-05');
  assert.equal(summit!.found_beyond_registry_search.length, 20);
  assert.ok((summit!.review ?? []).some((r) => r.nct_id === 'NCT05899608' && r.verdict === 'confirmed'), 'unchanged claim keeps its tick');
  const again = await refreshTick(c);
  assert.equal(fakes.addCalls > 0 && Object.values(again.companies).every((x) => x.phase === 'finalized'), true, 'finished week is idle');
});

test('refresh dates', () => {
  assert.equal(isoWeek(new Date('2026-09-28T00:00:00Z')), '2026-W40');
  assert.equal(nextRefreshDate(new Date('2026-09-28T12:00:00Z')), '2026-10-05', 'Monday → next Monday');
  assert.equal(nextRefreshDate(new Date('2026-10-03T12:00:00Z')), '2026-10-05');
});

test('webhook → queue → follow-up check → row patched and labeled', async () => {
  const fake = new FakeParallel((m) => {
    if (m.kind === 'monitor_followup')
      return { content: { program: 'HARMONi-3', latest_milestone: { type: 'topline_results', description: 'Topline PFS reported', date: '2026-10-04', source_url: 'https://example.com/pr' }, earlier_milestones: [{ type: 'enrollment_completed', description: '', date: '2026-07-23', source_url: null }], results_publications: [], next_catalyst: null }, basis: [], mcp_tool_calls: [] };
    return recordedOutput(pack('summit'), m);
  });
  const c = testContext({ parallel: fake.asClient() });
  fake.monitorEvents.mevtgrp_1 = [
    { event_type: 'event_stream', event_id: 'ev_1', event_group_id: 'mevtgrp_1', event_date: '2026-10-04', output: { content: { assets: ['ivonescimab'], nct_ids: ['NCT05899608'], trial_names: ['HARMONi-3'], update_type: 'topline_results', summary: 'Summit reported HARMONi-3 topline PFS on Oct 4, 2026.' }, basis: [] } },
    { event_type: 'event_stream', event_id: 'ev_2', event_group_id: 'mevtgrp_1', event_date: '2026-10-03', output: { content: { assets: [], nct_ids: [], trial_names: [], update_type: 'other', summary: 'Unrelated.' }, basis: [] } },
  ];
  const body = JSON.stringify({ type: 'monitor.event.detected', data: { monitor_id: 'monitor_1', event: { event_group_id: 'mevtgrp_1' }, metadata: { app: 'trial-check', company: 'summit' } } });
  const h = sign(body, 'msg_a');
  const res = await handleWebhook(c, h as any, body);
  assert.equal(res.status, 200);
  assert.equal((await handleWebhook(c, h as any, body)).body.duplicate, true, 'retried delivery is de-duplicated');
  assert.equal((await handleWebhook(c, sign(body + 'x', 'msg_b') as any, body)).status, 401);

  let drained = await drainFollowups(c);
  assert.equal(drained.started, 1);
  assert.equal(fake.created[0].previous_interaction_id, 'ev_1');
  assert.deepEqual(fake.created[0].advanced_settings.data_sources.free, ['clinical_trials', 'pubmed', 'biorxiv']);
  let events = (await c.store.get<StoredEvent[]>(paths.events('summit')))!;
  assert.deepEqual(events.map((e) => [e.event_id, e.match]), [['ev_1', 'trial'], ['ev_2', 'none']]);

  // Run finishes; its webhook is lost. The next drain polls and applies it.
  fake.complete((m) => m.kind === 'monitor_followup');
  drained = await drainFollowups(c);
  assert.equal(drained.applied, 1);
  const latest = (await c.store.get<Pack>(paths.latestPack('summit')))!;
  const row = latest.rows.find((r) => r.nct_id === 'NCT05899608')!;
  assert.equal(row.check!.latest_milestone!.type, 'topline_results');
  assert.equal(row.check!.flag, 'registry_lagging', 'earlier enrollment completion still flags the lag');
  assert.equal(row.check!.updated_by?.event_id, 'ev_1');
  events = (await c.store.get<StoredEvent[]>(paths.events('summit')))!;
  assert.equal(events[0].followup?.status, 'applied');
  assert.equal((await drainFollowups(c)).applied, 0, 'applied once');
});

test('research requests: names to configs, narrowing over 60 trials, joining an active run', async () => {
  assert.deepEqual(
    { key: companyFromName('Revolution Medicines, Inc.').key, match: companyFromName('Revolution Medicines, Inc.').match },
    { key: 'revolution-medicines-inc', match: 'revolution' }
  );
  assert.equal(companyFromName('Eli Lilly and Company').match, 'eli lilly');

  const fake = new FakeParallel(() => ({ content: null, basis: [] }));
  const many = Array.from({ length: 61 }, (_, i) => ({ nct_id: `NCT${String(10000000 + i)}`, title: '', role: 'company_led' as const, lead_sponsor: 'Big Co', collaborators: [], interventions: [], condition: '', phases: [], status: 'RECRUITING', last_update_posted: '', primary_completion_date: '' }));
  const c = testContext({ parallel: fake.asClient(), registry: { companyTrials: async () => many, lookup: async () => ({}) } });
  const res = await requestResearch(c, { name: 'Big Co' }, 'ip1');
  assert.equal(res.status, 'narrow');
  const narrowed = await requestResearch(c, { name: 'Big Co', only_nct_ids: many.slice(0, 5).map((r) => r.nct_id) }, 'ip1');
  assert.equal(narrowed.status, 'started');
  assert.equal(fake.runs.get((narrowed as any).taskgroup_id)!.length, 7, '5 checks + snapshot + mechanism');
  const joined = await requestResearch(c, { name: 'Big Co' }, 'ip2');
  assert.equal(joined.status, 'joined');
  assert.equal((joined as any).taskgroup_id, (narrowed as any).taskgroup_id);

  // Fixture mode never starts research.
  assert.equal((await requestResearch(testContext(), { name: 'Big Co' }, 'ip3')).status, 'unavailable');
});

test('researched company finalizes into the shared index', async () => {
  const { fake, c } = liveSummit();
  c.companies = c.companies.filter((co) => co.key !== 'summit');
  const res = await requestResearch(c, { name: 'Summit Therapeutics' }, 'ip');
  assert.equal(res.status, 'started');
  fake.complete((m) => m.kind === 'snapshot');
  await advanceRequest(c, 'summit-therapeutics');
  fake.complete();
  const job = await advanceRequest(c, 'summit-therapeutics');
  assert.equal(job?.phase, 'finalized');
  const index = await c.store.get<Record<string, unknown>>('index/researched.json');
  assert.ok(index?.['summit-therapeutics']);
  assert.equal(await c.kv.get('active:summit-therapeutics'), null);
});

test('typeahead: recorded companies first, by alias; then the sponsor index', async () => {
  const c = testContext();
  const res = await typeahead(c, 'summit');
  assert.equal(res[0].state, 'recorded');
  assert.equal(res[0].key, 'summit');
  const ivo = await typeahead(c, 'akeso');
  assert.equal(ivo[0].key, 'akeso');
  assert.equal(ivo[0].scope_label, 'Phase 3 trials only');
  const big = await typeahead(c, 'astrazeneca');
  assert.equal(big[0].state, 'narrow');
  assert.deepEqual(await typeahead(c, 'a'), []);
});
