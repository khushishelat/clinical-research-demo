import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GET as company } from '../src/app/api/company/[key]/route';
import { GET as registry } from '../src/app/api/registry/[key]/route';
import { GET as cronRefresh } from '../src/app/api/cron/refresh/route';
import { POST as research } from '../src/app/api/research/route';
import { GET as replay } from '../src/app/api/replay/[key]/route';
import { POST as askRoute } from '../src/app/api/ask/route';
import { setContextForTests } from '../src/lib/server/context';
import { recordedRegistry, testContext } from './helpers';

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

test('GET /api/company/:key serves the recorded pack with its landscape (fixture mode, no network)', async () => {
  setContextForTests(testContext());
  const res = await company(new Request('http://x/api/company/summit'), params({ key: 'summit' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.source, 'recorded');
  assert.equal(body.pack.rows.length, 31);
  assert.ok(body.layout.areas.length > 0);
  assert.deepEqual(body.pack.mechanism.competitors_merged_from.sort(), ['akeso', 'summit']);
  assert.equal(body.refresh.next, '2026-10-12');
  assert.equal((await company(new Request('http://x'), params({ key: '../etc' }))).status, 404);
  assert.equal((await company(new Request('http://x'), params({ key: 'nobody' }))).status, 404);
});

test('GET /api/registry/:key recomputes flags against today’s registry', async () => {
  setContextForTests(testContext({ registry: recordedRegistry('summit', { NCT05899608: 'ACTIVE_NOT_RECRUITING', NCT06840834: 'ENROLLING_BY_INVITATION' }) }));
  const body = await (await registry(new Request('http://x'), params({ key: 'summit' }))).json();
  assert.equal(body.changed, 2);
  assert.equal(body.freshness.NCT05899608.state, 'caught_up');
  assert.equal(body.freshness.NCT06840834.state, 'changed_pending');
  const cached = await (await registry(new Request('http://x'), params({ key: 'summit' }))).json();
  assert.equal(cached.cached, true);
});

test('cron routes need CRON_SECRET; research is unavailable in fixture mode', async () => {
  setContextForTests(testContext());
  assert.equal((await cronRefresh(new Request('http://x/api/cron/refresh'))).status, 401);
  const ok = await cronRefresh(new Request('http://x/api/cron/refresh', { headers: { authorization: 'Bearer cron-test' } }));
  assert.equal((await ok.json()).skipped, 'fixture mode');
  const r = await research(new Request('http://x/api/research', { method: 'POST', body: JSON.stringify({ name: 'Some Co' }) }));
  assert.equal(r.status, 503);
});

test('GET /api/replay/:key serves the compact recorded log', async () => {
  const res = await replay(new Request('http://x'), params({ key: 'summit' }));
  const body = await res.json();
  assert.equal(body.runs.length, 33);
  assert.ok(body.events.some((e: any) => e.k === 'tool' && e.connector === 'clinical_trials'));
});

test('POST /api/ask streams a clear message when live mode is off', async () => {
  setContextForTests(testContext());
  const res = await askRoute(new Request('http://x/api/ask', { method: 'POST', body: JSON.stringify({ key: 'summit', question: 'Is HARMONi-3 still enrolling?' }) }));
  assert.equal(res.headers.get('content-type')?.startsWith('text/event-stream'), true);
  const text = await res.text();
  assert.match(text, /"k":"error"/);
  assert.match(text, /live-only/);
});
