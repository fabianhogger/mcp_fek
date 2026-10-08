import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../../src/config.js';
import { EtClient } from '../../../src/et/client.js';
import type { HttpFetch } from '../../../src/et/http.js';
import { resolveOrigins } from '../../../src/et/origins.js';
import { silentLogger } from '../../../src/logger.js';
import { PdfPipeline } from '../../../src/pdf/pipeline.js';
import { hasPdf, PDF_FIXTURES, pdfPath } from '../../helpers/pdf-fixtures.js';

/**
 * The download-and-parse pipeline itself.
 *
 * This is the layer the snapshot-backed tests in test/tools deliberately
 * substitute, so it is covered here instead — the caching that stops a second
 * question re-downloading nine megabytes, and the guards on what is accepted
 * as a PDF at all.
 *
 * Gated on the fixtures being present (`npm run fetch:pdfs`), because real
 * bytes are the entire point. The daily live-smoke job covers the same ground
 * against the real origin.
 */

const have = hasPdf(PDF_FIXTURES.law);

function pipeline(fetchImpl: HttpFetch, overrides: Partial<Config> = {}): PdfPipeline {
  const config: Config = { ...loadConfig(), pdfCacheMb: 0, ...overrides };
  return new PdfPipeline({
    client: new EtClient({
      origins: resolveOrigins(config),
      minSpacingMs: 0,
      sleep: async () => {},
    }),
    config,
    logger: silentLogger,
    fetchImpl,
  });
}

function servingLaw(calls: { n: number }): HttpFetch {
  const bytes = new Uint8Array(readFileSync(pdfPath(PDF_FIXTURES.law)));
  return async () => {
    calls.n++;
    return {
      status: 200,
      contentType: 'application/pdf',
      body: '',
      bytes,
      headers: new Headers(),
    };
  };
}

describe.skipIf(!have)('PdfPipeline', () => {
  it('downloads and parses a real issue', async () => {
    const calls = { n: 0 };
    const { parsed, cached } = await pipeline(servingLaw(calls)).parse(
      PDF_FIXTURES.law,
      'https://example.invalid/x.pdf',
      1,
    );
    expect(cached).toBe(false);
    expect(calls.n).toBe(1);
    expect(parsed.pageCount).toBe(112);
    expect(parsed.toc).toHaveLength(141);
  }, 120_000);

  it('downloads once however many times it is asked', async () => {
    // The expensive mistake this exists to prevent: nine megabytes and several
    // seconds of parsing, per article.
    const calls = { n: 0 };
    const p = pipeline(servingLaw(calls));
    await p.parse(PDF_FIXTURES.law, 'https://example.invalid/x.pdf', 1);
    const second = await p.parse(PDF_FIXTURES.law, 'https://example.invalid/x.pdf', 1);
    expect(calls.n).toBe(1);
    expect(second.cached).toBe(true);
  }, 120_000);

  it('single-flights concurrent requests for the same issue', async () => {
    const calls = { n: 0 };
    const p = pipeline(servingLaw(calls));
    const [a, b] = await Promise.all([
      p.parse(PDF_FIXTURES.law, 'https://example.invalid/x.pdf', 1),
      p.parse(PDF_FIXTURES.law, 'https://example.invalid/x.pdf', 1),
    ]);
    expect(calls.n).toBe(1);
    expect(a.parsed.toc).toHaveLength(141);
    expect(b.parsed.toc).toHaveLength(141);
  }, 120_000);
});

describe('PdfPipeline guards', () => {
  const refuse: HttpFetch = async () => ({
    status: 200,
    contentType: 'text/html',
    body: '',
    bytes: new Uint8Array(Buffer.from('<!doctype html><html>nope</html>')),
    headers: new Headers(),
  });

  it('refuses a body that is not a PDF', async () => {
    // Being served an error page instead of a document otherwise wastes
    // seconds in pdf.js before failing less clearly.
    await expect(
      pipeline(refuse).parse('20260100121', 'https://example.invalid/x.pdf', 1),
    ).rejects.toThrow(/expected a PDF/);
  });

  it('reports a missing PDF as a bad reference rather than a server fault', async () => {
    const missing: HttpFetch = async () => ({
      status: 404,
      contentType: 'application/xml',
      body: '',
      headers: new Headers(),
    });
    await expect(
      pipeline(missing).parse('20260100121', 'https://example.invalid/x.pdf', 1),
    ).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('refuses to work at all when extraction is disabled', async () => {
    await expect(
      pipeline(refuse, { pdfText: false }).parse('20260100121', 'https://example.invalid/x.pdf', 1),
    ).rejects.toThrow(/FEK_PDF_TEXT=0/);
  });
});
