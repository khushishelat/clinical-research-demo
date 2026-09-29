import { context, isKey, notFound } from '@/lib/server/http';
import { companyView } from '@/lib/server/pages';
import { namesOf } from '@/lib/view/names';

export const dynamic = 'force-dynamic';

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote everything; neutralize spreadsheet formulas.
  return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** The landscape as CSV: registry trials, then found-by-research trials. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const c = context();
  if (c instanceof Response) return c;
  if (!isKey(key)) return notFound();
  const view = await companyView(c, key);
  if (!view) return notFound();
  const { pack } = view;
  const names = namesOf(pack);
  const header = ['nct_id', 'name', 'source', 'run_by', 'lead_sponsor', 'phase', 'registry_status', 'registry_last_update', 'latest_milestone', 'milestone_date', 'milestone', 'source_url', 'next_catalyst', 'next_catalyst_timing', 'flag', 'hand_checked'];
  const lines = [header.map(cell).join(',')];
  for (const r of pack.rows) {
    const m = r.check?.latest_milestone;
    lines.push([r.nct_id, names[r.nct_id], 'registry search', r.role, r.lead_sponsor, r.phases.join('/'), r.status, r.last_update_posted, m?.type, m?.date, m?.description, m?.source_url, r.check?.next_catalyst?.description, r.check?.next_catalyst?.timing_text, r.check?.flag, r.check?.hand_checked?.some((h) => h.verdict === 'confirmed') ? 'yes' : ''].map(cell).join(','));
  }
  for (const f of pack.found_beyond_registry_search) {
    const m = f.check?.latest_milestone;
    lines.push([f.nct_id, names[f.nct_id], 'found by research', 'partner_led', f.registry?.lead_sponsor, f.registry?.phase, f.registry?.status, '', m?.type, m?.date, m?.description, m?.source_url, f.check?.next_catalyst?.description, f.check?.next_catalyst?.timing_text, f.check?.flag ?? 'not checked', ''].map(cell).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="trial-check-${key}-${pack.about.recorded}.csv"` },
  });
}
