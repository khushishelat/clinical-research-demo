import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromRegistry, inferPlace, sameName, splitName } from '../scripts/lib/clinicians';
import { companyKey, displayName, isHoldingCompany, mergeRows } from '../scripts/lib/companies';
import { assertNoContacts, cleanPersonName, diffSnapshots, personBase, toTrial, type Trial } from '../scripts/lib/registry';
import { compactRunEvent, thinStats } from '../src/lib/replay-events';

const study = (over: Record<string, unknown> = {}) => ({
  protocolSection: {
    identificationModule: { nctId: 'NCT00000001', briefTitle: 'A trial', acronym: 'ONE' },
    statusModule: { overallStatus: 'RECRUITING', studyFirstPostDateStruct: { date: '2025-01-02' } },
    designModule: { phases: ['PHASE2', 'PHASE3'], enrollmentInfo: { count: 300 }, designInfo: { allocation: 'RANDOMIZED', maskingInfo: { masking: 'DOUBLE' } } },
    outcomesModule: { primaryOutcomes: [{ measure: 'MASH resolution at week 52', timeFrame: '52 weeks' }] },
    sponsorCollaboratorsModule: { leadSponsor: { name: 'Acme Bio, Inc.', class: 'INDUSTRY' } },
    armsInterventionsModule: { interventions: [{ name: 'acmetide', type: 'DRUG' }], armGroups: [{ type: 'EXPERIMENTAL', interventionNames: ['Drug: acmetide'] }] },
    contactsLocationsModule: {
      overallOfficials: [
        { name: 'Jane Roe, MD', role: 'PRINCIPAL_INVESTIGATOR', affiliation: 'Univ Hospital' },
        { name: 'Acme Call Center', role: 'STUDY_DIRECTOR' },
      ],
      locations: [
        { facility: 'Liver Institute', city: 'Austin', state: 'Texas', country: 'United States', contacts: [{ name: 'Jane Roe', role: 'PRINCIPAL_INVESTIGATOR' }, { name: 'Study Coordinator', role: 'CONTACT' }] },
        { facility: 'Acme Investigational Site', city: 'Lyon', country: 'France', contacts: [{ name: 'Clinical Trials Information Desk', role: 'PRINCIPAL_INVESTIGATOR' }] },
      ],
    },
    ...over,
  },
});

test('registry: phases, run-by, arms, and people without placeholders', () => {
  const t = toTrial(study());
  assert.equal(t.phase_level, 3);
  assert.equal(t.run_by, 'company');
  assert.deepEqual(t.arms, [{ type: 'EXPERIMENTAL', label: '', interventions: ['acmetide'] }]);
  assert.deepEqual(t.design, { allocation: 'RANDOMIZED', masking: 'DOUBLE' });
  assert.equal(t.primary_outcomes?.[0].measure, 'MASH resolution at week 52');
  assert.deepEqual(t.countries, ['United States', 'France']);
  // The official and the site PI are one person; call centers and contacts never appear.
  assert.equal(t.people.length, 1);
  assert.equal(t.people[0].key, 'jane roe|texas');
});

test('names: titles and credentials go, letters inside names stay', () => {
  assert.equal(cleanPersonName('Dr. Cameron Gofton'), 'Cameron Gofton');
  assert.equal(cleanPersonName('Jamal A Ibdah, MD PhD'), 'Jamal A Ibdah');
  assert.equal(cleanPersonName('Kenneth Cusi MD'), 'Kenneth Cusi');
  assert.equal(cleanPersonName('Jörn M. Beispiel'), 'Jörn M. Beispiel');
  assert.equal(personBase('Prof. John Olynyk'), 'john olynyk');
  assert.notEqual(personBase('Dr. A Smith'), personBase('Dr. B Jones'));
  assert.ok(sameName('Jörn Beispiel', 'Joern Beispiel'));
  assert.deepEqual(splitName('Ravi R. Example, MD'), { first: 'Ravi', last: 'Example' });
});

test('clinicians: an official without a site merges into their site record', () => {
  const a = toTrial(study());
  const b = toTrial(
    study({
      identificationModule: { nctId: 'NCT00000002', briefTitle: 'B' },
      contactsLocationsModule: { overallOfficials: [{ name: 'Jane Roe', role: 'PRINCIPAL_INVESTIGATOR', affiliation: 'Univ Hospital' }], locations: [{ facility: 'X', city: 'Paris', country: 'France' }] },
    }),
  );
  const people = fromRegistry([a, b], () => 'Acme');
  const jane = [...people.values()].filter((c) => c.name === 'Jane Roe');
  assert.equal(jane.length, 1);
  assert.equal(jane[0].us, true);
  assert.equal(new Set(jane[0].roles.map((r) => r.nct)).size, 2);
  assert.ok(jane[0].aliases.includes('jane roe|univ hospital'));
});

