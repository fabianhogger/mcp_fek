import { describe, expect, it } from 'vitest';
import { checkSeriesYear, resolveSeries, seriesName } from '../../src/fek/series.js';

describe('seriesName', () => {
  it('renames series 11 from 2015', () => {
    // The same id prints differently depending on the document's year, which
    // is the kind of thing that silently mislabels a decade of results.
    expect(seriesName(11, 2014)).toBe('ΑΕ-ΕΠΕ');
    expect(seriesName(11, 2016)).toBe('ΠΡΑ.Δ.Ι.Τ.');
    expect(seriesName(11, 2015)).toBe('ΠΡΑ.Δ.Ι.Τ.');
  });

  it('knows the main series', () => {
    expect(seriesName(1)).toBe('Α');
    expect(seriesName(2)).toBe('Β');
    expect(seriesName(10)).toBe('Α.Σ.Ε.Π.');
    expect(seriesName(14)).toBe('Υ.Ο.Δ.Δ.');
    expect(seriesName(15)).toBe('Α.Α.Π.');
  });
});

describe('resolveSeries', () => {
  const exact = (input: string | number): number => {
    const r = resolveSeries(input);
    if (r.decision !== 'exact') throw new Error(`expected exact for ${input}, got ${r.decision}`);
    return r.series.id;
  };

  it('accepts the printed letter, with or without a tonos or apostrophe', () => {
    expect(exact('Α')).toBe(1);
    expect(exact("Α'")).toBe(1);
    expect(exact('Α΄')).toBe(1);
    expect(exact('Ά')).toBe(1);
  });

  it('accepts Latin-typed Greek', () => {
    // A citation typed on a Latin keyboard is extremely common, and the folder
    // repairs the homoglyphs before matching.
    expect(exact('B')).toBe(2);
    expect(exact('A')).toBe(1);
  });

  it('accepts the ordinal word', () => {
    expect(exact('ΠΡΩΤΟ')).toBe(1);
    expect(exact('δεύτερο')).toBe(2);
    expect(exact('ΤΕΤΑΡΤΟ')).toBe(4);
  });

  it('accepts dotted and undotted abbreviations and transliterations', () => {
    expect(exact('Α.Σ.Ε.Π.')).toBe(10);
    expect(exact('ΑΣΕΠ')).toBe(10);
    expect(exact('asep')).toBe(10);
    expect(exact('Υ.Ο.Δ.Δ.')).toBe(14);
    expect(exact('yodd')).toBe(14);
  });

  it('accepts the numeric id', () => {
    expect(exact(2)).toBe(2);
    expect(exact('15')).toBe(15);
  });

  it('resolves both names of series 11', () => {
    expect(exact('ΠΡΑ.Δ.Ι.Τ.')).toBe(11);
    expect(exact('ΑΕ-ΕΠΕ')).toBe(11);
  });

  it('refuses to guess at an unknown series', () => {
    expect(resolveSeries('Ω').decision).toBe('none');
    expect(resolveSeries('').decision).toBe('none');
    expect(resolveSeries('ΠΕΜΠΤΟ').decision).toBe('none');
  });
});

describe('checkSeriesYear', () => {
  it('rejects a year before the series existed, with the reason', () => {
    const r = checkSeriesYear(3, 1950);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('1984');
  });

  it('rejects a year after the series closed', () => {
    const r = checkSeriesYear(5, 2020);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('2006');
  });

  it('rejects anything before the gazette itself', () => {
    expect(checkSeriesYear(1, 1800).ok).toBe(false);
  });

  it('accepts a valid pair', () => {
    expect(checkSeriesYear(1, 2026).ok).toBe(true);
    expect(checkSeriesYear(2, 1930).ok).toBe(true);
  });
});
