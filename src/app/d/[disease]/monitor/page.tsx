import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MonitorScorecard } from '@/components/v5/MonitorScorecard';
import { builtDiseases, loadSpace } from '@/lib/space/load';
import { monitorScorecard } from '@/lib/space/monitor';

export const revalidate = 3600;

export async function generateStaticParams() {
  return (await builtDiseases()).map((d) => ({ disease: d.key }));
}

export async function generateMetadata({ params }: PageProps<'/d/[disease]/monitor'>): Promise<Metadata> {
  const space = await loadSpace((await params).disease);
  return space ? { title: `${space.config.name} news monitor · Trial Check` } : {};
}

export default async function MonitorPage({ params }: PageProps<'/d/[disease]/monitor'>) {
  const { disease } = await params;
  const space = await loadSpace(disease);
  if (!space) notFound();
  const view = await monitorScorecard(disease);
  if (!view) notFound();
  return <MonitorScorecard name={space.config.name} view={view} />;
}
