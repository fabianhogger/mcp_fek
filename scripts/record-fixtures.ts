/**
 * Re-record the API fixtures from the live service.
 *
 * Fixtures come from the real backend, never from hand-written JSON: the whole
 * point is to pin down an undocumented API's actual behaviour, and a
 * hand-built fixture only pins down what we assumed. The outer envelope is
 * stored untouched, double-encoded `data` string and all, so the decoding path
 * is exercised rather than bypassed.
 *
 *   npm run record
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { EP } from '../src/et/endpoints.js';
import { httpFetch } from '../src/et/http.js';
import { apiUrl, resolveOrigins } from '../src/et/origins.js';
import { fixtureKey, FIXTURE_DIR, type Manifest } from '../test/helpers/fixture-key.js';

interface Target {
  name: string;
  endpoint: string;
  method: 'GET' | 'POST';
  body?: unknown;
  path?: ReadonlyArray<string | number>;
  why: string;
}

const TARGETS: readonly Target[] = [
  {
    name: 'searchbydate-weekday',
    endpoint: EP.searchByDate,
    method: 'POST',
    body: { datePublished: '2026-10-07' },
    why: 'A busy Wednesday: dozens of Τεύχος Β issues, the normal case.',
  },
  {
    name: 'searchbydate-weekend',
    endpoint: EP.searchByDate,
    method: 'POST',
    body: { datePublished: '2026-10-04' },
    why: 'A Sunday. The gazette does not publish, so this must stay an empty success.',
  },
  {
    name: 'simplesearch-by-number',
    endpoint: EP.simpleSearch,
    method: 'POST',
    body: {
      selectYear: ['2026'],
      selectIssue: ['1'],
      documentNumber: '121',
      searchText: '',
      datePublished: '',
      dateReleased: '',
    },
    why: 'Resolving Α 121/2026. No text, so no snippets and Score is 0.',
  },
  {
    name: 'simplesearch-text',
    endpoint: EP.simpleSearch,
    method: 'POST',
    body: {
      selectYear: ['2026'],
      selectIssue: [],
      documentNumber: '',
      searchText: 'τηλεργασία',
      datePublished: '',
      dateReleased: '',
    },
    why: 'Full-text search: base64 extracts, matched terms, and the trailing stemmedQuery row.',
  },
  {
    name: 'simplesearch-empty',
    endpoint: EP.simpleSearch,
    method: 'POST',
    body: {
      selectYear: ['2026'],
      selectIssue: ['1'],
      documentNumber: '',
      searchText: 'ουδεμιαανευρεσιςλεξεως',
      datePublished: '',
      dateReleased: '',
    },
    why: 'A query that matches nothing, to pin the no-results shape.',
  },
  {
    name: 'documententitybyid',
    endpoint: EP.documentEntityById,
    method: 'GET',
    path: ['806565'],
    why: 'Topics and subjects spread over several rows that must be folded into one entity.',
  },
  {
    name: 'issuegroupidsbyyear-2026',
    endpoint: EP.issueGroupIdsByYear,
    method: 'GET',
    path: [2026],
    why: 'Which series actually published in a year.',
  },
  {
    name: 'searchlegislation-5324-2026',
    endpoint: EP.searchLegislation,
    method: 'POST',
    body: { legislationCatalogues: '1', legislationNumber: '5324', selectYear: ['2026'] },
    why: 'Law 5324 narrowed to 2026: the unambiguous case, and it carries a title.',
  },
  {
    name: 'searchlegislation-5324-anyyear',
    endpoint: EP.searchLegislation,
    method: 'POST',
    body: { legislationCatalogues: '1', legislationNumber: '5324', selectYear: [] },
    why: 'The era collision: with no year this returns Α 63/1932, not the 2026 law.',
  },
  {
    name: 'searchasep-1-2026',
    endpoint: EP.searchAsep,
    method: 'POST',
    body: { selectYear: '2026', documentNumber: '1' },
    why: 'Scalar payload, unlike every sibling endpoint. Carries a title.',
  },
  {
    name: 'documententitybyid-law',
    endpoint: EP.documentEntityById,
    method: 'GET',
    path: ['803159'],
    why: 'The Α 121/2026 law entity, used by get_fek and fek_subjects.',
  },
  {
    name: 'simplesearch-b6047',
    endpoint: EP.simpleSearch,
    method: 'POST',
    body: {
      selectYear: ['2026'],
      selectIssue: ['2'],
      documentNumber: '6047',
      searchText: '',
      datePublished: '',
      dateReleased: '',
    },
    why: 'Resolving Β 6047/2026 from a citation.',
  },
  {
    name: 'simplesearch-1985-a100',
    endpoint: EP.simpleSearch,
    method: 'POST',
    body: {
      selectYear: ['1985'],
      selectIssue: ['1'],
      documentNumber: '100',
      searchText: '',
      datePublished: '',
      dateReleased: '',
    },
    why: 'A pre-digital issue: it exists, but its PDF is an image-only scan.',
  },
  {
    name: 'companies-trapeza',
    endpoint: EP.companies,
    method: 'POST',
    body: { partialName: 'ΤΡΑΠΕΖΑ ΠΛΗΡΟΦΟΡΙΩΝ' },
    why: 'Company name lookup. Takes partialName, not the companies_Name its rows use.',
  },
  {
    name: 'companies-ambiguous',
    endpoint: EP.companies,
    method: 'POST',
    body: { partialName: 'ΤΡΑΠΕΖΑ' },
    why: 'Many companies share this word; the tool must return candidates, not guess.',
  },
  {
    name: 'searchcompany-3135',
    endpoint: EP.searchCompany,
    method: 'POST',
    body: { company: '3135', companyId: '', companyIdNumber: '', companyName: '' },
    why: 'Company filings keyed on the internal id. A name in `company` silently returns nothing.',
  },
  {
    name: 'searchkad-8290-2003',
    endpoint: EP.searchKad,
    method: 'POST',
    body: { protocolNumber: '8290', selectYear: '2003' },
    why: 'ΚΑΔ lookup. Row shape differs from every other search: DocumentEntityID, explicit Year.',
  },
  {
    name: 'documententitybyid-1985',
    endpoint: EP.documentEntityById,
    method: 'GET',
    path: ['707398'],
    why: 'The 1985 Α 100 entity: a pre-digital scan, so get_fek must degrade to a link.',
  },
  {
    name: 'categories',
    endpoint: EP.categories,
    method: 'GET',
    why: 'Subject categories: ids plus their Greek labels.',
  },
];

async function main(): Promise<void> {
  const origins = resolveOrigins(loadConfig());
  await mkdir(FIXTURE_DIR, { recursive: true });
  const manifest: Manifest = {};

  for (const t of TARGETS) {
    const url = apiUrl(origins, t.endpoint, ...(t.path ?? []));
    process.stderr.write(`${t.method} ${url}\n`);
    const res = await httpFetch({
      url,
      method: t.method,
      ...(t.body !== undefined ? { body: t.body } : {}),
      timeoutMs: 60_000,
    });
    if (res.status !== 200) {
      process.stderr.write(`  ! HTTP ${res.status}, skipping\n`);
      continue;
    }
    const file = `${t.name}.json`;
    await writeFile(join(FIXTURE_DIR, file), res.body, 'utf8');
    manifest[fixtureKey(t.endpoint, t.path ?? [], t.body)] = { file, why: t.why };
    process.stderr.write(`  -> ${file} (${res.body.length} bytes)\n`);
    // Be polite to a service that owes us nothing.
    await new Promise((r) => setTimeout(r, 400));
  }

  await writeFile(
    join(FIXTURE_DIR, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  process.stderr.write(`\nwrote ${Object.keys(manifest).length} fixtures\n`);
}

await main();
