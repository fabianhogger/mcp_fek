import { describe, expect, it } from 'vitest';
import { parseCitation, type Citation } from '../../src/fek/citation.js';
import { fekId } from '../../src/fek/ids.js';

function issue(input: string): Extract<Citation, { kind: 'issue' }> {
  const c = parseCitation(input);
  if (c.kind !== 'issue') throw new Error(`expected an issue for ${input}, got ${c.kind}`);
  return c;
}
function law(input: string): Extract<Citation, { kind: 'law' }> {
  const c = parseCitation(input);
  if (c.kind !== 'law') throw new Error(`expected a law for ${input}, got ${c.kind}`);
  return c;
}

describe('issue citations', () => {
  it('reads every spelling of the mark after the series letter', () => {
    // U+0027, U+0384 and U+2019 are used interchangeably in practice and none
    // of them is semantic.
    for (const cite of [
      "ΦΕΚ Β' 1234/2024",
      'ΦΕΚ Β΄ 1234/2024',
      'ΦΕΚ Β’ 1234/2024',
      'ΦΕΚ Β 1234/2024',
      'Β 1234/2024',
      "Β' 1234/2024",
    ]) {
      const c = issue(cite);
      expect(c.ref, cite).toEqual({ year: 2024, issueGroup: 2, number: 1234 });
      expect(c.confidence, cite).toBe('high');
    }
  });

  it('reads a citation typed on a Latin keyboard', () => {
    // Extremely common, and invisible to the user: Latin B and Greek Β are
    // indistinguishable on screen.
    expect(issue('B 1234/2024').ref.issueGroup).toBe(2);
    expect(issue('A 121/2026').ref.issueGroup).toBe(1);
    expect(issue("FEK B' 1234/2024").ref.issueGroup).toBe(2);
  });

  it('reads the ordinal word and the ΤΕΥΧΟΣ prefix', () => {
    expect(issue('ΦΕΚ ΔΕΥΤΕΡΟ 1234/2024').ref.issueGroup).toBe(2);
    expect(issue('ΦΕΚ ΤΕΥΧΟΣ ΠΡΩΤΟ 121/2026').ref.issueGroup).toBe(1);
  });

  it('reads the dotted and undotted special series', () => {
    expect(issue('Α.Σ.Ε.Π. 1/2026').ref.issueGroup).toBe(10);
    expect(issue('ΑΣΕΠ 1/2026').ref.issueGroup).toBe(10);
    expect(issue('Υ.Ο.Δ.Δ. 7/2026').ref.issueGroup).toBe(14);
    expect(issue('Α.Α.Π. 12/2026').ref.issueGroup).toBe(15);
  });

  it('reads an 11-digit document id', () => {
    const c = issue('20260100121');
    expect(c.ref).toEqual({ year: 2026, issueGroup: 1, number: 121 });
    expect(fekId(c.ref)).toBe('20260100121');
  });

  it('flags a two-digit year rather than silently assuming a century', () => {
    const c = issue('Β 1234/98');
    expect(c.ref.year).toBe(1998);
    expect(c.confidence).toBe('low');
    expect(c.note).toMatch(/1998/);
  });

  it('refuses a series/year pair that cannot exist, with the reason', () => {
    // Τεύχος Γ begins in 1984. Returning zero results would be indistinguishable
    // from "no such issue".
    const c = parseCitation('Γ 1/1950');
    expect(c.kind).toBe('unparsed');
    if (c.kind === 'unparsed') expect(c.reason).toMatch(/1984/);
  });

  it('refuses a year before the gazette itself', () => {
    expect(parseCitation('Α 1/1800').kind).toBe('unparsed');
  });

  it('names series 11 by the year of the citation', () => {
    expect(issue('ΑΕ-ΕΠΕ 5/2014').series.id).toBe(11);
    expect(issue('ΠΡΑ.Δ.Ι.Τ. 5/2016').series.id).toBe(11);
  });
});

describe('law citations', () => {
  it('reads the abbreviation, the full word and lower case', () => {
    for (const cite of ['Ν. 5324/2026', 'ΝΟΜΟΣ 5324/2026', 'νόμος 5324/2026', 'N. 5324/2026']) {
      const c = law(cite);
      expect(c.lawType.id, cite).toBe(1);
      expect(c.number, cite).toBe('5324');
      expect(c.year, cite).toBe(2026);
    }
  });

  it('reads the decree types', () => {
    expect(law('Π.Δ. 47/2026').lawType.id).toBe(2);
    expect(law('ΠΔ 47/2026').lawType.id).toBe(2);
    expect(law('Ν.Δ. 356/1974').lawType.id).toBe(301);
  });

  it('warns about the era collision when no year is given', () => {
    // Verified live: searching law 5324 with no year returns Α 63/1932.
    const c = law('Ν. 5324');
    expect(c.year).toBeUndefined();
    expect(c.confidence).toBe('low');
    expect(c.note).toMatch(/repeat across eras/);
  });
});

describe('unparsed', () => {
  it('lists the forms it understands instead of failing silently', () => {
    const c = parseCitation('the tax law from last year');
    expect(c.kind).toBe('unparsed');
    if (c.kind === 'unparsed') {
      expect(c.reason).toMatch(/Recognised forms/);
      expect(c.reason).toMatch(/20260100121/);
    }
  });

  it('handles empty and junk input', () => {
    expect(parseCitation('').kind).toBe('unparsed');
    expect(parseCitation('   ').kind).toBe('unparsed');
    expect(parseCitation('???').kind).toBe('unparsed');
  });
});
