import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { EtActions } from '../../src/et/actions.js';
import { EtClient } from '../../src/et/client.js';
import { athensToday, recentDates } from '../../src/et/dates.js';
import { httpFetch } from '../../src/et/http.js';
import { pdfUrl, resolveOrigins } from '../../src/et/origins.js';

/**
 * Invariants against the live service.
 *
 * Deliberately thin. This suite exists to notice that the undocumented API has
 * changed shape, not to re-test logic the unit suite already covers, and it
 * must never gate a build: an upstream outage is not a regression.
 *
 *   npm run test:live
 */
const live = process.env['FEK_LIVE'] === '1';
const config = loadConfig();
const origins = resolveOrigins(config);
const actions = new EtActions(new EtClient({ origins, httpFetch, timeoutMs: 30_000 }));

describe.skipIf(!live)('live smoke', () => {
  it('returns a well-formed listing for a recent weekday', async () => {
    // Walk back until a publishing day is found: weekends and holidays are
    // legitimately empty, and the search for one must not look like a failure.
    const dates = recentDates(athensToday(Date.now()), 10);
    for (const date of dates) {
      const rows = await actions.searchByDate(date);
      if (rows.length === 0) continue;
      const first = rows[0]!;
      expect(first.label).toMatch(/^[Α-Ω.\-ΕΠ]+ \d+\/\d{4}$/);
      expect(first.fekId).toMatch(/^\d{11}$/);
      expect(first.publicationDate).toBe(date);
      return;
    }
    throw new Error('no publishing day in the last 10 days — suspicious');
  });

  it('resolves Α 121/2026 by number and its PDF exists', async () => {
    const { hits } = await actions.simpleSearch({
      years: [2026],
      issueGroups: [1],
      documentNumber: '121',
    });
    expect(hits).toHaveLength(1);
    const hit = hits[0]!;
    expect(hit.fekId).toBe('20260100121');
    expect(hit.pages).toBe(112);

    const head = await httpFetch({ url: hit.pdfUrl, method: 'HEAD', timeoutMs: 30_000 });
    expect(head.status).toBe(200);
  });

  it('still indexes full text, with extracts and matched terms', async () => {
    const { hits, stemmedQuery } = await actions.simpleSearch({
      years: [2026],
      searchText: 'τηλεργασία',
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(stemmedQuery).toBeTruthy();
    const withExtract = hits.find((h) => h.extract !== null);
    expect(withExtract, 'no hit carried a decodable extract').toBeTruthy();
    expect(withExtract!.matchedTerms.length).toBeGreaterThan(0);
  });

  it('still serves topics for a document entity', async () => {
    const { hits } = await actions.simpleSearch({
      years: [2026],
      issueGroups: [1],
      documentNumber: '121',
    });
    const searchId = hits[0]!.searchId;
    expect(searchId, 'a search hit must carry the row id the metadata endpoint needs').toBeTruthy();
    const entity = await actions.documentEntityById(searchId!);
    expect(entity).toBeTruthy();
    expect(entity!.topics.length).toBeGreaterThan(0);
  });

  it('still returns act titles from the legislation index', async () => {
    // The only place in this API that carries a title, so find_law and
    // get_fek both depend on it.
    const hits = await actions.searchLegislation({ lawTypeId: 1, number: '5324', years: [2026] });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe('Α 121/2026');
    expect(hits[0]!.description).toContain('Σύσταση');
  });

  it('still collides law numbers across eras when no year is given', async () => {
    // The behaviour find_law warns about. If upstream ever starts preferring
    // the modern act, the warning becomes misleading and should be revisited.
    const hits = await actions.searchLegislation({ lawTypeId: 1, number: '5324' });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.map((h) => h.year)).toContain(1932);
    expect(hits.map((h) => h.year)).toContain(2026);
  });

  it('still resolves a publication code to an issue', async () => {
    const hits = await actions.searchKad({ code: '8290', year: 2003 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.label).toBe('Ν.Π.Δ.Δ. 16/2003');
    expect(hits[0]!.publicationCode).toBe('8290');
  });

  it('still resolves a company name to filings', async () => {
    const companies = await actions.companies('ΤΡΑΠΕΖΑ ΠΛΗΡΟΦΟΡΙΩΝ');
    expect(companies.length).toBeGreaterThan(0);
    const hits = await actions.searchCompany({ companyId: companies[0]!.id });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.issueGroup).toBe(11);
  });

  it('still returns ΑΣΕΠ announcements with titles', async () => {
    const hits = await actions.searchAsep({ year: 2026, documentNumber: '1' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.description).toBeTruthy();
  });

  it('reports which series published in a year', async () => {
    const ids = await actions.issueGroupIdsByYear(2026);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('serves a historic scanned issue at its deterministic URL', async () => {
    // 1985 predates born-digital publishing: the PDF exists but holds no text.
    // get_fek depends on the URL being derivable without a search.
    const url = pdfUrl(origins, { year: 1985, issueGroup: 1, number: 100 });
    const head = await httpFetch({ url, method: 'HEAD', timeoutMs: 30_000 });
    expect(head.status).toBe(200);
  });
});
