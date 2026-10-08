import { describe, expect, it } from 'vitest';
import { decodeMatchedText, parseHighlighted } from '../../src/et/snippets.js';
import { unwrap } from '../../src/et/envelope.js';
import { popStemmedQuery } from '../../src/et/envelope.js';
import { fixtureBody } from '../helpers/fixtures.js';
import { fixtureKey } from '../helpers/fixture-key.js';

const textSearch = fixtureKey('/simplesearch', [], {
  selectYear: ['2026'],
  selectIssue: [],
  documentNumber: '',
  searchText: 'τηλεργασία',
  datePublished: '',
  dateReleased: '',
});

describe('decodeMatchedText', () => {
  it('decodes a real extract to Greek body text', () => {
    const { rows } = popStemmedQuery(unwrap(fixtureBody(textSearch), '/simplesearch'));
    const extract = decodeMatchedText(rows[0]!['search_MatchedText']);
    expect(extract).toBeTruthy();
    expect(extract!.length).toBeGreaterThan(400);
    // The index stores text accent-stripped and lower-cased, which is exactly
    // why an extract must never be quoted as the published wording.
    expect(extract).toMatch(/[α-ω]/);
    expect(extract).not.toMatch(/[άέήίόύώ]/);
    // The window ends at the match.
    expect(extract).toContain('τηλεργασ');
  });

  it('returns null rather than throwing on junk', () => {
    expect(decodeMatchedText(undefined)).toBeNull();
    expect(decodeMatchedText('')).toBeNull();
    expect(decodeMatchedText(42)).toBeNull();
  });
});

describe('parseHighlighted', () => {
  it('reads the matched terms as plain JSON, not base64', () => {
    // The parallel naming is a trap: search_MatchedText is base64 and
    // search_HighlightedText is a JSON array. Decoding either one the other
    // way yields nothing.
    const { rows } = popStemmedQuery(unwrap(fixtureBody(textSearch), '/simplesearch'));
    const terms = parseHighlighted(rows[0]!['search_HighlightedText']);
    expect(terms.length).toBeGreaterThan(0);
    expect(terms[0]).toMatch(/^τηλεργασ/);
    // And it is definitely not base64 of anything.
    expect(decodeMatchedText(rows[0]!['search_HighlightedText'])).not.toEqual(terms.join(''));
  });

  it('handles an already-parsed array and a bare word', () => {
    expect(parseHighlighted(['α', 'β'])).toEqual(['α', 'β']);
    expect(parseHighlighted('τηλεργασια')).toEqual(['τηλεργασια']);
    expect(parseHighlighted('')).toEqual([]);
    expect(parseHighlighted(null)).toEqual([]);
  });
});
