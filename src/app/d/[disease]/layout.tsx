import { notFound } from 'next/navigation';
import { Header } from '@/components/v5/Header';
import { Tabs } from '@/components/v5/Tabs';
import { builtDiseases, loadSpace } from '@/lib/space/load';

export default async function DiseaseLayout({ children, params }: LayoutProps<'/d/[disease]'>) {
  const { disease } = await params;
  const space = await loadSpace(disease);
  if (!space) notFound();
  return (
    <>
      <Header current={disease} diseases={await builtDiseases()} updated={space.fetched} />
      <Tabs disease={disease} brief={space.briefs.length > 0} />
      {children}
    </>
  );
}
