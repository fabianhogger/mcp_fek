import { afterEach, describe, expect, it } from 'vitest';
import { callTool, makeTestServer, MORNING_NOW, type TestServer } from '../helpers/make-server.js';

let srv: TestServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

describe('latest_issues', () => {
  it('lists a weekday and names the issues', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-07', enrich: false });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('ok');
    expect(res.structured['total']).toBeGreaterThan(10);

    const issues = res.structured['issues'] as Array<Record<string, unknown>>;
    expect(issues[0]!['label']).toMatch(/^[Α-Ω.]+ \d+\/2026$/);
    expect(issues[0]!['fek_id']).toMatch(/^\d{11}$/);
    expect(issues[0]!['pdf_url']).toMatch(/\/fek\/\d{2}\/2026\/\d{11}\.pdf$/);
    expect(res.text).toContain('ΦΕΚ issues published on 2026-10-07');
  });

  it('reports a weekend as nothing published, not as a failure', async () => {
    // The gazette does not publish at weekends. A model must not read this as
    // an outage or an argument error.
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-04', enrich: false });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('empty');
    expect(res.structured['total']).toBe(0);
    expect(res.text).toMatch(/weekend/i);
  });

  it('warns that a same-day listing is still filling up', async () => {
    // One weekday this listing held 4 rows at 13:00 and 90 by evening, so a
    // count taken at lunchtime is wrong in a way that looks right.
    srv = await makeTestServer({ now: MORNING_NOW });
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-07', enrich: false });
    expect(res.structured['listing_may_be_incomplete']).toBe(true);
    expect(res.text).toMatch(/still filling up/);
    expect(res.text).toMatch(/Europe\/Athens/);
  });

  it('does not warn about incompleteness for a past date', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-04', enrich: false });
    expect(res.structured['listing_may_be_incomplete']).toBe(false);
  });

  it('rejects an unknown series locally, with a pointer to the vocabulary', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-07', series: ['Ω'] });
    expect(res.isError).toBe(true);
    expect(res.structured['status']).toBe('invalid_input');
    expect(res.text).toContain('fek_vocabulary');
    // No request should have been made for input we can reject ourselves.
    expect(srv.calls).toHaveLength(0);
  });

  it('filters by series using any accepted spelling', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', {
      date: '2026-10-07',
      series: ['ΔΕΥΤΕΡΟ'],
      enrich: false,
      limit: 100,
    });
    const issues = res.structured['issues'] as Array<Record<string, unknown>>;
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i['series_id']).toBe(2);
  });

  it('serves one date from cache rather than refetching it', async () => {
    srv = await makeTestServer();
    await callTool(srv, 'latest_issues', { date: '2026-10-07', enrich: false });
    const before = srv.calls.length;
    await callTool(srv, 'latest_issues', { date: '2026-10-07', enrich: false });
    expect(srv.calls.length).toBe(before);
  });

  it('carries the not-consolidated-law warning in both channels', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'latest_issues', { date: '2026-10-07', enrich: false });
    expect(res.text).toContain('never consolidated current law');
    expect(res.structured['law_currency_warning']).toContain('never consolidated current law');
  });
});

