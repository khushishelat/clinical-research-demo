import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Dataset } from '@/components/v5/Dataset';
import { datasetView } from '@/lib/space/dataset';
import { builtDiseases, loadSpace } from '@/lib/space/load';

export const revalidate = 3600;

export async function generateStaticParams() {
  return (await builtDiseases()).map((d) => ({ disease: d.key }));
}

export async function generateMetadata({ params }: PageProps<'/d/[disease]/data'>): Promise<Metadata> {
  const space = await loadSpace((await params).disease);
  return space ? { title: `${space.config.name} dataset · Trial Check` } : {};
}

export default async function DataPage({ params }: PageProps<'/d/[disease]/data'>) {
  const space = await loadSpace((await params).disease);
  if (!space) notFound();
  return <Dataset view={datasetView(space)} />;
}
