'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { BriefModal } from './BriefModal';

// Map and Table are views; the weekly brief opens over whichever is showing (?brief=<issue>).
export function Tabs({ disease, name, briefs }: { disease: string; name: string; briefs: string[] }) {
  const path = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const asked = params.get('brief');
  const issue = asked ? (briefs.includes(asked) ? asked : briefs[0]) : null;
  const setBrief = (d: string | null) => {
    const p = new URLSearchParams(params.toString());
    if (d) p.set('brief', d);
    else p.delete('brief');
    router.replace(p.size ? `?${p}` : path, { scroll: false });
  };
  const tabs = [
    { href: `/d/${disease}`, label: 'Map' },
    { href: `/d/${disease}/data`, label: 'Table' },
  ];
  return (
    <nav aria-label="Views" className="flex items-center gap-6 border-b border-line px-4 sm:px-8">
      {tabs.map((t) => {
        const on = t.href === `/d/${disease}` ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={`border-b-2 py-2.5 text-[14px] ${on ? 'border-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {t.label}
          </Link>
        );
      })}
      {briefs.length ? (
        <button type="button" onClick={() => setBrief(briefs[0])} aria-haspopup="dialog" className="ml-auto my-1.5 inline-flex items-center gap-2 rounded-[4px] border border-line-strong bg-card px-3 py-1.5 hover:border-orange">
          <span className="h-1.5 w-1.5 bg-orange" />
          <span className="font-mono text-[11px] uppercase tracking-[0.05em]">Weekly brief</span>
          <span className="hidden font-mono text-[11px] text-muted sm:inline">{new Date(`${briefs[0]}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}</span>
        </button>
      ) : null}
      {issue ? <BriefModal disease={disease} name={name} issues={briefs} issue={issue} onIssue={setBrief} onClose={() => setBrief(null)} /> : null}
    </nav>
  );
}
