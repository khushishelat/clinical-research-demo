'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function Tabs({ disease, brief }: { disease: string; brief: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: `/d/${disease}`, label: 'Map' },
    { href: `/d/${disease}/data`, label: 'Dataset' },
    ...(brief ? [{ href: `/d/${disease}/brief`, label: 'Weekly brief' }] : []),
  ];
  return (
    <nav aria-label="Views" className="flex gap-6 border-b border-line px-4 sm:px-8">
      {tabs.map((t) => {
        const on = t.href === `/d/${disease}` ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? 'page' : undefined} className={`border-b-2 py-2.5 text-[14px] ${on ? 'border-ink' : 'border-transparent text-muted hover:text-ink'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
