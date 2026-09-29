import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Card, Chip, ConnectorMarker, Disclaimer, Label } from '@/components/ui';
import { ctx } from '@/lib/server/context';
import { relatedOf } from '@/lib/view/landscape';
import { getView } from '../../data';

export const dynamic = 'force-dynamic';

const PHASES = ['Approved', 'Phase 3', 'Phase 2/3', 'Phase 2', 'Phase 1/2', 'Phase 1', 'Preclinical'];
const phaseRank = (p: string) => {
  const i = PHASES.findIndex((x) => p.toLowerCase().startsWith(x.toLowerCase()));
  return i < 0 ? PHASES.length : i;
};

export default async function CompetitivePage({ params }: PageProps<'/c/[key]/competitive'>) {
  const { key } = await params;
  const view = await getView(key);
  if (!view) notFound();
  const { pack } = view;
  const mech = pack.mechanism;
  const c = ctx();
  const known = Object.fromEntries(Object.entries(view.known).map(([k, v]) => [k, { name: v.name, match: c.companies.find((co) => co.key === k)?.match }]));
  const related = relatedOf(pack, known, key);
  const ownerKey = (owner: string) => Object.entries(known).find(([k, v]) => k !== key && v.match && owner.toLowerCase().includes(v.match))?.[0] ?? null;

  if (!mech) {
    return (
      <Card className="mt-8 p-6">
        <p className="text-[15px] text-muted">The mechanism run did not return for this company.</p>
      </Card>
    );
  }
  const [name, codes] = [mech.lead_asset.split('(')[0].trim(), mech.lead_asset.match(/\(([^)]+)\)/)?.[1]];
  const competitors = [...mech.competitors].sort((a, b) => phaseRank(a.highest_phase) - phaseRank(b.highest_phase));
  const ladder = PHASES.map((ph) => ({ ph, assets: competitors.filter((x) => phaseRank(x.highest_phase) === PHASES.indexOf(ph)) })).filter((l) => l.assets.length);
  const calls = (pack.mechanism_connector_log ?? []).map((l) => ({ tool: l.tool, arguments: l.arguments }));

  return (
    <div className="pb-8">
      <p className="mt-8 font-mono text-[12px] uppercase tracking-[0.05em] text-muted">
        <Link href={`/c/${key}`} className="hover:text-ink">
          ← {pack.about.company} · Landscape
        </Link>{' '}
        · Competitive set
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <Label>Lead asset</Label>
            <ConnectorMarker connector="chembl" calls={calls.filter((_, i) => pack.mechanism_connector_log?.[i]?.connector === 'chembl')} />
          </div>
          <h2 className="mt-3 text-[28px] capitalize">{name}</h2>
          <p className="font-mono text-[12px] text-muted">
            {[codes, mech.chembl_molecule_id, mech.modality].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-3 text-[15px]">{mech.mechanism_of_action}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {mech.targets.map((t) => (
              <div key={t.chembl_target_id ?? t.name} className="rounded-[4px] border border-line px-3 py-2">
                <p className="font-mono text-[13px]">{t.gene_symbol ?? '—'}</p>
                <p className="text-[12px] text-muted">{t.name}</p>
                {t.chembl_target_id ? <p className="font-mono text-[10px] text-faint">{t.chembl_target_id}</p> : null}
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <Label>Highest phase reached · {competitors.length} same-mechanism programs</Label>
          <div className="mt-4 space-y-3">
            {ladder.map((l) => (
              <div key={l.ph} className="grid grid-cols-[100px_minmax(0,1fr)] items-start gap-3">
                <span className="font-mono text-[11px] uppercase text-muted">{l.ph}</span>
                <div className="flex flex-wrap gap-2">
                  {l.assets.map((a) => (
                    <Chip key={a.asset}>{a.asset.split('(')[0].trim()}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-6 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[20px]">Same-mechanism competitors</h2>
            <p className="text-[13px] text-muted">Targets from ChEMBL, then each competitor&apos;s stage confirmed on the registry</p>
          </div>
          <ConnectorMarker connector="chembl" />
        </div>
        <div className="hidden border-b border-line bg-page px-5 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-muted md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_90px_130px_150px] md:gap-4">
          <span>Asset</span>
          <span>Owner</span>
          <span>Mechanism</span>
          <span>Phase</span>
          <span>Example trial</span>
          <span>Company</span>
        </div>
        {competitors.map((x) => {
          const owner = ownerKey(x.company);
          return (
            <div key={x.asset} className="grid gap-2 border-b border-line px-5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_90px_130px_150px] md:gap-4">
              <div>
                <p className="text-[15px] font-medium">{x.asset.split('(')[0].trim()}</p>
                <p className="font-mono text-[11px] text-muted">{x.asset.match(/\(([^)]+)\)/)?.[1] ?? ''}</p>
              </div>
              <p className="text-[14px]">{x.company}</p>
              <p className="text-[14px] text-muted">{x.mechanism}</p>
              <p className="font-mono text-[12px]">{x.highest_phase}</p>
              <div className="flex flex-col gap-1">
                {x.example_nct_ids.slice(0, 2).map((id) => (
                  <a key={id} href={`https://clinicaltrials.gov/study/${id}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] underline decoration-line-strong hover:decoration-ink">
                    {id} ↗
                  </a>
                ))}
              </div>
              <div>
                {owner ? (
                  <Link href={`/c/${owner}`} className="inline-flex h-8 items-center rounded-[4px] border border-ink px-3 font-mono text-[11px] uppercase hover:bg-wash">
                    Open · instant →
                  </Link>
                ) : (
                  <Link href={`/?q=${encodeURIComponent(x.company.split(/[;,(]| with | and /)[0].trim())}`} className="inline-flex h-8 items-center rounded-[4px] border border-line-strong px-3 font-mono text-[11px] uppercase hover:border-ink">
                    Research this
                  </Link>
                )}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-4 border-t border-line bg-page px-5 py-2 font-mono text-[10px] uppercase text-muted">
          <span>Example trials confirmed via the ClinicalTrials.gov connector</span>
          {mech.competitors_merged_from?.length ? <span>· Merged with {mech.competitors_merged_from.filter((k) => k !== key).map((k) => view.known[k]?.name ?? k).join(', ')} (same ChEMBL molecule)</span> : null}
        </div>
      </Card>

      {related.length ? (
        <section className="mt-8">
          <h2 className="text-[20px]">Related companies</h2>
          <p className="text-[13px] text-muted">Partners, licensors and combination sponsors found in this research</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {related.slice(0, 6).map((r) => (
              <Card key={r.name} className="flex flex-col p-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[16px] font-medium">{r.name}</p>
                  <Chip tone={r.key ? 'ink' : 'dashed'}>{r.key ? 'Recorded · instant' : 'Not researched'}</Chip>
                </div>
                <p className="mt-2 flex-1 text-[14px] text-muted">{r.scope}</p>
                <Link href={r.key ? `/c/${r.key}` : `/?q=${encodeURIComponent(r.name)}`} className="mt-3 font-mono text-[11px] uppercase underline">
                  {r.key ? 'Open →' : 'Research this →'}
                </Link>
              </Card>
            ))}
          </div>
        </section>
      ) : null}
      <Disclaimer />
    </div>
  );
}