describe('fek_vocabulary', () => {
  it('lists the series with their year ranges, offline', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', { kind: 'series' });
    expect(res.isError).toBe(false);
    const series = res.structured['series'] as Array<Record<string, unknown>>;
    expect(series).toHaveLength(15);
    expect(series.find((s) => s['id'] === 3)!['from_year']).toBe(1984);
    expect(series.find((s) => s['id'] === 5)!['to_year']).toBe(2006);
    expect(srv.calls).toHaveLength(0);
  });

  it('narrows the series list to those that actually published, given a year', async () => {
    // The static table says which series exist; the API says which were used.
    // Τεύχος Δ exists since 1959 but publishes rarely, so the two differ.
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', { kind: 'series', year: 2026 });
    const listed = res.structured['series'] as Array<Record<string, unknown>>;
    expect(listed.length).toBeGreaterThan(0);
    expect(listed.length).toBeLessThan(15);
    expect(listed.map((s) => s['id'])).toContain(1);
    expect(listed.map((s) => s['id'])).toContain(2);
    expect(res.text).toContain('published in 2026');
  });

  it('computes the year list without calling the broken /years endpoint', async () => {
    // Upstream /years answers 400 in every form; the site builds its own
    // dropdown client-side, and so do we.
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', { kind: 'years', limit: 5 });
    expect(res.isError).toBe(false);
    expect(res.structured['years']).toEqual([2026, 2025, 2024, 2023, 2022]);
    expect(srv.calls).toHaveLength(0);
  });

  it('matches a subject category typed in Latin letters', async () => {
    // The whole point of porting the transliteration keys: a model relaying a
    // user's "health legislation" query has no Greek keyboard.
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', {
      kind: 'categories',
      query: 'ygeionomiki',
    });
    const cats = res.structured['categories'] as Array<Record<string, unknown>>;
    expect(cats.length).toBeGreaterThan(0);
    expect(String(cats[0]!['value'])).toContain('ΥΓΕΙΟΝΟΜΙΚΗ');
  });

  it('returns both candidates for a genuinely ambiguous category', async () => {
    // «φορολογία» is split into ΑΜΕΣΗ and ΕΜΜΕΣΗ. Picking one would be a
    // confidently wrong answer, so both come back.
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', { kind: 'categories', query: 'forologia' });
    const cats = res.structured['categories'] as Array<Record<string, unknown>>;
    const values = cats.map((c) => String(c['value']));
    expect(values).toEqual(expect.arrayContaining(['ΑΜΕΣΗ ΦΟΡΟΛΟΓΙΑ', 'ΕΜΜΕΣΗ ΦΟΡΟΛΟΓΙΑ']));
  });

  it('lists the law types with the ids searchlegislation wants', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_vocabulary', { kind: 'law_types' });
    const types = res.structured['law_types'] as Array<Record<string, unknown>>;
    expect(types.find((t) => t['id'] === 1)!['abbr']).toBe('Ν.');
    expect(types.find((t) => t['id'] === 301)!['abbr']).toBe('ΝΔ.');
  });
});

describe('search_fek', () => {
  it('finds issues by full text and reports the stem it searched', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'τηλεργασία', year: [2026] });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('ok');
    expect(res.structured['total']).toBeGreaterThan(10);
    // Searching «τηλεργασία» really searches the stem, which is why hits show
    // other inflections. A model that cannot see this cannot explain itself.
    expect(res.structured['stemmed_query']).toBe('τηλεργασ');
    expect(res.text).toContain('τηλεργασ');
  });

  it('does not count the stemmed-query marker as a result', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'τηλεργασία', year: [2026], limit: 100 });
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results.length).toBe(res.structured['total']);
    for (const r of results) {
      expect(r['label'], 'a blank row means the marker leaked through').toBeTruthy();
      expect(r['fek_id']).toMatch(/^\d{11}$/);
    }
  });

  it('decodes the matching text window and flags what it is', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'τηλεργασία', year: [2026] });
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    const withExtract = results.find((r) => typeof r['extract'] === 'string');
    expect(withExtract).toBeTruthy();
    expect((withExtract!['extract'] as string).length).toBeGreaterThan(200);
    expect(withExtract!['matched_terms']).toEqual(expect.arrayContaining([expect.stringMatching(/^τηλεργασ/)]));
    // It must never be mistaken for the published wording.
    expect(res.text).toMatch(/accent-stripped/);
  });

  it('never exposes the upstream score as relevance', async () => {
    // search_Score runs 1478, 1479, 1480, 1461 across one result set: it is an
    // ordinal, not a ranking, and presenting it would invite false precision.
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'τηλεργασία', year: [2026] });
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    for (const r of results) {
      expect(Object.keys(r)).not.toContain('score');
      expect(Object.keys(r)).not.toContain('search_Score');
    }
  });

  it('resolves an issue by series, year and number', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', {
      series: ['Α'],
      year: [2026],
      document_number: '121',
    });
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]!['fek_id']).toBe('20260100121');
    expect(results[0]!['pages']).toBe(112);
  });

  it('refuses a search with no criteria at all', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', {});
    expect(res.isError).toBe(true);
    expect(res.structured['status']).toBe('invalid_input');
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses a query shorter than the upstream minimum', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'ok' });
    expect(res.isError).toBe(true);
    expect(srv.calls).toHaveLength(0);
  });

  it('explains an empty result rather than leaving it bare', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', {
      query: 'ουδεμιαανευρεσιςλεξεως',
      series: ['Α'],
      year: [2026],
    });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('empty');
    expect(res.text).toMatch(/find_law|distinctive word/);
  });

  it('tells the caller a hit is an issue, not an act', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_fek', { query: 'τηλεργασία', year: [2026] });
    expect(res.text).toMatch(/whole gazette issue/);
    expect(res.text).toContain('get_fek');
  });
});

