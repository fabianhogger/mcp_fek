import { describe, expect, it } from 'vitest';
import { popStemmedQuery, unprefix, unwrap } from '../../src/et/envelope.js';
import { EtError } from '../../src/et/errors.js';
import { fixtureBody } from '../helpers/fixtures.js';
import { fixtureKey } from '../helpers/fixture-key.js';

const weekday = fixtureKey('/searchbydate', [], { datePublished: '2026-10-07' });
const weekend = fixtureKey('/searchbydate', [], { datePublished: '2026-10-04' });

describe('unwrap', () => {
  it('decodes the data field a second time', () => {
    // The whole point: `data` is a JSON-encoded string inside already-parsed
    // JSON. Miss the second parse and every field reads as undefined with no
    // error raised anywhere.
    const rows = unwrap(fixtureBody(weekday), '/searchbydate');
    expect(rows.length).toBeGreaterThan(10);
    expect(rows[0]).toHaveProperty('search_PrimaryLabel');
    expect(typeof rows[0]!['search_PrimaryLabel']).toBe('string');
  });

  it('treats a weekend as an empty success, not a failure', () => {
    expect(unwrap(fixtureBody(weekend), '/searchbydate')).toEqual([]);
  });

  it('accepts an empty or null data field', () => {
    const base = { status: 'ok', message: 'ok' };
    expect(unwrap(JSON.stringify({ ...base, data: '' }), 'x')).toEqual([]);
    expect(unwrap(JSON.stringify({ ...base, data: null }), 'x')).toEqual([]);
  });

  it('rejects a non-ok envelope status', () => {
    const body = JSON.stringify({ status: 'error', message: 'nope', data: '' });
    expect(() => unwrap(body, 'x')).toThrow(EtError);
    try {
      unwrap(body, 'x');
    } catch (e) {
      expect((e as EtError).kind).toBe('invalid_shape');
    }
  });

  it('turns a non-JSON body into invalid_shape rather than a crash', () => {
    expect(() => unwrap('<!doctype html><html>', 'x')).toThrow(/invalid_shape/);
  });

  it('turns an undecodable data string into invalid_shape', () => {
    const body = JSON.stringify({ status: 'ok', data: '[{not json' });
    expect(() => unwrap(body, 'x')).toThrow(/invalid_shape/);
  });
});

describe('unprefix', () => {
  it('strips the endpoint prefix and leaves other keys alone', () => {
    expect(unprefix({ search_Pages: '4', other: 1 }, 'search_')).toEqual({ Pages: '4', other: 1 });
  });
});

describe('popStemmedQuery', () => {
  it('separates the trailing stemmed-query marker from the results', () => {
    // Counting that row as a hit inflates every total by one and renders a
    // blank line where a result should be.
    const rows = unwrap(
      fixtureBody(
        fixtureKey('/simplesearch', [], {
          selectYear: ['2026'],
          selectIssue: [],
          documentNumber: '',
          searchText: 'τηλεργασία',
          datePublished: '',
          dateReleased: '',
        }),
      ),
      '/simplesearch',
    );
    const { rows: hits, stemmedQuery } = popStemmedQuery(rows);
    expect(stemmedQuery).toBe('τηλεργασ');
    expect(hits).toHaveLength(rows.length - 1);
    expect(hits.every((r) => r['search_stemmedQuery'] === undefined)).toBe(true);
  });

  it('leaves a result set without the marker untouched', () => {
    const rows = [{ search_ID: '1' }];
    expect(popStemmedQuery(rows)).toEqual({ rows, stemmedQuery: null });
  });
});
