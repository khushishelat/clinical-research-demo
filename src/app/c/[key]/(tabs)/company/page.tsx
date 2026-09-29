import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Chip, Disclaimer, Label, SourceChip, Unconfirmed } from '@/components/ui';
import { ctx } from '@/lib/server/context';
import { relatedOf } from '@/lib/view/landscape';
import { getView } from '../../data';

export const dynamic = 'force-dynamic';

const STATUS: Record<string, string> = {
  approved: 'Approved',
  active: 'Active',
  regulatory_submission: 'Filed',
  partnered_or_out_licensed: 'Partnered or out-licensed',
  deprioritized: 'Deprioritized',
  discontinued: 'Discontinued',
};

export default async function CompanyPage({ params }: PageProps<'/c/[key]/company'>) {
  const { key } = await params;
  const view = await getView(key);
  if (!view) notFound();
  const { pack } = view;
  const snap = pack.snapshot;
  const c = ctx();
  const known = Object.fromEntries(Object.entries(view.known).map(([k, v]) => [k, { name: v.name, match: c.companies.find((co) => co.key === k)?.match }]));
  const related = relatedOf(pack, known, key);
  const programs = snap?.programs ?? [];
  const byStatus = count(programs.map((p) => p.status));
  const byPhase = count(programs.map((p) => p.phase.replace(/^Phase /i, 'Phase ')));
  const byAsset = count(programs.map((p) => p.asset.split('(')[0].trim().toLowerCase()));
  const topAsset = Object.entries(byAsset).sort((a, b) => b[1] - a[1])[0];
  const unverified = (pack.review ?? []).filter((r) => !r.nct_id && r.verdict === 'unverified');
  const live = pack.snapshot_live;

  return (
    <div className="pb-8">
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="p-6">
          <Label>Disclosure used</Label>
          <p className="mt-2 text-[20px]">{snap?.latest_filing ?? 'Company disclosures'}</p>
          <p className="mt-1 text-[14px] text-muted">Plus company press releases up to the research date, {pack.about.recorded}.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[...new Set(programs.map((p) => p.source_url))].slice(0, 3).map((u) => (
              <SourceChip key={u} url={u} />
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <Label>{programs.length} programs as disclosed</Label>
            <Link href={`/c/${key}`} className="font-mono text-[11px] uppercase underline">
              Each is a header in Landscape →
            </Link>
          </div>
          <div className="mt-4 flex flex-wrap gap-6">
            {Object.entries(byStatus).map(([s, n]) => (
              <div key={s}>
                <p className="text-[32px] leading-none">{n}</p>
                <p className="mt-1 text-[13px] text-muted">{STATUS[s] ?? s}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {Object.entries(byPhase)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([ph, n]) => (
                <Chip key={ph}>
                  {n} · {ph}
                </Chip>
              ))}
          </div>
          {topAsset ? (
            <p className="mt-4 text-[14px]">
              <span className="font-medium">
                {topAsset[1]} of {programs.length}
              </span>{' '}
              are <span className="capitalize">{topAsset[0]}</span>.
            </p>
          ) : null}
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[20px]">Partnerships</h2>
          <p className="text-[13px] text-muted">{snap?.partnerships.length ?? 0} found · each links to the company when we have its research</p>
        </div>
        {(snap?.partnerships ?? []).map((p) => {
          const r = related.find((x) => p.partner.toLowerCase().includes(x.name.toLowerCase().split(' ')[0]));
          const doubt = unverified.find((u) => u.claim.toLowerCase().includes(p.partner.toLowerCase().split(/[ ,]/)[0]));
          return (
            <div key={p.partner} className="grid gap-2 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[220px_minmax(0,1fr)_160px] md:gap-6">
              <div>
                <p className="text-[15px] font-medium">{p.partner}</p>
                {r?.key ? (
                  <Link href={`/c/${r.key}`} className="mt-1 inline-block font-mono text-[10px] uppercase underline">
                    Recorded · instant →
                  </Link>
                ) : (
                  <span className="mt-1 inline-block font-mono text-[10px] uppercase text-muted">Not researched</span>
                )}
              </div>
              <p className="text-[14px]">{doubt ? <Unconfirmed note={doubt.note}>{p.scope}</Unconfirmed> : p.scope}</p>
              <div>
                <SourceChip url={p.source_url} />
              </div>
            </div>
          );
        })}
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Label>Where the rest of the company snapshot went</Label>
          <dl className="mt-3 space-y-2 text-[14px]">
            <Row k="Pipeline table" v="Program headers in Landscape: status, latest milestone, next catalyst" />
            <Row k="Partner-run trials" v="Inside their programs, badged Found by research" />
            <Row k="Mechanism and competitors" v="Competitive set tab" />
            <Row k="Catalysts" v="The strip under What's new" />
          </dl>
        </Card>
        <Card dark className="p-6">
          <Label className="text-[#adadac]">How this tab was made</Label>
          <dl className="mt-3 space-y-2 font-mono text-[13px]">
            <Row k="Processor" v="ultra" dark />
            <Row k="Time" v={pack.totals.snapshot_seconds ? `${pack.totals.snapshot_seconds} s` : '—'} dark />
            <Row k="Sources considered · read" v={live ? `${live.sources_considered ?? '—'} · ${live.sources_read ?? '—'}` : '—'} dark />
            <Row k="Connector calls" v={String(pack.snapshot_connector_log?.length ?? 0)} dark />
          </dl>
          <Link href={`/c/${key}/hood`} className="mt-4 inline-block font-mono text-[11px] uppercase text-page underline">
            Under the hood →
          </Link>
        </Card>
      </div>
      <Disclaimer />
    </div>
  );
}

function Row({ k, v, dark }: { k: string; v: string; dark?: boolean }) {
  return (
    <div className={`grid grid-cols-[200px_minmax(0,1fr)] gap-4 border-b pb-2 last:border-b-0 ${dark ? 'border-machine-line' : 'border-line'}`}>
      <dt className={dark ? 'text-[#adadac]' : 'text-muted'}>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function count(xs: string[]) {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
