import Link from 'next/link';
import { Favicon } from '@/components/v5/Favicon';
import { Header } from '@/components/v5/Header';
import { LiveRefresh, RelDay } from '@/components/v5/Live';
import { MiniMap } from '@/components/v5/MiniMap';
import { REPO_URL, REQUEST_URL } from '@/lib/links';
import { homeView } from '@/lib/space/home';
import { builtDiseases } from '@/lib/space/load';

export const revalidate = 3600;

const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : `$${Math.round(n / 1e6)}M`);

export default async function Home() {
  const built = await builtDiseases();
  if (!built.length) return <Empty />;
  const today = new Date().toISOString().slice(0, 10);
  const { cards, latest } = await homeView(today);
  const updated = cards.map((c) => c.updated).sort().at(-1) ?? null;
  return (
    <>
      <Header current="" diseases={built} updated={updated} />
      <main className="px-4 pb-8 sm:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 pt-8">
          <h1 className="text-[26px] leading-tight tracking-[-0.01em]">Competitive landscapes</h1>
          <p className="font-mono text-[11px] uppercase tracking-[0.05em] text-muted">
            {cards.length} indications · {cards.reduce((n, c) => n + c.trials, 0).toLocaleString('en-US')} active trials · {cards.reduce((n, c) => n + c.companies, 0)} companies
          </p>
        </div>

        <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <ul className="grid content-start gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {cards.map((c) => (
              <li key={c.key}>
                <Link href={`/d/${c.key}`} className="group flex h-full flex-col rounded-[6px] border border-line bg-card p-4 transition-colors hover:border-ink">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-faint">{c.area}</p>
                      <p className="truncate text-[20px] leading-tight">{c.name}</p>
                    </div>
                    {c.week ? (
                      <span title="Trials registered, registry updates and news in the last 7 days" className="flex shrink-0 items-center gap-1.5 rounded-full bg-orange-wash px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em]">
                        <span className="live-ping h-1.5 w-1.5 rounded-full bg-orange" />+{c.week} this week
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-4 opacity-80 transition-opacity group-hover:opacity-100">
                    <MiniMap rows={c.thumb} today={today} />
                  </div>
                  <dl className="mt-4 flex gap-6">
                    <Num value={String(c.trials)} label="Trials" />
                    <Num value={String(c.companies)} label="Companies" />
                    <Num value={c.dealDollars ? money(c.dealDollars) : String(c.deals)} label="Deals" accent />
                  </dl>
                </Link>
              </li>
            ))}
            <li>
              <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 rounded-[6px] border border-dashed border-line-strong text-muted transition-colors hover:border-ink hover:text-ink">
                <span aria-hidden="true" className="text-[28px] leading-none">+</span>
                <span className="text-[14px]">Request an indication</span>
              </a>
            </li>
          </ul>

          <aside aria-label="Live feed" className="h-fit rounded-[6px] border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[13px] font-medium">Live feed</h2>
              <span className="live-dot h-2 w-2 rounded-full bg-ok" />
            </div>
            <ul>
              {latest.map((f) => (
                <li key={`${f.indication}-${f.id}`} className="border-t border-line first:border-t-0">
                  <Link href={f.nct ? `/d/${f.indication}?trial=${f.nct}` : `/d/${f.indication}`} className="flex gap-3 px-4 py-2.5 hover:bg-wash">
                    <span className="mt-0.5 shrink-0">
                      <Favicon host={f.host} name={f.company} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2 text-[12px] text-muted">
                        <span className="truncate">{f.company}</span>
                        <span className="shrink-0 font-mono text-[10px]">
                          <RelDay iso={f.date} short />
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-[13px] leading-snug">{f.headline}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        <span className={`h-1.5 w-1.5 self-center ${f.origin === 'registry' ? 'bg-ink' : 'bg-orange'}`} />
                        {f.indicationNames.map((n) => (
                          <span key={n} className="font-mono text-[9px] uppercase tracking-[0.05em] text-faint">
                            {n}
                          </span>
                        ))}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <LiveRefresh updated={updated} />
        <footer className="mt-10 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-line pt-4 font-mono text-[10px] uppercase tracking-[0.05em] text-faint">
          <span>Parallel Task + Monitor APIs · ClinicalTrials.gov · PubMed · NPI Registry</span>
          <span className="flex gap-4">
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-ink">
              Source ↗
            </a>
            <span>Not investment or medical advice</span>
          </span>
        </footer>
      </main>
    </>
  );
}

function Num({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div>
      <dd className="text-[18px] leading-none">{value}</dd>
      <dt className="mt-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-muted">
        {accent ? <span className="h-1 w-1 bg-orange" /> : null}
        {label}
      </dt>
    </div>
  );
}

// Nothing built yet: the repo ships no data, only the pipeline that makes it.
function Empty() {
  return (
    <main className="mx-auto max-w-[680px] px-4 py-24">
      <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">Trial Check</p>
      <h1 className="mt-4 text-[36px] leading-tight">No indications built yet</h1>
      <p className="mt-4 text-[16px] text-muted">Each competitive landscape is built by the pipeline in scripts/. Add your Parallel API key to .env.local, then build one indication:</p>
      <pre className="mt-6 overflow-x-auto rounded-[4px] bg-ink p-4 font-mono text-[13px] text-page">npm run pipeline -- --disease mash</pre>
      <p className="mt-4 text-[14px] text-muted">Indications are listed in scripts/diseases.json. The README explains each step and what it costs.</p>
    </main>
  );
}
