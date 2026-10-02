import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Favicon } from '@/components/v5/Favicon';
import { briefFor, loadSpace } from '@/lib/space/load';
import { hostOf } from '@/lib/space/view';

export const revalidate = 3600;

const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function generateMetadata({ params }: PageProps<'/d/[disease]/brief'>): Promise<Metadata> {
  const space = await loadSpace((await params).disease);
  return space ? { title: `${space.config.name} weekly brief · Trial Check` } : {};
}

export default async function BriefPage({ params, searchParams }: PageProps<'/d/[disease]/brief'>) {
  const { disease } = await params;
  const space = await loadSpace(disease);
  if (!space || !space.briefs.length) notFound();
  const asked = (await searchParams).issue;
  const issue = typeof asked === 'string' && space.briefs.includes(asked) ? asked : space.briefs[0];
  const brief = await briefFor(disease, issue);
  if (!brief) notFound();
  return (
    <main className="grid gap-10 px-4 pb-16 pt-8 sm:px-8 lg:grid-cols-[minmax(0,720px)_220px]">
      <article>
        <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
          {space.config.name} · week of {fmt(brief.from)} to {fmt(brief.date)}
        </p>
        <h1 className="mt-2 text-[36px] leading-tight tracking-[-0.01em]">{brief.title}</h1>
        <p className="mt-2 text-[14px] text-muted">Written by a Parallel Task run from this week&apos;s sourced events only. Every claim links to the event it came from; sources not in the input are dropped.</p>
        {brief.sections.map((s) => (
          <section key={s.heading} className="mt-8 border-t border-line pt-5">
            <h2 className="text-[20px]">{s.heading}</h2>
            <p className="mt-2 text-[16px] leading-relaxed">{s.body}</p>
            <p className="mt-3 flex flex-wrap gap-2">
              {s.sources.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 font-mono text-[11px] text-muted hover:border-ink hover:text-ink">
                  <Favicon host={hostOf(u)} name={hostOf(u) ?? '?'} size={12} /> {hostOf(u)}
                </a>
              ))}
            </p>
          </section>
        ))}
        <p className="mt-10 border-t border-line pt-5 text-[12px] text-muted">Research support from public sources. Not investment or medical advice.</p>
      </article>
      <aside>
        <h2 className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted">Issues</h2>
        <ul className="mt-2">
          {space.briefs.map((d) => (
            <li key={d}>
              <Link href={`/d/${disease}/brief?issue=${d}`} aria-current={d === issue ? 'page' : undefined} className={`block border-t border-line py-2 text-[14px] ${d === issue ? 'font-medium' : 'text-muted hover:text-ink'}`}>
                {fmt(d)}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
