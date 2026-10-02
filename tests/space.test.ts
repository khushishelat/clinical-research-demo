import assert from 'node:assert/strict';
import { test } from 'node:test';
import { datasetCsv, datasetView } from '../src/lib/space/dataset';
import { clinicianDetail, trialDetail } from '../src/lib/space/detail';
import type { Space } from '../src/lib/space/load';
import { bdDeals, dollars, drugLabels, mapView, shortMechanism } from '../src/lib/space/view';

const trial = (nct: string, over: Record<string, unknown> = {}) => ({
  nct,
  title: `Trial ${nct}`,
  acronym: nct === 'NCT1' ? 'ALPHA-1' : '',
  status: 'RECRUITING',
  phases: ['PHASE3'],
  phase_level: 3,
  conditions: ['MASH'],
  sponsor: 'Acme Bio, Inc.',
  sponsor_class: 'INDUSTRY',
  run_by: 'company',
  collaborators: [],
  interventions: [{ name: 'acmetide', type: 'DRUG', other_names: ['ACM-101'] }],
  arms: [{ type: 'EXPERIMENTAL', interventions: ['acmetide'] }],
  first_posted: '2025-03-01',
  last_update: '2026-09-01',
  start: '2025-04',
  primary_completion: '2028-01',
  enrollment: 900,
  n_sites: 40,
  countries: ['United States'],
  people: [{ name: 'Jane Roe', key: 'jane roe|texas', role: 'principal_investigator', facility: 'Acme Investigational Site', city: 'Austin', state: 'Texas', country: 'United States' }],
  ...over,
});

const space = (): NonNullable<Space> =>
  ({
    config: { key: 'mash', name: 'MASH', query_cond: 'MASH', specialties: [] },
    fetched: '2026-10-01T12:00:00Z',
    trials: [trial('NCT1'), trial('NCT2', { run_by: 'investigator', sponsor: 'Univ', first_posted: '2026-09-20' }), trial('NCT3', { sponsor: 'Univ' })],
    companies: [
      { key: 'acme', name: 'Acme Bio', web_only: false, approved: false, max_phase: 3, acquisitions: [], drugs: [{ name: 'acmetide', codes: ['ACM-101'], mechanism: 'Thyroid hormone receptor beta (THRβ) agonist' }, { name: 'Acmetide (Acmezza)', codes: ['ACM-101'], mechanism: 'THR-β agonist' }], trials: ['NCT1'], investigator_trials: ['NCT2'], owner_source: 'https://ir.acme.com/x' },
      { key: 'webco', name: 'WebCo', web_only: true, approved: false, max_phase: 2, acquisitions: [], drugs: [], trials: [], investigator_trials: [] },
      { key: 'skip', name: 'Skip Me', web_only: true, approved: false, max_phase: 2, acquisitions: [], drugs: [], trials: [], investigator_trials: [] },
    ],
    unassigned: ['NCT3'],
    included: new Set(['WebCo']),
    facts: {
      acme: {
        milestones: [{ type: 'data', date: '2026-09-10', headline: 'ALPHA-1 meets primary endpoint', source_url: 'https://ir.acme.com/alpha' }],
        deals: [{ type: 'license', date: '2025-06-01', headline: 'Acme licenses acmetide', total: 'up to $1.5 billion', source_url: 'https://ir.acme.com/deal' }],
        approvals: [],
        next: [{ what: 'Phase 3 readout', earliest: '2027-03-01', timing_text: 'H1 2027', source_url: 'https://ir.acme.com/next' }],
        furthest_along: { drug: 'acmetide', phase: 'Phase III', where: 'global' },
        lead_assets: ['acmetide (ACM-101)'],
        how_given: { route: 'Oral tablet', frequency: 'Once daily' },
        _run: 'run_1',
        _connectors: { pubmed: 2 },
      },
      webco: { furthest_along: { phase: 'Phase 2b' } },
    },
    events: [{ id: 'e1', date: '2026-09-10', company: 'acme', origin: 'web', type: 'data', headline: 'ALPHA-1 meets primary endpoint', source_url: 'https://ir.acme.com/alpha', nct: 'NCT1' }],
    catalysts: [],
    monthly: { '2026-09': { all: 2, companies: 1 } },
    clinicians: [{ key: 'jane roe|texas', aliases: [], name: 'Jane Roe', us: true, country: 'United States', city: 'Austin', state: 'Texas', facilities: ['Acme Investigational Site', 'Texas Liver Institute'], roles: [{ nct: 'NCT1', role: 'principal_investigator', sponsor: 'Acme Bio, Inc.', company: 'Acme Bio', facility: 'Acme Investigational Site', city: 'Austin', state: 'Texas', country: 'United States' }], web_roles: [], npi: { number: '1234567890', taxonomy: 'Gastroenterology', city: 'AUSTIN', state: 'TX' }, npi_status: 'matched', pubmed: { count: 12, since_2024: 4, recent: [], verified: true }, profile: null }],
    coverage: [],
    firstSeen: { NCT1: { days_earlier: 28, first_announced: '2026-08-13', source_url: 'https://ir.acme.com/alpha' } },
    briefs: [],
  }) as unknown as NonNullable<Space>;