describe('resolve_citation', () => {
  it('resolves an issue reference, showing how it was read', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: "ΦΕΚ Β' 6047/2026" });
    expect(res.isError).toBe(false);
    expect(res.structured['fek_id']).toBe('20260206047');
    expect(res.structured['pdf_url']).toContain('/fek/02/2026/20260206047.pdf');
    const parsed = res.structured['parsed'] as Record<string, unknown>;
    expect(parsed['series']).toBe('Β');
    expect(parsed['number']).toBe(6047);
    expect(parsed['confidence']).toBe('high');
    expect(res.structured['pages']).toBe(4);
  });

  it('resolves a Latin-typed reference identically', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: "FEK B' 6047/2026" });
    expect(res.structured['fek_id']).toBe('20260206047');
  });

  it('resolves a law reference through the legislation index', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: 'Ν. 5324/2026' });
    expect(res.isError).toBe(false);
    const parsed = res.structured['parsed'] as Record<string, unknown>;
    expect(parsed['kind']).toBe('law');
    expect(parsed['law_type_id']).toBe(1);
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results[0]!['fek_id']).toBe('20260100121');
    // The legislation index is the only source of act titles anywhere here.
    expect(String(results[0]!['title'])).toContain('Σύσταση');
  });

  it('lists the forms it understands rather than failing opaquely', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: 'the tax law' });
    expect(res.isError).toBe(true);
    expect(res.structured['status']).toBe('unparsed');
    expect(res.text).toContain('20260100121');
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses an impossible series and year with the reason', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: 'Γ 1/1950' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('1984');
    expect(srv.calls).toHaveLength(0);
  });
});

describe('find_law', () => {
  it('finds the ΦΕΚ and the title for a law with its year', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'find_law', { number: '5324', year: 2026 });
    expect(res.isError).toBe(false);
    expect(res.structured['total']).toBe(1);
    expect(res.structured['ambiguous_across_eras']).toBe(false);
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results[0]!['label']).toBe('Α 121/2026');
    expect(results[0]!['fek_id']).toBe('20260100121');
  });

  it('surfaces the era collision when no year is given', async () => {
    // Verified live: law 5324 without a year returns Α 63/1932 as well as
    // Α 121/2026. Silently preferring the modern one would be right often
    // enough to be dangerous.
    srv = await makeTestServer();
    const res = await callTool(srv, 'find_law', { number: '5324' });
    expect(res.structured['total']).toBe(2);
    expect(res.structured['ambiguous_across_eras']).toBe(true);
    const years = (res.structured['results'] as Array<Record<string, unknown>>).map((r) => r['year']);
    expect(years).toEqual([2026, 1932]);
    expect(res.text).toMatch(/more than one era/);
    expect(res.text).toMatch(/do not assume the most recent/);
  });

  it('rejects a non-numeric act number and points at resolve_citation', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'find_law', { number: "ΦΕΚ Β' 1234/2024" });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('resolve_citation');
    expect(srv.calls).toHaveLength(0);
  });

  it('rejects an unknown act type', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'find_law', { number: '5324', law_type: 'ΧΥΖ' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('fek_vocabulary');
  });
});

