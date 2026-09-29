import { Narrow } from '@/components/Narrow';
import { Disclaimer } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function NarrowPage({ params, searchParams }: PageProps<'/c/[key]/narrow'>) {
  const { key } = await params;
  const sp = await searchParams;
  const name = typeof sp.name === 'string' ? sp.name.slice(0, 120) : key.replace(/-/g, ' ');
  return (
    <main className="mx-auto max-w-[920px] py-10">
      <Narrow keyName={key} name={name} />
      <Disclaimer />
    </main>
  );
}
