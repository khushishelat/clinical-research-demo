import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { DiseaseMap } from '@/components/v5/DiseaseMap';
import { builtDiseases, loadSpace } from '@/lib/space/load';
import { mapView } from '@/lib/space/view';

export const revalidate = 3600;

export async function generateStaticParams() {
  return (await builtDiseases()).map((d) => ({ disease: d.key }));
}

export async function generateMetadata({ params }: PageProps<'/d/[disease]'>): Promise<Metadata> {
  const space = await loadSpace((await params).disease);
  return space ? { title: `${space.config.name} · Trial Check`, description: `Every company racing in ${space.config.name}: ${space.trials.length} active drug trials and the clinicians who run them, from public sources.` } : {};
}

export default async function DiseasePage({ params }: PageProps<'/d/[disease]'>) {
  const space = await loadSpace((await params).disease);
  if (!space) notFound();
  const today = new Date().toISOString().slice(0, 10);
  // Both scopes in one payload: "All active" only adds the unassigned row.
  const view = mapView(space, 'all', today);
  return (
    <Suspense>
      <DiseaseMap view={view} today={today} />
    </Suspense>
  );
}