test('clinicians: country from the affiliation, else the trial', () => {
  assert.deepEqual(inferPlace('Example Health, 100 Example Street, Springfield VA 00000, USA', [['United States', 'Canada']]), { country: 'United States', state: 'Virginia' });
  assert.deepEqual(inferPlace('Beijing Hospital', [['China']]), { country: 'China', state: null });
  assert.deepEqual(inferPlace('Antwerp University Hospital, Belgium', [['Belgium', 'France']]), { country: 'Belgium', state: null });
  assert.deepEqual(inferPlace('Some Institute', [['France', 'Spain']]), { country: null, state: null });
});

test('privacy: contact details anywhere stop the write', () => {
  assert.throws(() => assertNoContacts('x', { a: 'reach me at jane@example.org' }), /contact details/);
  assert.throws(() => assertNoContacts('x', [{ note: 'call 512-555-0134' }]), /contact details/);
  assert.doesNotThrow(() => assertNoContacts('x', { nct: 'NCT05000000', enrollment: 1200, npi: '1134336662' }));
});

test('companies: one key per company across legal and place words', () => {
  assert.equal(companyKey('Madrigal Pharmaceuticals, Inc.'), companyKey('Madrigal Pharmaceuticals'));
  assert.notEqual(companyKey('Merck KGaA'), companyKey('Merck & Co., Inc.'));
  assert.ok(companyKey('Qilu Pharmaceutical Co., Ltd.').length > 0);
  assert.equal(displayName('Merck Sharp & Dohme LLC').includes('&'), true);
  assert.ok(isHoldingCompany('Novo Holdings A/S'));
  assert.ok(isHoldingCompany('Lundbeckfond Invest A/S'));
  assert.ok(!isHoldingCompany('Eli Lilly and Company'));
});

test('registry diff: new trials, status and phase changes', () => {
  const a = toTrial(study());
  const b: Trial = { ...a, status: 'ACTIVE_NOT_RECRUITING' };
  const c: Trial = { ...a, nct: 'NCT00000009' };
  const ev = diffSnapshots([a], [b, c], '2026-10-01');
  assert.deepEqual(
    ev.map((e) => e.type),
    ['status_changed', 'trial_registered'],
  );
});

test('replay events: compact, and still stats are thinned', () => {
  assert.deepEqual(compactRunEvent({ type: 'task_run.progress_msg.tool_call', message: 'Executing MCP tool call on server pubmed with tool search_articles.' }, 'r', 3), { k: 'tool', run: 'r', t: 3, connector: 'pubmed', tool: 'search_articles' });
  assert.equal(compactRunEvent({ type: 'task_run.progress_msg.plan' }, 'r', 1), null);
  const s = (t: number, considered: number) => ({ k: 'stats' as const, run: 'r', t, considered, read: 0 });
  assert.equal(thinStats([s(1, 0), s(2, 0), s(3, 4)]).length, 2);
  // The documented progress_stats fields: counts plus a sample of the pages read (URLs only).
  assert.deepEqual(
    compactRunEvent({ type: 'task_run.progress_stats', source_stats: { num_sources_considered: 223, num_sources_read: 22, sources_read_sample: ['http://example.org/a', 'not a url'] } }, 'r', 9),
    { k: 'stats', run: 'r', t: 9, considered: 223, read: 22, sample: ['http://example.org/a'] },
  );
});

test('privacy: street addresses leave affiliations, contacts leave excerpts', async () => {
  const { stripAddress, redactContacts } = await import('../scripts/lib/registry');
  assert.equal(stripAddress('Example Health, Gastroenterology, 100 Example Street, Springfield VA00000, USA'), 'Example Health, Gastroenterology, USA');
  assert.equal(stripAddress('Antwerp University Hospital, Wilrijkstraat 10, B-2650 Edegem, Belgium'), 'Antwerp University Hospital, Belgium');
  assert.equal(stripAddress('Washington University in St. Louis'), 'Washington University in St. Louis');
  assert.equal(redactContacts('Contact clinicaltrials@acme.com or 555-010-0199.'), 'Contact [email removed] or [phone removed].');
  assert.equal(redactContacts('Acme, 530 Industrial Park Boulevard, Montgomery'), 'Acme, [address removed], Montgomery');
  assert.throws(() => assertNoContacts('x', { a: 'Example Health, 100 Example Street' }), /contact details/);
});

