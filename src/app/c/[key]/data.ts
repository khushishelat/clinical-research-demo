import 'server-only';
import { cache } from 'react';
import { ctx } from '@/lib/server/context';
import { companyView } from '@/lib/server/pages';
import { requestState } from '@/lib/server/research';

/** One load per request, shared by the layout and the page. */
export const getView = cache(async (key: string) => companyView(ctx(), key, { countView: true }));
export const getJob = cache(async (key: string) => requestState(ctx(), key).catch(() => null));
export const hasReplay = cache(async (key: string) => {
  const { access } = await import('node:fs/promises');
  const { join } = await import('node:path');
  return access(join(process.cwd(), 'fixtures/replay', `${key}.json`)).then(() => true, () => false);
});
