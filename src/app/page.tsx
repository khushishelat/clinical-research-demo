import Link from 'next/link';
import { Ago } from '@/components/v5/Ago';
import { Favicon } from '@/components/v5/Favicon';
import { Header } from '@/components/v5/Header';
import { REPO_URL, REQUEST_URL } from '@/lib/links';
import { homeView } from '@/lib/space/home';
import { builtDiseases } from '@/lib/space/load';

export const revalidate = 3600;

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const money = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B` : `$${Math.round(n / 1e6)}M`);

export default async function Home() {
  const built = await builtDiseases();
  if (!built.length) return <Empty />;
  const { cards, latest } = await homeView(new Date().toISOString().slice(0, 10));
  const areas = [...new Set(cards.map((c) => c.area))];
  return (
    <>
      <Header current="" diseases={built} updated={null} />
      <main className="px-4 pb-16 sm:px-8">
        <section className="max-w-[820px] pt-12">
          <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Competitive landscapes by indication</p>
          <h1 className="mt-2 text-[30px] leading-[1.1] tracking-[-0.01em] sm:text-[40px]">Every company, trial and readout in an indication, kept current every day.</h1>
          <p className="mt-4 text-[16px] leading-relaxed text-muted">
            Pick an indication to see who is developing what, how far along each drug is, what has been announced and what is expected next, with the investigators behind the trials. Built from ClinicalTrials.gov, PubMed and the NPI Registry with Parallel&apos;s Task and Monitor APIs; every fact links to its source.
          </p>
        </section>

        <div className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-8">
            {areas.map((area) => (
              <section key={area} aria-label={area}>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{area}</h2>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {cards
                    .filter((c) => c.area === area)
                    .map((c) => (
                      <li key={c.key}>
                        <Link href={`/d/${c.key}`} className="group block h-full rounded-[4px] border border-line bg-card p-5 transition-colors hover:border-ink">
                          <p className="flex items-baseline justify-between gap-3">
                            <span className="text-[22px] leading-tight">{c.name}</span>
                            <span aria-hidden="true" className="font-mono text-[12px] text-muted group-hover:text-ink">
                              Open map →
                            </span>
                          </p>
                          {c.subtitle ? <p className="mt-1 text-[13px] text-muted">{c.subtitle}</p> : null}
                          <dl className="mt-4 grid grid-cols-3 gap-3">
                            <div>
                              <dd className="text-[20px] leading-none">{c.trials}</dd>
                              <dt className="mt-1 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Active trials</dt>
                            </div>
                            <div>
                              <dd className="text-[20px] leading-none">{c.companies}</dd>
                              <dt className="mt-1 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">Companies</dt>
                            </div>
                            <div>
                              <dd className="text-[20px] leading-none">{c.dealDollars ? money(c.dealDollars) : c.deals}</dd>
                              <dt className="mt-1 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">{c.dealDollars ? `${c.deals} asset deals` : 'Asset deals'}</dt>
                            </div>
                          </dl>
                          {c.brief ? (
                            <p className="mt-4 border-t border-line pt-3 text-[13px]">
                              <span className="mr-1.5 inline-block h-1.5 w-1.5 bg-orange align-middle" />
                              <span className="text-muted">This week: </span>
                              {c.brief.title}
                            </p>
                          ) : null}
                          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.04em] text-faint">
                            {c.updated ? <Ago iso={c.updated} /> : null}
                          </p>
                        </Link>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
            <a href={REQUEST_URL} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 rounded-[4px] border border-dashed border-line-strong p-5 hover:border-ink">
              <span>
                <span className="block text-[16px]">Don&apos;t see your indication?</span>
                <span className="mt-1 block text-[13px] text-muted">Request one on GitHub. A person reviews each request before it is built.</span>
              </span>
              <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.04em]">Request an indication ↗</span>
            </a>
          </div>

          <aside aria-label="Latest across indications" className="h-fit rounded-[4px] border border-line bg-card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-[14px] font-medium">Latest across indications</h2>
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.05em] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-ok" /> Daily
              </span>
            </div>
            <ul>
              {latest.map((f) => (
                <li key={`${f.indication}-${f.id}`} className="border-t border-line first:border-t-0">
                  <Link href={f.nct ? `/d/${f.indication}?trial=${f.nct}` : `/d/${f.indication}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 px-4 py-3 hover:bg-wash">
                    <span className="flex items-start gap-1.5 font-mono text-[11px] text-muted">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 ${f.origin === 'registry' ? 'bg-ink' : 'bg-orange'}`} />
                      {fmt(f.date)}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[12px] text-muted">
                        <Favicon host={f.host} name={f.company} size={14} /> {f.company} · {f.indicationNames.join(', ')}
                      </span>
                      <span className="mt-0.5 block text-[14px]">{f.headline}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        </div>

        <section aria-label="How it is built" className="mt-14 border-t border-line pt-8">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">How it&apos;s built</h2>
          <ol className="mt-4 grid gap-6 sm:grid-cols-3">
            <li>
              <p className="text-[15px] font-medium">1 · The registry</p>
              <p className="mt-1 text-[14px] text-muted">Every drug trial for the indication from ClinicalTrials.gov, and the companies that own the drugs, found with Parallel Task runs and the ChEMBL connector.</p>
            </li>
            <li>
              <p className="text-[15px] font-medium">2 · The research</p>
              <p className="mt-1 text-[14px] text-muted">One Task run per company for its drugs, readouts, deals and regulatory status, with the ClinicalTrials.gov and PubMed connectors. Every field keeps its sources.</p>
            </li>
            <li>
              <p className="text-[15px] font-medium">3 · Kept current</p>
              <p className="mt-1 text-[14px] text-muted">Each day, a fresh registry diff and a news Monitor per indication; each week, a deep-research brief. Investigators are matched to the NPI Registry and PubMed.</p>
            </li>
          </ol>
          <p className="mt-6 text-[13px] text-muted">
            The code is open source:{' '}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="underline decoration-line-strong underline-offset-2 hover:decoration-ink">
              {REPO_URL.replace('https://', '')}
            </a>
            .
          </p>
        </section>

        <p className="mt-10 border-t border-line pt-6 text-[12px] text-muted">Research support from public sources. Not investment or medical advice. Coverage of trials and news is not complete. Investigator details are professional facts only, never contact details or opinions.</p>
      </main>
    </>
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
