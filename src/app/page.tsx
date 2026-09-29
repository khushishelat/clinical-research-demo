import Link from 'next/link';
import { Typeahead } from '@/components/Typeahead';
import { Chip, Disclaimer, Label } from '@/components/ui';
import { ctx, loadPack } from '@/lib/server/context';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: PageProps<'/'>) {
  const sp = await searchParams;
  const initial = typeof sp.q === 'string' ? sp.q.slice(0, 80) : '';
  const c = ctx();
  const recorded = (
    await Promise.all(
      c.companies.map(async (co) => {
        const pack = (await loadPack(co.key, c))?.pack;
        const lags = pack?.rows.filter((r) => r.check?.flag === 'registry_lagging' || r.check?.flag === 'conflict').length ?? 0;
        return { ...co, lags, trials: (pack?.rows.length ?? 0) + (pack?.found_beyond_registry_search.length ?? 0) };
      }),
    )
  ).sort((a, b) => b.lags - a.lags);
  return (
    <main className="mx-auto max-w-[760px] py-16 sm:py-24">
      <Label>Competitive intelligence from public trial data</Label>
      <h1 className="mt-4 text-[36px] leading-[1.1] tracking-[-0.01em] sm:text-[48px]">What a biotech is actually running, and what changed that the registry doesn&apos;t show.</h1>
      <p className="mt-4 max-w-[600px] text-[18px] text-muted">
        Type a company. We read the official registry, then check every trial against the company&apos;s own news, filings and papers, and flag where the registry is behind what the company already said.
      </p>
      <div className="mt-10 flex gap-6 border-b border-line font-mono text-[13px] uppercase tracking-[0.04em]">
        <span className="border-b-2 border-ink pb-2">Company</span>
        <span className="pb-2 text-faint">
          Indication <Chip tone="dashed">Soon</Chip>
        </span>
        <span className="pb-2 text-faint">
          Asset <Chip tone="dashed">Soon</Chip>
        </span>
      </div>
      <div className="mt-6">
        <Typeahead autoFocus initial={initial} />
      </div>
      <div className="mt-12">
        <Label>Or open a recorded company · instant</Label>
        <div className="mt-3 flex flex-wrap gap-2">
          {recorded.map((co) => (
            <Link key={co.key} href={`/c/${co.key}`} className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-card px-4 text-[14px] hover:border-ink">
              {co.name}
              {co.lags ? <Chip tone="orange">{co.lags === 1 ? '1 lag' : `${co.lags} lags`}</Chip> : null}
            </Link>
          ))}
        </div>
      </div>
      <p className="mt-10 text-[14px] text-muted">A new company takes about 8 minutes. You can leave; the link keeps working, and the result is shared with everyone.</p>
      <Disclaimer />
    </main>
  );
}
