import { context, json } from '@/lib/server/http';
import { typeahead } from '@/lib/server/typeahead';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const c = context();
  if (c instanceof Response) return c;
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return json({ q, suggestions: await typeahead(c, q) });
}
