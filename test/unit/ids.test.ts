import { describe, expect, it } from 'vitest';
import { fekId, formatLabel, parseFekId, pdfPath } from '../../src/fek/ids.js';

describe('fekId', () => {
  it('builds the id the blob paths use', () => {
    // Α 121/2026 — the fixture law, whose PDF really is at this path.
    expect(fekId({ year: 2026, issueGroup: 1, number: 121 })).toBe('20260100121');
    expect(fekId({ year: 2026, issueGroup: 2, number: 6047 })).toBe('20260206047');
    expect(fekId({ year: 1985, issueGroup: 1, number: 100 })).toBe('19850100100');
  });

  it('round-trips through parseFekId', () => {
    const ref = { year: 2026, issueGroup: 2, number: 6047 };
    expect(parseFekId(fekId(ref))).toEqual(ref);
  });

  it('rejects junk rather than inventing a document', () => {
    expect(parseFekId('')).toBeUndefined();
    expect(parseFekId('2026')).toBeUndefined();
    expect(parseFekId('202602060470')).toBeUndefined();
    expect(parseFekId('00000000000')).toBeUndefined();
  });
});

describe('pdfPath', () => {
  it('zero-pads the series and the number', () => {
    expect(pdfPath({ year: 2026, issueGroup: 1, number: 121 })).toBe('fek/01/2026/20260100121.pdf');
    expect(pdfPath({ year: 2026, issueGroup: 14, number: 7 })).toBe('fek/14/2026/20261400007.pdf');
  });
});

describe('formatLabel', () => {
  it('prints the label the gazette prints', () => {
    expect(formatLabel({ year: 2026, issueGroup: 2, number: 6047 })).toBe('Β 6047/2026');
  });

  it('uses the series name as of that year', () => {
    expect(formatLabel({ year: 2014, issueGroup: 11, number: 5 })).toBe('ΑΕ-ΕΠΕ 5/2014');
    expect(formatLabel({ year: 2016, issueGroup: 11, number: 5 })).toBe('ΠΡΑ.Δ.Ι.Τ. 5/2016');
  });
});
