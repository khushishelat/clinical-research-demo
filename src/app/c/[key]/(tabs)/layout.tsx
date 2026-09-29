import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CompanyBar } from '@/components/CompanyBar';
import { nextRefreshDate } from '@/lib/server/refresh';
import { getJob, getView, hasReplay } from '../data';

export default async function CompanyLayout({ children, params }: LayoutProps<'/c/[key]'>) {
  const { key } = await params;
  const view = await getView(key);
  const job = view ? null : await getJob(key);
  if (!view && !job) notFound();
  const name = view?.pack.about.company ?? job!.company.name;
  return (
    <main>
      <Suspense>
        <CompanyBar
          keyName={key}
          name={name}
          recorded={view?.pack.about.recorded ?? null}
          nextRefresh={view?.refresh.next ?? nextRefreshDate(new Date())}
          refreshIncluded={view?.refresh.included ?? false}
          scopeLabel={view?.config?.scope_label}
          replay={Boolean(view && (await hasReplay(key)))}
          reading={!view}
        />
      </Suspense>
      {children}
    </main>
  );
}
