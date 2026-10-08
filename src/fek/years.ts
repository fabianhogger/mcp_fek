import { MIN_YEAR } from './limits.js';

/**
 * The selectable years.
 *
 * There is an upstream `/years` endpoint, but it answers 400 in every form and
 * the site never calls it: its own year dropdown is generated client-side by
 * `getYearRange()`, counting from 1833 to the current year. So this is
 * computed rather than fetched — which is also why it needs no cache entry.
 *
 * Whether a given year actually has issues in a given series is a different
 * question, answered by /issuegroupidsbyyear.
 */
export function yearRange(now: number): number[] {
  const current = Number(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric' }).format(
      new Date(now),
    ),
  );
  const out: number[] = [];
  for (let y = current; y >= MIN_YEAR; y--) out.push(y);
  return out;
}