describe('get_fek', () => {
  it('returns metadata, topics and a PDF link for a born-digital law', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { fek_id: '20260100121' });
    expect(res.isError).toBe(false);
    expect(res.structured['label']).toBe('Α 121/2026');
    expect(res.structured['pages']).toBe(112);
    expect(res.structured['pdf_url']).toContain('/fek/01/2026/20260100121.pdf');
    expect((res.structured['topics'] as unknown[]).length).toBeGreaterThan(0);
  });

  it('accepts a citation and series/number/year as well as an id', async () => {
    srv = await makeTestServer();
    const byCitation = await callTool(srv, 'get_fek', { citation: 'Α 121/2026' });
    const byParts = await callTool(srv, 'get_fek', { series: 'ΠΡΩΤΟ', number: 121, year: 2026 });
    expect(byCitation.structured['fek_id']).toBe('20260100121');
    expect(byParts.structured['fek_id']).toBe('20260100121');
  });

  it('serves a pre-digital scan as a success with a usable link', async () => {
    // The 1985 PDF downloads and renders fine but extracts to zero
    // characters, because it is an image. Returning an error would be wrong:
    // the metadata and the link are the whole answer, and no library or
    // setting changes that.
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { series: 'Α', number: 100, year: 1985 });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('ok');
    expect(res.structured['text_source']).toBe('none');
    expect(res.structured['pages']).toBe(8);
    expect(res.structured['pdf_url']).toContain('/fek/01/1985/19850100100.pdf');
    expect(res.text).toMatch(/scanned image/);
    expect(res.text).toMatch(/no text layer/);
  });

  it('extracts the table of contents and an article from a born-digital law', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { fek_id: '20260100121', articles: [1] });
    expect(res.isError).toBe(false);
    expect(res.structured['text_source']).toBe('pdf');
    expect(res.structured['law_name']).toBe('Ν. 5324/2026');
    expect(res.structured['law_type']).toBe('Ν.');
    expect(res.structured['law_number']).toBe('5324');
    expect(String(res.structured['law_title'])).toContain('Σύσταση νομικού προσώπου');
    expect((res.structured['contents'] as unknown[]).length).toBe(141);
    expect(res.structured['articles_included']).toEqual([1]);
    expect(String(res.structured['text'])).toContain('Άρθρο 1 Σκοπός');
    expect(String(res.structured['text'])).toContain('εκσυγχρονισμός');
  });

  it('keeps a 450,000-character law inside the requested budget', async () => {
    // The reason any of this exists: returning the whole issue is useless.
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { fek_id: '20260100121', max_chars: 2000 });
    expect(String(res.structured['text']).length).toBeLessThanOrEqual(2100);
    expect(res.structured['text_truncated']).toBe(true);
    expect(res.text).toMatch(/pass `articles`/);
  });

  it('splits a Τεύχος Β issue into its separate acts', async () => {
    // A hit from search_fek names an issue, not an act; this is the step that
    // says which act inside it is the relevant one.
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { fek_id: '20260205013', articles: [2] });
    expect(res.structured['text_source']).toBe('pdf');
    expect((res.structured['contents'] as unknown[]).length).toBe(3);
    expect(String(res.structured['text'])).toContain('λαθρεμπορίας');
    expect(res.text).toContain('Acts in this issue');
  });

  it('reports the unreadable parts of an issue rather than guessing at them', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { fek_id: '20260100126' });
    expect(res.structured['law_name']).toBe('Π.Υ.Σ. 22/2026');
    expect(String(res.structured['law_title'])).toBe(
      'Έγκριση της Εθνικής Στρατηγικής για τα Ύδατα.',
    );
  });

  it('returns metadata only when asked to skip the PDF', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', {
      fek_id: '20260100121',
      include_text: 'none',
    });
    expect(res.structured['text_source']).toBe('not_requested');
    expect(res.structured['text']).toBeNull();
    // No PDF should have been downloaded for a metadata-only call.
    expect(srv.calls.filter((u) => u.endsWith('.pdf'))).toHaveLength(0);
  });

  it('degrades to metadata when extraction is switched off', async () => {
    srv = await makeTestServer({ pdfText: false });
    const res = await callTool(srv, 'get_fek', { fek_id: '20260100121' });
    expect(res.isError).toBe(false);
    expect(res.structured['text_source']).toBe('none');
    expect(res.text).toMatch(/FEK_PDF_TEXT=0/);
  });

  it('downloads a PDF once even when asked twice', async () => {
    srv = await makeTestServer();
    await callTool(srv, 'get_fek', { fek_id: '20260100121', articles: [1] });
    const downloads = srv.calls.filter((u) => u.endsWith('.pdf')).length;
    await callTool(srv, 'get_fek', { fek_id: '20260100121', articles: [2] });
    expect(srv.calls.filter((u) => u.endsWith('.pdf')).length).toBe(downloads);
  });

  it('refuses a law reference, because an act number names no issue', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', { citation: 'Ν. 5324/2026' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('find_law');
  });

  it('asks for an identifier when given none', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'get_fek', {});
    expect(res.isError).toBe(true);
    expect(res.text).toContain('fek_id');
    expect(srv.calls).toHaveLength(0);
  });
});

