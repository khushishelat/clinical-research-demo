import { builtDiseases } from '@/lib/space/load';

// When each indication's data was last refreshed. Open pages poll this and reload when the
// daily job has written something newer. Cached until that job revalidates it, so polling
// never reads storage; a day at most as a fallback.

export const dynamic = 'force-static';
export const revalidate = 86400;

export async function GET() {
  const built = await builtDiseases();
  return Response.json({ updated: Object.fromEntries(built.map((d) => [d.key, d.updated])) });
}
