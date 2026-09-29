import { after } from 'next/server';
import { Ask } from '@/components/Ask';
import { Landscape } from '@/components/Landscape';
import { LiveRun } from '@/components/LiveRun';
import { Replay } from '@/components/Replay';
import { Chip, Disclaimer, Label } from '@/components/ui';
import { ctx } from '@/lib/server/context';
import { advanceRequest } from '@/lib/server/research';
import { today } from '@/lib/server/guards';
import { landscapeView } from '@/lib/view/landscape';
import { namesOf } from '@/lib/view/names';
import { getJob, getView, hasReplay } from '../data';

export const dynamic = 'force-dynamic';

export default async function LandscapePage({ params, searchParams }: PageProps<'/c/[key]'>) {
  const { key } = await params;
  const sp = await searchParams;
  const run = typeof sp.run === 'string' && /^tgrp_[a-z0-9]+$/.test(sp.run) ? sp.run : null;
  const view = await getView(key);
  const c = ctx();
  const now = c.now();

  if (run || !view) {
    const job = await getJob(key);
    if (job && job.phase !== 'finalized' && job.phase !== 'failed') after(() => advanceRequest(c, key).catch(() => null));
    return <LiveRun keyName={key} company={view?.pack.about.company ?? job?.company.name ?? key} gid={run ?? job?.taskgroup_id ?? null} phase={job?.phase ?? null} startedAt={job?.started_at ?? null} message={job?.error ?? null} />;
  }

  const known = Object.fromEntries(Object.entries(view.known).map(([k, v]) => [k, { name: v.name, match: c.companies.find((co) => co.key === k)?.match }]));
  const names = namesOf(view.pack);
  const lv = landscapeView(view.pack, today(now), known, key, names);
  const replay = sp.replay === '1' && (await hasReplay(key));
  return (
    <>
      <Landscape view={lv} names={names} keyName={key} nextRefresh={view.refresh.next} events={view.events} today={today(now)} />
      {replay ? <Replay keyName={key} company={view.pack.about.company} recorded={view.pack.about.recorded} /> : null}
      <details className="mt-10">
        <summary className="cursor-pointer text-[15px]">
          <span className="font-medium underline decoration-line-strong underline-offset-4">Ask about {view.pack.about.company}</span>{' '}
          <Chip tone="dashed">Experimental</Chip>
        </summary>
        <p className="mt-1 text-[13px] text-muted">Quick answers can be wrong. They never change a flag.</p>
        <Ask keyName={key} company={view.pack.about.company} bare />
      </details>
      <Disclaimer>
        <Label>
          {String(view.pack.totals.connector_calls ?? '')} connector calls · recorded {view.pack.about.recorded}
        </Label>
      </Disclaimer>
    </>
  );
}