test('companies: rows a same-company run groups merge into one, keeping the usual name’s key', () => {
  const row = (key: string, name: string, sponsors: string[], trials: string[], over: Record<string, unknown> = {}) => ({ key, name, relationship: 'independent', owner_source: null, acquisitions: [], registry_sponsors: sponsors, drugs: [], trials, investigator_trials: [], web: null, web_only: false, approved: false, max_phase: 3, ...over }) as never;
  const rows = new Map<string, any>([
    ['roche', row('roche', 'Roche', ['89bio, Inc.'], ['NCT1'])],
    ['hoffmann la', row('hoffmann la', 'Hoffmann-La Roche', ['Hoffmann-La Roche'], ['NCT2', 'NCT3'])],
    ['merck', row('merck', 'Merck', [], [], { web_only: true })],
  ]);
  const merges = mergeRows(rows, [
    { names: ['Hoffmann-La Roche', 'Roche', '89bio, Inc.'], company: 'Roche' },
    { names: ['Merck'], company: 'Merck' },
  ]);
  assert.deepEqual(merges, [{ into: 'roche', from: ['hoffmann la'] }]);
  assert.deepEqual([...rows.keys()].sort(), ['merck', 'roche']);
  assert.deepEqual(rows.get('roche').trials, ['NCT1', 'NCT2', 'NCT3']);
  assert.deepEqual(rows.get('roche').registry_sponsors, ['89bio, Inc.', 'Hoffmann-La Roche']);
});

test('removal: a removed person is matched by hash under any of their keys', async () => {
  const { isRemoved, removalHash } = await import('../scripts/lib/removed');
  const hashes = new Set([removalHash('jane roe|texas')]);
  assert.ok(isRemoved(hashes, ['jane roe|univ hospital', 'Jane Roe|Texas']));
  assert.ok(!isRemoved(hashes, ['john doe|texas']));
  assert.ok(!removalHash('jane roe|texas').includes('jane'));
});

test('v1 units: invented trial IDs are dropped; readouts go to trials that could have them', async () => {
  const { cleanFacts, readoutTrials } = await import('../scripts/lib/units');
  const c = { key: 'acme', name: 'Acme', trials: ['NCT1', 'NCT2', 'NCT3'], investigator_trials: ['NCT4'], drugs: [] } as never;
  const f = cleanFacts(c, { milestones: [{ date: '2026-01-01', type: 'data', drug: 'x', nct: 'NCT9', headline: 'h', source_url: null }, { date: '2026-01-02', type: 'data', drug: 'x', nct: 'NCT2', headline: 'h', source_url: null }] });
  assert.deepEqual(f.milestones!.map((m) => m.nct), [null, 'NCT2']);
  const t = (nct: string, over: Record<string, unknown>) => ({ ...toTrial(study()), nct, ...over }) as Trial;
  const byNct = new Map([
    ['NCT1', t('NCT1', { phase_level: 3, status: 'RECRUITING', primary_completion: '2028-01' })],
    ['NCT2', t('NCT2', { phase_level: 2, status: 'RECRUITING', primary_completion: '2027-01' })],
    ['NCT3', t('NCT3', { phase_level: 1, status: 'ACTIVE_NOT_RECRUITING', primary_completion: '2025-01' })],
    ['NCT4', t('NCT4', { phase_level: 3, status: 'ACTIVE_NOT_RECRUITING', primary_completion: '2025-01' })],
  ]);
  // NCT2 has a data milestone; NCT1 has nothing yet; NCT3 is Phase 1; NCT4 is investigator-sponsored.
  assert.deepEqual(readoutTrials(c, byNct, f, '2026-10-02').map((x) => x.nct), ['NCT2']);
});

test('companies: older phase text maps onto the phase enum', async () => {
  const { phaseFromText } = await import('../scripts/lib/companies');
  assert.equal(phaseFromText('Phase 2b'), 'phase_2');
  assert.equal(phaseFromText('Phase 2b/3'), 'phase_2_3');
  assert.equal(phaseFromText('Approved for NASH/MASH in India; Phase 2b elsewhere'), 'approved');
  assert.equal(phaseFromText('Phase 1/2'), 'phase_1_2');
  assert.equal(phaseFromText('Phase 1 (healthy volunteers)'), 'phase_1');
  assert.equal(phaseFromText(''), 'preclinical');
});