describe('fek_subjects', () => {
  it('describes an issue without downloading it', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_subjects', { fek_id: '20260100121' });
    expect(res.isError).toBe(false);
    const topics = res.structured['topics'] as Array<Record<string, unknown>>;
    expect(topics.length).toBeGreaterThan(0);
    expect(topics[0]!['name']).toBeTruthy();
    expect(topics[0]!['id']).toBeTruthy();
  });

  it('folds the several metadata rows into one issue', async () => {
    // /documententitybyid returns metadata on the first row and one topic or
    // subject per row after it, so they have to be merged rather than listed.
    srv = await makeTestServer();
    const res = await callTool(srv, 'fek_subjects', { search_id: '806565' });
    expect(res.structured['label']).toBe('Β 6047/2026');
    expect(res.structured['pages']).toBe(4);
    expect((res.structured['topics'] as unknown[]).length).toBeGreaterThan(0);
  });
});

describe('search_asep', () => {
  it('finds an announcement by year and number, with its title', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_asep', { year: 2026, document_number: '1' });
    expect(res.isError).toBe(false);
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!['label']).toContain('Α.Σ.Ε.Π.');
    // One of only two endpoints anywhere in this API that returns a title.
    expect(String(results[0]!['title'])).toContain('ΠΡΟΚΗΡΥΞΗ');
  });

  it('requires a year, because announcements are numbered within one', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_asep', { document_number: '1' });
    expect(res.isError).toBe(true);
    expect(srv.calls).toHaveLength(0);
  });
});

describe('search_company', () => {
  it('lists the filings for a resolved company id', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_company', { company_id: '3135' });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('ok');
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results.length).toBeGreaterThan(0);
    // Company notices live in Τεύχος ΑΕ-ΕΠΕ / ΠΡΑ.Δ.Ι.Τ., which is series 11.
    expect(results[0]!['series_id']).toBe(11);
    expect(results[0]!['fek_id']).toMatch(/^\d{11}$/);
  });

  it('returns candidates instead of picking between similar companies', async () => {
    // Six genuinely different companies contain «ΤΡΑΠΕΖΑ ΠΛΗΡΟΦΟΡΙΩΝ» in their
    // registered names, including one that merely used to be called that.
    // Attributing one company's filings to another is exactly the kind of
    // confidently wrong answer worth refusing to give.
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_company', { name: 'ΤΡΑΠΕΖΑ ΠΛΗΡΟΦΟΡΙΩΝ' });
    expect(res.isError).toBe(false);
    expect(res.structured['status']).toBe('ambiguous');
    const candidates = res.structured['candidates'] as Array<Record<string, unknown>>;
    expect(candidates.length).toBeGreaterThan(1);
    expect(candidates.map((c) => c['company_id'])).toContain('3135');
    expect(res.text).toContain('company_id');
    // No filings search should have run while the company is still unresolved.
    expect(srv.calls.some((u) => u.includes('searchcompany'))).toBe(false);
  });

  it('refuses a registry number with no registry type', async () => {
    // Which of the three registries is ΑΡ.Μ.Α.Ε. / Γ.Ε.ΜΗ. / ΑΦΜ is not
    // documented, so the number alone cannot be padded correctly.
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_company', {
      company_id: '3135',
      registry_number: '12345',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('registry_type');
  });

  it('needs either a name or an id', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'search_company', {});
    expect(res.isError).toBe(true);
    expect(srv.calls).toHaveLength(0);
  });
});

describe('lookup_kad', () => {
  it('resolves a publication code to the issue it came out in', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'lookup_kad', { code: '8290', year: 2003 });
    expect(res.isError).toBe(false);
    const results = res.structured['results'] as Array<Record<string, unknown>>;
    expect(results).toHaveLength(1);
    expect(results[0]!['label']).toBe('Ν.Π.Δ.Δ. 16/2003');
    expect(results[0]!['fek_id']).toBe('20030500016');
    // The code is issued weeks before publication; both dates matter to the
    // person holding the receipt.
    expect(results[0]!['publication_code_date']).toBe('2003-01-21');
    expect(results[0]!['publication_date']).toBe('2003-01-28');
    expect(results[0]!['search_id']).toBe('269016');
  });

  it('heads off the business-activity-code confusion', async () => {
    // "ΚΑΔ" also abbreviates Κωδικός Αριθμός Δραστηριότητας, a tax
    // classification with nothing to do with the gazette.
    srv = await makeTestServer();
    const res = await callTool(srv, 'lookup_kad', { code: '62.01', year: 2024 });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Δραστηριότητας');
    expect(srv.calls).toHaveLength(0);
  });

  it('refuses a year before the code register existed', async () => {
    srv = await makeTestServer();
    const res = await callTool(srv, 'lookup_kad', { code: '8290', year: 1980 });
    expect(res.isError).toBe(true);
    expect(srv.calls).toHaveLength(0);
  });
});
