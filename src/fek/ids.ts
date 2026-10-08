import { seriesName } from './series.js';

/**
 * The gazette's document id, and the arithmetic that makes PDFs addressable
 * without asking the API anything.
 *
 * A ΦΕΚ id is `YYYY` + the 2-digit series id + the 5-digit issue number:
 * Τεύχος Α 121/2026 is `20260100121`. The PDF then lives at a path built from
 * the same three numbers, so `get_fek` can hand back a working link from a
 * citation alone — no search call, no network.
 */

export interface FekRef {
  year: number;
  issueGroup: number;
  number: number;
}

export function fekId(ref: FekRef): string {
  const { year, issueGroup, number } = ref;
  return `${String(year).padStart(4, '0')}${String(issueGroup).padStart(2, '0')}${String(number).padStart(5, '0')}`;
}

/** Parse an 11-digit id. Returns undefined rather than throwing on junk. */
export function parseFekId(input: string): FekRef | undefined {
  const m = /^(\d{4})(\d{2})(\d{5})$/.exec(input.trim());
  if (!m) return undefined;
  const year = Number(m[1]);
  const issueGroup = Number(m[2]);
  const number = Number(m[3]);
  // A zero in any position is not a real document.
  if (year === 0 || issueGroup === 0 || number === 0) return undefined;
  return { year, issueGroup, number };
}

/** The label the gazette prints, e.g. "Β 6047/2026". */
export function formatLabel(ref: FekRef): string {
  return `${seriesName(ref.issueGroup, ref.year)} ${ref.number}/${ref.year}`;
}

/**
 * The PDF's path within the blob container.
 *
 * Kept separate from the origin (src/et/origins.ts) so the one renameable
 * hostname stays in one file.
 */
export function pdfPath(ref: FekRef): string {
  return `fek/${String(ref.issueGroup).padStart(2, '0')}/${ref.year}/${fekId(ref)}.pdf`;
}

/** The public search.et.gr page for an issue, for a human to click. */
export function sitePath(ref: FekRef): string {
  return `/fek?fekId=${fekId(ref)}`;
}
