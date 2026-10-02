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
    scope: null,
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
        milestones: [{ type: 'data', date: '2026-09-10', drug: 'acmetide', nct: 'NCT1', headline: 'ALPHA-1 meets primary endpoint', source_url: 'https://ir.acme.com/alpha' }],
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

test('trial drawer: disclosures join on the run’s trial ID, never on headline text', () => {
  const s = space();
  s.facts.acme.milestones!.push(
    { type: 'data', date: '2026-09-11', drug: 'acmetide', nct: null, headline: 'Acmetide program update at EASL', source_url: 'https://ir.acme.com/easl' },
    { type: 'other', date: '2026-09-12', drug: 'placebex', nct: null, headline: 'ALPHA-1 sites expand in Europe', source_url: 'https://ir.acme.com/sites' },
  );
  const t = trialDetail(s, 'NCT1')!;
  assert.deepEqual(t.web.map((w) => w.headline), ['ALPHA-1 meets primary endpoint']);
  assert.deepEqual(t.programWeb.map((w) => w.headline), ['Acmetide program update at EASL']);
  // A headline that names the trial but was not tied to it by the run stays out.
  assert.ok(![...t.web, ...t.programWeb].some((w) => w.headline.startsWith('ALPHA-1 sites')));
});

test('trial drawer: sibling trials test the same lead drug', () => {
  const s = space();
  // A same-company trial of a different drug is not a sibling.
  s.trials.push(trial('NCT4', { interventions: [{ name: 'placebex', type: 'DRUG', other_names: [] }] }) as never);
  (s.companies[0] as { trials: string[] }).trials.push('NCT4');
  const t = trialDetail(s, 'NCT1')!;
  assert.deepEqual(t.siblings.map((o) => o.nct), ['NCT2']);
  assert.equal(t.siblings[0].label, 'NCT2');
  // Symmetry: NCT2's sibling is NCT1.
  assert.deepEqual(trialDetail(s, 'NCT2')!.siblings.map((o) => o.nct), ['NCT1']);
});

test('trial drawer: web research carries its distinct source count', () => {
  const t = trialDetail(space(), 'NCT1')!;
  assert.equal(t.webSources, 1);
});

test('trial drawer: the lead falls back to the experimental drug, never the placebo', () => {
  const s = space();
  s.trials.push(
    trial('NCT5', {
      interventions: [
        { name: 'Placebo', type: 'DRUG', other_names: [] },
        { name: 'XYZ-77 Injection', type: 'DRUG', other_names: [] },
      ],
      arms: [
        { type: 'PLACEBO_COMPARATOR', interventions: ['Placebo'] },
        { type: 'EXPERIMENTAL', interventions: ['XYZ-77 Injection'] },
      ],
    }) as never,
  );
  (s.companies[0] as { trials: string[] }).trials.push('NCT5');
  assert.equal(trialDetail(s, 'NCT5')!.lead, 'XYZ-77 Injection');
});

test('trial summary: design and control come from the registry arms', () => {
  const s = space();
  (s.trials[0] as any).design = { allocation: 'RANDOMIZED', masking: 'QUADRUPLE' };
  (s.trials[0] as any).arms = [{ type: 'PLACEBO_COMPARATOR', label: 'Placebo', interventions: ['Placebo', 'Liver biopsy'] }, { type: 'ACTIVE_COMPARATOR', label: '10 mg', interventions: ['acmetide'] }];
  (s.trials[0] as any).primary_outcomes = [{ measure: 'MASH resolution', time_frame: '52 weeks' }];
  const t = trialDetail(s, 'NCT1')!;
  assert.equal(t.summary.design, 'Randomized, double-blind, placebo-controlled Phase 3 trial');
  assert.equal(t.summary.endpoint, 'MASH resolution');
  assert.equal(t.summary.mechanism, 'THR-β agonist');
});

test('v1: readout and guided next step reach their own trial only', () => {
  const s = space();
  s.facts.acme.readouts = [{ nct: 'NCT1', has_data: true, date: '2026-09-10', analysis: 'Week 52 topline', endpoint: 'MASH resolution', arms: [{ arm: 'acmetide 10 mg', result: '41%' }, { arm: 'placebo', result: '12%' }], n: 900, p_value: '<0.001', source_url: 'https://ir.acme.com/alpha' }];
  s.facts.acme.next = [{ what: 'ALPHA-1 week 72 data', kind: 'readout', drug: 'acmetide', nct: 'NCT1', stated_on: '2026-09-10', earliest: '2027-03-01', latest: null, timing_text: '1H 2027', stated_by: 'Acme', source_url: 'https://ir.acme.com/next' }];
  const t = trialDetail(s, 'NCT1')!;
  assert.equal(t.readout?.arms[0].result, '41%');
  assert.equal(t.guided[0].window, '1H 2027');
  const other = trialDetail(s, 'NCT2')!;
  assert.equal(other.readout, null);
  assert.equal(other.guided.length, 0);
});

test('v1: deal values count USD millions only', async () => {
  const { dealValue } = await import('../src/lib/space/view');
  const base = { date: '2026-01-01', parties: [], type: 'license', upfront: null, total: null, headline: 'x', source_url: null };
  assert.equal(dealValue({ ...base, currency: 'USD', total_m: 4400, upfront_m: null }), 4.4e9);
  assert.equal(dealValue({ ...base, currency: 'EUR', total_m: 348, upfront_m: null }), 0);
  assert.equal(dealValue({ ...base, total: 'up to $1.0 billion' }), 1e9);
});

test('completed trials: hollow dots, not counted as active', () => {
  const s = space();
  (s.trials[0] as any).status = 'COMPLETED';
  const v = mapView(s, 'companies', '2026-10-01');
  const acme = v.rows.find((r) => r.key === 'acme')!;
  assert.equal(acme.dots.find((d) => d.nct === 'NCT1')!.done, true);
  assert.equal(v.stats.trials, 2);
  assert.equal(v.stats.completed, 1);
  assert.equal(v.stats.all, 3);
});
