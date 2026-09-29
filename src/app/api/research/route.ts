import { after } from 'next/server';
import { clientId } from '@/lib/server/guards';
import { badRequest, context, isKey, json, notFound } from '@/lib/server/http';
import { advanceRequest, requestResearch, requestState } from '@/lib/server/research';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Start (or join) research on a company. The browser sends only a name or key; the server builds every spec. */
export async function POST(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  let body: { key?: unknown; name?: unknown; only_nct_ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('Send JSON: { "name": "Company name" }.');
  }
  const key = typeof body.key === 'string' && isKey(body.key) ? body.key : undefined;
  const name = typeof body.name === 'string' ? body.name : undefined;
  const only = Array.isArray(body.only_nct_ids) ? body.only_nct_ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : undefined;
  if (!key && !name) return badRequest('Send a company name.');
  const res = await requestResearch(c, { key, name, only_nct_ids: only }, clientId(request));
  const status = res.status === 'limited' ? 429 : res.status === 'unavailable' ? 503 : res.status === 'failed' ? 422 : 200;
  return json(res, { status });
}

/** Where a research request stands: GET /api/research?key=… */
export async function GET(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!isKey(key)) return notFound();
  const job = await requestState(c, key);
  if (!job) return notFound();
  // Any look at an unfinished request nudges it one step, so a run nobody is
  // watching still finishes between cron sweeps.
  if (job.phase !== 'finalized' && job.phase !== 'failed') after(() => advanceRequest(c, key).catch(() => null));
  const { stage1, company, found, ...rest } = job;
  return json({ ...rest, company: company.name, trials: stage1?.length ?? 0, found_checks: Object.keys(found).length });
}