test('map: rows for registry companies and approved web finds, others left out', () => {
  const v = mapView(space(), 'all', '2026-10-01');
  assert.deepEqual(
    v.rows.map((r) => r.key),
    ['acme', 'webco', '_unassigned'],
  );
  const acme = v.rows[0];
  assert.equal(acme.lead, 'Acmezza (acmetide)');
  assert.deepEqual(acme.mechanisms, ['THR-β agonist']);
  assert.equal(acme.dots.length, 2);
  assert.equal(acme.next.length, 1);
  assert.equal(v.stats.onMap, 2);
  assert.equal(v.stats.dealDollars, 1.5e9);
  assert.equal(v.feed[0].webEarlier?.days, 28);
});

test('helpers: dollars, drug labels and mechanism tags', () => {
  assert.equal(dollars('$50 million upfront'), 5e7);
  assert.equal(dollars('up to $5.2 billion'), 5.2e9);
  assert.equal(dollars(null), 0);
  assert.equal(dollars('RMB 1.088 billion'), 0);
  assert.equal(dollars('up to €348 million'), 0);
  assert.deepEqual(drugLabels([{ name: 'resmetirom', codes: ['MGL-3196'] }, { name: 'Resmetirom (Rezdiffra)', codes: ['MGL-3196'] }]), ['Rezdiffra (resmetirom)']);
  assert.equal(shortMechanism('Dual glucagon and GLP-1 receptor agonist'), 'glucagon / GLP-1');
  assert.equal(shortMechanism('GalNAc-conjugated siRNA targeting PNPLA3 expression'), 'PNPLA3 siRNA');
  assert.equal(shortMechanism('Not publicly disclosed'), null);
});

test('trial drawer: web items, hidden sites, and named investigators', () => {
  const t = trialDetail(space(), 'NCT1')!;
  assert.equal(t.company?.name, 'Acme Bio');
  assert.equal(t.web[0].headline, 'ALPHA-1 meets primary endpoint');
  assert.equal(t.hiddenSites, 1);
  assert.equal(t.named[0].name, 'Jane Roe');
  assert.equal(t.named[0].profile, true);
  assert.equal(trialDetail(space(), 'NCT404'), null);
});

test('clinician drawer: US and NPI-verified only, never contacts', () => {
  const s = space();
  const c = clinicianDetail(s, 'jane roe|texas')!;
  assert.equal(c.place, 'Austin, TX');
  assert.equal(c.activeTrials, 1);
  assert.equal(JSON.stringify(c).match(/@|\(\d{3}\)/), null);
  (s.clinicians[0] as any).us = false;
  assert.equal(clinicianDetail(s, 'jane roe|texas'), null);
});

test('dataset: canonical stages, CSV escapes commas', () => {
  const v = datasetView(space());
  assert.equal(v.rows[0].cells.furthest_along.text, 'Phase 3');
  assert.equal(v.rows[1].cells.furthest_along.text, 'Phase 2');
  const csv = datasetCsv(v);
  assert.match(csv.split('\n')[0], /^company,trials_on_map,furthest_along/);
  assert.match(csv, /"Oral tablet"|Oral tablet/);
});

test('deals: licensing and M&A once each, on both parties’ rows', () => {
  const s = space();
  s.companies.push({ key: 'bigco', name: 'BigCo Pharma', web_only: false, approved: false, max_phase: 2, acquisitions: [], drugs: [], trials: ['NCT3'], investigator_trials: [] } as never);
  s.facts.bigco = { deals: [{ type: 'license', date: '2025-06-02', headline: 'BigCo licenses acmetide', total: null, upfront: '$100 million', parties: ['BigCo Pharma', 'Acme Bio'], source_url: 'https://bigco.com/x' }] };
  s.facts.acme.deals = [{ type: 'license', date: '2025-06-01', headline: 'Acme licenses acmetide', total: 'up to $1.5 billion', upfront: null, parties: ['Acme Bio', 'BigCo Pharma'], source_url: 'https://ir.acme.com/deal' }, { type: 'financing', date: '2025-07-01', headline: 'Acme raises $300 million', total: '$300 million', upfront: null, parties: ['Acme Bio'], source_url: null }];
  assert.equal(bdDeals(s).length, 1);
  const v = mapView(s, 'companies', '2026-10-01');
  assert.equal(v.stats.dealDollars, 1.5e9);
  assert.equal(v.rows.find((r) => r.key === 'bigco')!.news.filter((m) => m.type === 'deal').length, 1);
});

test('trial drawer: first-seen surfaces only when the web announced the trial earlier', () => {
  const s = space();
  const t = trialDetail(s, 'NCT1')!;
  assert.equal(t.firstSeen?.days, 28);
  assert.equal(t.firstSeen?.date, '2026-08-13');
  assert.equal(t.firstSeen?.source, 'https://ir.acme.com/alpha');
  // No step-08 record for NCT2: no badge, no invented dates.
  assert.equal(trialDetail(s, 'NCT2')!.firstSeen, null);
});

test('trial drawer: web items join by drug/acronym mention, nothing else', () => {
  const s = space();
  s.facts.acme.milestones!.push(
    { type: 'data', date: '2026-09-11', drug: 'acmetide', headline: 'ALPHA-1 subgroup analysis published', source_url: 'https://ir.acme.com/sub' },
    { type: 'other', date: '2026-09-12', drug: 'placebex', headline: 'Acme opens new Boston office', source_url: null },
  );
  const t = trialDetail(s, 'NCT1')!;
  const headlines = t.web.map((w) => w.headline);
  assert.ok(headlines.includes('ALPHA-1 meets primary endpoint'));
  assert.ok(headlines.includes('ALPHA-1 subgroup analysis published'));
  assert.ok(!headlines.includes('Acme opens new Boston office'));
});
