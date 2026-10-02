import { redirect } from 'next/navigation';
import { builtDiseases, diseaseConfig } from '@/lib/space/load';

export const revalidate = 3600;

export default async function Home() {
  const built = await builtDiseases();
  const { default: preferred } = diseaseConfig();
  const pick = built.find((d) => d.key === preferred) ?? built[0];
  if (pick) redirect(`/d/${pick.key}`);
  // Nothing built yet: the repo ships no data, only the pipeline that makes it.
  return (
    <main className="mx-auto max-w-[680px] px-4 py-24">
      <p className="font-mono text-[12px] uppercase tracking-[0.08em] text-muted">Trial Check</p>
      <h1 className="mt-4 text-[36px] leading-tight">No disease maps built yet</h1>
      <p className="mt-4 text-[16px] text-muted">Each map is built by the pipeline in scripts/. Add your Parallel API key to .env.local, then build one disease:</p>
      <pre className="mt-6 overflow-x-auto rounded-[4px] bg-ink p-4 font-mono text-[13px] text-page">npm run pipeline -- --disease mash</pre>
      <p className="mt-4 text-[14px] text-muted">Diseases are listed in scripts/diseases.json. The README explains each step and what it costs.</p>
    </main>
  );
}
