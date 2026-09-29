// Builds data/sponsors.json, the static typeahead index: every industry lead
// sponsor with active trials on ClinicalTrials.gov, with its count at build
// time. Free, no key; about 30 paged requests.
//
//   npm run build-sponsors

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIVE_STATUSES } from '../src/lib/domain/stage1';

const BASE = 'https://clinicaltrials.gov/api/v2/studies';
const counts = new Map<string, number>();
let token: string | undefined;
let pages = 0;
do {
  const params = new URLSearchParams({
    'filter.overallStatus': ACTIVE_STATUSES,
    'filter.advanced': 'AREA[LeadSponsorClass]INDUSTRY AND AREA[StudyType]INTERVENTIONAL',
    fields: 'LeadSponsorName',
    pageSize: '1000',
  });
  if (token) params.set('pageToken', token);
  const res = await fetch(`${BASE}?${params}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ClinicalTrials.gov ${res.status}`);
  const body = (await res.json()) as { studies: any[]; nextPageToken?: string };
  for (const s of body.studies) {
    const name = s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  token = body.nextPageToken;
  pages += 1;
  await new Promise((r) => setTimeout(r, 300));
} while (token && pages < 100);

// Two or more active trials as lead sponsor keeps real developers and drops one-off entities.
const sponsors = [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([name, trials]) => ({ name, trials }));
const out = { built: new Date().toISOString().slice(0, 10), source: 'ClinicalTrials.gov API v2, active interventional trials, industry lead sponsors', sponsors };
writeFileSync(join(import.meta.dirname, '..', 'data', 'sponsors.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`${sponsors.length} sponsors from ${pages} pages`);
