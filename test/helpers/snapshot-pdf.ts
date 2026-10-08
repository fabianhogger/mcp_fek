import { existsSync, readFileSync } from 'node:fs';
import type { PdfParser, PdfResult } from '../../src/pdf/pipeline.js';
import { parseText } from '../../src/pdf/structure.js';
import { textPath } from './pdf-fixtures.js';

/**
 * A PdfParser backed by the committed text snapshots.
 *
 * Downloading a nine-megabyte PDF and running pdf.js is the one part of this
 * server that cannot come from a recorded fixture, and the PDFs themselves are
 * gitignored because they are large and derivable. Without this, every test of
 * get_fek's text handling would skip on a fresh checkout — which is exactly
 * how the presentation logic came to be untested in CI while passing locally.
 *
 * So the extraction step is substituted and everything above it is exercised
 * for real: the structural parser runs on genuine extracted text, and the tool
 * renders genuine contents, articles and budgets. What is *not* covered here —
 * the download, the byte caps, pdf.js itself — belongs to
 * test/unit/pdf/extract.test.ts and test/unit/pdf/pipeline.test.ts, which skip
 * without the binaries and say so.
 */
export class SnapshotPdfParser implements PdfParser {
  readonly enabled: boolean;
  /** Every id this parser was asked for, to assert caching behaviour. */
  readonly parsed: string[] = [];
  private readonly cache = new Map<string, PdfResult>();

  constructor(opts: { enabled?: boolean } = {}) {
    this.enabled = opts.enabled ?? true;
  }

  async parse(fekId: string, _url: string, issueGroup: number): Promise<PdfResult> {
    const key = `${fekId}:${issueGroup}`;
    const hit = this.cache.get(key);
    if (hit) return { parsed: hit.parsed, cached: true };

    const path = textPath(fekId);
    if (!existsSync(path)) {
      // The same shape a genuinely missing PDF takes, so the degraded path
      // stays reachable from a test.
      throw new Error(`no snapshot for ${fekId}`);
    }

    this.parsed.push(fekId);
    const text = readFileSync(path, 'utf8');
    const result: PdfResult = {
      parsed: parseText(text, { pageCount: pageCountFor(fekId), issueGroup }),
      cached: false,
    };
    this.cache.set(key, result);
    return { parsed: result.parsed, cached: false };
  }
}

/**
 * Page counts, which the snapshots do not carry.
 *
 * Recorded from the real PDFs by `npm run extract:text`, so a tool asserting
 * on page counts is still checking a real number.
 */
function pageCountFor(fekId: string): number {
  const counts: Record<string, number> = {
    '20260100121': 112,
    '20260100126': 80,
    '20260100127': 2,
    '20260205013': 4,
    '19850100100': 8,
  };
  return counts[fekId] ?? 0;
}
