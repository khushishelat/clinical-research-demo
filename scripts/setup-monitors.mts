// Creates one event_stream monitor per recorded company (base, daily) with a
// webhook to this deployment, and writes their IDs to data/monitors.json
// (committed, like datacenter-map-demo). Monitors bill daily until cancelled.
//
//   npm run setup-monitors -- --mode=create      needs PARALLEL_API_KEY and PUBLIC_BASE_URL
//   npm run setup-monitors -- --mode=webhook     point existing monitors at PUBLIC_BASE_URL
//   npm run setup-monitors -- --mode=cancel      cancel every monitor in data/monitors.json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Parallel from 'parallel-web';
import { MONITOR_EVENT_SCHEMA, monitorQueryFor } from '../src/lib/domain/monitor';
import type { CompanyConfig, Pack } from '../src/lib/domain/types';

const root = join(import.meta.dirname, '..');
const file = join(root, 'data', 'monitors.json');
const mode = process.argv.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'create';
const apiKey = process.env.PARALLEL_API_KEY?.trim();
if (!apiKey) throw new Error('Set PARALLEL_API_KEY (in .env.local).');
const client = new Parallel({ apiKey });
const base = (process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
const webhook = base ? { url: `${base}/api/webhooks/parallel`, event_types: ['monitor.event.detected' as const] } : null;

type Registry = { created: string; monitors: { key: string; company: string; monitor_id: string; query: string; processor: 'base' }[] };
const companies = JSON.parse(readFileSync(join(root, 'data', 'companies.json'), 'utf8')) as CompanyConfig[];
const pack = (key: string) => JSON.parse(readFileSync(join(root, 'fixtures', 'recorded', `${key}.json`), 'utf8')) as Pack;

if (mode === 'create') {
  if (existsSync(file)) throw new Error(`${file} exists. Cancel those monitors first, or use --mode=webhook.`);
  if (!webhook) throw new Error('Set PUBLIC_BASE_URL so monitor events reach /api/webhooks/parallel.');
  const monitors: Registry['monitors'] = [];
  for (const co of companies) {
    const query = monitorQueryFor(pack(co.key));
    const m = await client.monitor.create({
      type: 'event_stream',
      frequency: '1d',
      // base, not lite: wider recall across partners, non-US filings and conferences.
      processor: 'base',
      settings: { query, output_schema: { type: 'json', json_schema: MONITOR_EVENT_SCHEMA as unknown as Record<string, unknown> } },
      webhook,
      metadata: { app: 'trial-check', company: co.key },
    });
    monitors.push({ key: co.key, company: co.name, monitor_id: m.monitor_id, query, processor: 'base' });
    console.log(`created ${m.monitor_id} for ${co.name}`);
    await new Promise((r) => setTimeout(r, 300));
  }
  writeFileSync(file, JSON.stringify({ created: new Date().toISOString(), monitors } satisfies Registry, null, 2) + '\n');
  console.log(`${monitors.length} monitors, daily, about $${(monitors.length * 0.01).toFixed(2)} a day. Wrote data/monitors.json.`);
} else if (mode === 'webhook') {
  if (!webhook) throw new Error('Set PUBLIC_BASE_URL.');
  const reg = JSON.parse(readFileSync(file, 'utf8')) as Registry;
  for (const m of reg.monitors) {
    await client.monitor.update(m.monitor_id, { webhook });
    console.log(`webhook set on ${m.monitor_id} (${m.company})`);
  }
} else if (mode === 'cancel') {
  const reg = JSON.parse(readFileSync(file, 'utf8')) as Registry;
  for (const m of reg.monitors) {
    const res = await client.monitor.cancel(m.monitor_id);
    console.log(`cancelled ${m.monitor_id} (${m.company}) → ${res.status}`);
  }
} else throw new Error(`unknown --mode=${mode}`);
