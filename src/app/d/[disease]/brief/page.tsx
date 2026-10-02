import { notFound, redirect } from 'next/navigation';
import { loadSpace } from '@/lib/space/load';

// The brief opens over the map now; old links to /brief land there with the same issue open.
export default async function BriefPage({ params, searchParams }: PageProps<'/d/[disease]/brief'>) {
  const { disease } = await params;
  const space = await loadSpace(disease);
  if (!space?.briefs.length) notFound();
  const asked = (await searchParams).issue;
  redirect(`/d/${disease}?brief=${typeof asked === 'string' && space.briefs.includes(asked) ? asked : space.briefs[0]}`);
}
