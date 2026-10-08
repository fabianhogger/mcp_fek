import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractText, linesFromTextContent } from '../../../src/pdf/extract.js';
import { hasPdf, PDF_FIXTURES, pdfPath, textPath } from '../../helpers/pdf-fixtures.js';

/**
 * The extraction layer, against the real PDFs.
 *
 * Gated on the fixtures being present, because they are gitignored and
 * derivable: `npm run fetch:pdfs`. The structural suite runs off the committed
 * text snapshots and never skips, so a missing download cannot hide a parser
 * regression — only an extraction one.
 */

const have = hasPdf(PDF_FIXTURES.law);

function read(id: string): Uint8Array {
  return new Uint8Array(readFileSync(pdfPath(id)));
}

describe.skipIf(!have)('extractText', () => {
  it('reproduces the committed snapshot exactly', async () => {
    // The real point of this test. pdf.js line reconstruction is what every
    // structural anchor depends on, and a version bump changing it would
    // otherwise show up as a baffling parser failure rather than a diff here.
    const result = await extractText(read(PDF_FIXTURES.law));
    expect(result.text).toBe(readFileSync(textPath(PDF_FIXTURES.law), 'utf8'));
  }, 120_000);

  it('reports the real page count and readable Greek', async () => {
    const result = await extractText(read(PDF_FIXTURES.law));
    expect(result.pageCount).toBe(112);
    expect(result.text.length).toBeGreaterThan(400_000);
    expect(result.text).toContain('ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ');
    expect(result.text).toContain('Άρθρο 1 Σκοπός');
  }, 120_000);

  it('preserves the line breaks the anchors depend on', async () => {
    const result = await extractText(read(PDF_FIXTURES.law), { maxPages: 2 });
    // A library that returns a page as one space-joined string destroys every
    // ^-anchored pattern in the parser before it ever runs.
    expect(result.text.split('\n').length).toBeGreaterThan(30);
    expect(result.text).toMatch(/^Άρθρο 1 Σκοπός$/m);
  }, 60_000);

  it('honours maxPages, so a huge issue can be sampled cheaply', async () => {
    const result = await extractText(read(PDF_FIXTURES.law), { maxPages: 1 });
    expect(result.pageCount).toBe(112);
    expect(result.text.length).toBeLessThan(5000);
  }, 60_000);

  it('finds no text at all in a pre-digital scan', async () => {
    // Not a failure: the 1985 PDF is an image. This is the fact the whole
    // text_source distinction exists to report.
    const result = await extractText(read(PDF_FIXTURES.scan));
    expect(result.text.trim()).toBe('');
    expect(result.emptyPages).toBe(result.pageCount);
  }, 60_000);
});

describe('linesFromTextContent', () => {
  const item = (str: string, y: number, hasEOL = false) => ({
    str,
    hasEOL,
    transform: [1, 0, 0, 1, 0, y],
    width: str.length,
  });

  it('breaks on an explicit end-of-line flag', () => {
    expect(linesFromTextContent([item('Άρθρο 1', 700, true), item('Σκοπός', 680)])).toBe(
      'Άρθρο 1\nΣκοπός',
    );
  });

  it('breaks when the baseline moves without a flag', () => {
    // The two-column case: item order can jump between columns with no EOL,
    // and without a break the columns run together into a line that matches
    // no anchor.
    expect(linesFromTextContent([item('first column', 700), item('second column', 640)])).toBe(
      'first column\nsecond column',
    );
  });

  it('keeps items on the same baseline together', () => {
    expect(linesFromTextContent([item('Άρθρο ', 700), item('1', 700)])).toBe('Άρθρο 1');
  });

  it('does not double-break', () => {
    expect(linesFromTextContent([item('a', 700, true), item('b', 640)])).toBe('a\nb');
  });
});
