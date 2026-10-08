import { describe, expect, it } from 'vitest';
import {
  athensToday,
  isIsoDate,
  isWeekend,
  parseUsDateTime,
  recentDates,
  toApiRange,
} from '../../src/et/dates.js';

describe('parseUsDateTime', () => {
  it('reads the API dates as MM/DD/YYYY', () => {
    // Verified rather than assumed: a listing request for 2026-10-07 came back
    // with search_PublicationDate "10/07/2026 00:00:00".
    expect(parseUsDateTime('10/07/2026 00:00:00')).toBe('2026-10-07');
  });

  it('cannot pass under a DD/MM reading', () => {
    // The guard that makes the test above meaningful: a day above 12 is
    // unambiguous, so this pins the field order rather than just the format.
    expect(parseUsDateTime('10/31/2026 00:00:00')).toBe('2026-10-31');
    expect(parseUsDateTime('03/08/1932 00:00:00')).toBe('1932-03-08');
  });

  it('returns null for anything else', () => {
    expect(parseUsDateTime('')).toBeNull();
    expect(parseUsDateTime('2026-10-07')).toBeNull();
    expect(parseUsDateTime(null)).toBeNull();
    expect(parseUsDateTime('13/01/2026 00:00:00')).toBeNull();
  });
});

describe('isIsoDate', () => {
  it('accepts a real date and rejects a plausible fake', () => {
    expect(isIsoDate('2026-10-07')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('07/10/2026')).toBe(false);
    expect(isIsoDate('2026-1-1')).toBe(false);
  });
});

describe('toApiRange', () => {
  it('emits exactly two space-separated ISO dates', () => {
    expect(toApiRange('2026-01-01', '2026-03-31')).toBe('2026-01-01 2026-03-31');
  });

  it('mirrors a single bound onto both ends', () => {
    expect(toApiRange('2026-01-01', undefined)).toBe('2026-01-01 2026-01-01');
    expect(toApiRange(undefined, '2026-03-31')).toBe('2026-03-31 2026-03-31');
  });

  it('is empty when unbounded', () => {
    expect(toApiRange(undefined, undefined)).toBe('');
  });
});

describe('calendar helpers', () => {
  it('reports today in Athens, not UTC', () => {
    // 22:30 UTC on the 7th is already the 8th in Athens.
    expect(athensToday(Date.parse('2026-10-07T22:30:00Z'))).toBe('2026-10-08');
  });

  it('walks back calendar dates newest first', () => {
    expect(recentDates('2026-10-07', 3)).toEqual(['2026-10-07', '2026-10-06', '2026-10-05']);
  });

  it('knows the gazette does not publish at weekends', () => {
    expect(isWeekend('2026-10-04')).toBe(true); // Sunday
    expect(isWeekend('2026-10-03')).toBe(true); // Saturday
    expect(isWeekend('2026-10-07')).toBe(false);
  });
});
