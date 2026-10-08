/**
 * Date handling, of which there are three incompatible formats in play.
 *
 * 1. The API *accepts* `YYYY-MM-DD`, and rejects anything else with a bare 400.
 * 2. The API *returns* US `M/D/YYYY hh:mm:ss`. Verified rather than assumed:
 *    a listing request for 2026-10-07 came back with
 *    `search_PublicationDate: "10/07/2026 00:00:00"`.
 * 3. Date ranges go out as two ISO dates in one space-separated string,
 *    `"2026-01-01 2026-03-31"`, which is what the site's own range picker sends.
 *
 * Everything above this module speaks ISO only.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

/** Parse the API's US datetime into an ISO date. Returns null on anything else. */
export function parseUsDateTime(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(input.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The range format the search endpoints expect, or '' when unbounded. */
export function toApiRange(from: string | undefined, to: string | undefined): string {
  if (!from && !to) return '';
  const a = from ?? to!;
  const b = to ?? from!;
  return `${a} ${b}`;
}

/** Today in Europe/Athens, which is the calendar the gazette publishes on. */
export function athensToday(now: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Athens',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
}

/** Local wall-clock time in Athens, for the "as of" note on a day's listing. */
export function athensTime(now: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Athens',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(now));
}

/** Walk back `days` calendar dates from `fromIso`, inclusive, newest first. */
export function recentDates(fromIso: string, days: number): string[] {
  const start = Date.parse(`${fromIso}T12:00:00Z`);
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start - i * 86_400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Saturday or Sunday in Athens: the gazette does not publish, so zero rows is normal. */
export function isWeekend(dateIso: string): boolean {
  const day = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
