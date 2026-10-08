import { fold } from '../text/normalize.js';
import { MIN_YEAR } from './limits.js';

/**
 * The τεύχος (issue series) of the gazette.
 *
 * The id→name map is the SPA's own `issueTypeToNameMap`, not a reconstruction.
 * Two things about it are easy to get wrong:
 *
 * 1. Id 11 renamed itself. It was ΑΕ-ΕΠΕ (company filings) and became
 *    ΠΡΑ.Δ.Ι.Τ. from 2015, and the site resolves the name using the document's
 *    year. The same id therefore prints differently for 2014 and 2016.
 * 2. Several series are closed. Ν.Π.Δ.Δ., Α.Π.Σ. and ΠΑΡΑΡΤΗΜΑ all ended in
 *    2006, and Γ only begins in 1984. Searching outside a series' range
 *    returns zero rows with no explanation, so we validate locally and say
 *    why instead.
 */

export interface Series {
  id: number;
  /** The name as the gazette prints it, for the year in question. */
  name: string;
  /** First year this series published; MIN_YEAR when it predates the record. */
  from: number;
  /** Last year this series published, or null if it is still running. */
  to: number | null;
}

/** Base names, from the bundle's issueTypeToNameMap. */
const NAMES: Readonly<Record<number, string>> = {
  1: 'Α',
  2: 'Β',
  3: 'Γ',
  4: 'Δ',
  5: 'Ν.Π.Δ.Δ.',
  6: 'Α.Π.Σ.',
  7: 'ΠΑΡΑΡΤΗΜΑ',
  8: 'Δ.Ε.Β.Ι.',
  9: 'Α.ΕΙ.Δ.',
  10: 'Α.Σ.Ε.Π.',
  11: 'ΑΕ-ΕΠΕ',
  12: 'Δ.Δ.Σ.',
  13: 'Ο.Π.Κ.',
  14: 'Υ.Ο.Δ.Δ.',
  15: 'Α.Α.Π.',
};

/** Id 11's post-2015 name, keyed "11_2015" in the bundle. */
const NAME_11_FROM_2015 = 'ΠΡΑ.Δ.Ι.Τ.';
const ID_11_RENAMED_IN = 2015;

/** Year ranges, from the bundle's per-issue year map. */
const RANGES: Readonly<Record<number, readonly [number, number | null]>> = {
  1: [MIN_YEAR, null],
  2: [1930, null],
  3: [1984, null],
  4: [1959, null],
  5: [1984, 2006],
  6: [2000, 2006],
  7: [2000, 2006],
};

export const SERIES_IDS: readonly number[] = Object.keys(NAMES)
  .map(Number)
  .sort((a, b) => a - b);

/** The series' printed name, resolved for a given year where that matters. */
export function seriesName(id: number, year?: number): string {
  if (id === 11 && year !== undefined && year >= ID_11_RENAMED_IN) return NAME_11_FROM_2015;
  return NAMES[id] ?? String(id);
}

export function series(id: number, year?: number): Series | undefined {
  if (!(id in NAMES)) return undefined;
  const [from, to] = RANGES[id] ?? [MIN_YEAR, null];
  return { id, name: seriesName(id, year), from, to };
}

export function allSeries(year?: number): readonly Series[] {
  return SERIES_IDS.map((id) => series(id, year)!);
}

/**
 * Every spelling of a series we accept.
 *
 * Built from the printed names plus, per series, the ordinal word people
 * actually say (ΔΕΥΤΕΡΟ for Β), the undotted abbreviation (ΑΣΕΠ for Α.Σ.Ε.Π.)
 * and a Latin transliteration, because a lot of Greek gets typed on a Latin
 * keyboard. Keys are folded, so accents, case and Latin homoglyphs are already
 * handled by `fold` and need no entries of their own.
 */
const EXTRA_ALIASES: Readonly<Record<number, readonly string[]>> = {
  1: ['ΠΡΩΤΟ', 'A', 'ALPHA', 'PROTO'],
  2: ['ΔΕΥΤΕΡΟ', 'B', 'BETA', 'DEFTERO', 'DEYTERO'],
  3: ['ΤΡΙΤΟ', 'G', 'GAMMA', 'TRITO'],
  4: ['ΤΕΤΑΡΤΟ', 'D', 'DELTA', 'TETARTO'],
  5: ['ΝΠΔΔ', 'NPDD'],
  6: ['ΑΠΣ', 'APS'],
  7: ['PARARTIMA'],
  8: ['ΔΕΒΙ', 'DEVI', 'DEBI'],
  9: ['ΑΕΙΔ', 'AEID'],
  10: ['ΑΣΕΠ', 'ASEP'],
  11: ['ΑΕΕΠΕ', 'ΑΕ ΕΠΕ', 'AE EPE', 'ΠΡΑΔΙΤ', 'PRADIT', 'ΠΡΑ.Δ.Ι.Τ.'],
  12: ['ΔΔΣ', 'DDS'],
  13: ['ΟΠΚ', 'OPK'],
  14: ['ΥΟΔΔ', 'YODD', 'UODD'],
  15: ['ΑΑΠ', 'AAP'],
};

/** folded alias -> series ids that accept it. */
const ALIAS_INDEX: ReadonlyMap<string, readonly number[]> = (() => {
  const index = new Map<string, number[]>();
  const add = (alias: string, id: number): void => {
    const key = fold(alias);
    if (key === '') return;
    const bucket = index.get(key);
    if (bucket) {
      if (!bucket.includes(id)) bucket.push(id);
    } else {
      index.set(key, [id]);
    }
  };

  for (const id of SERIES_IDS) {
    add(String(id), id);
    add(NAMES[id]!, id);
    if (id === 11) add(NAME_11_FROM_2015, id);
    for (const alias of EXTRA_ALIASES[id] ?? []) add(alias, id);
  }
  return index;
})();

export type SeriesResolution =
  | { decision: 'exact'; series: Series }
  | { decision: 'ambiguous'; candidates: readonly Series[] }
  | { decision: 'none' };

/**
 * Resolve user input to a series.
 *
 * Deliberately exact-or-nothing: a series is a short code, and fuzzy matching
 * "Α" against "Α.Α.Π." would silently search the wrong series. Ambiguity
 * returns the candidates so the caller can ask.
 */
export function resolveSeries(input: string | number, year?: number): SeriesResolution {
  const key = fold(String(input));
  if (key === '') return { decision: 'none' };
  const ids = ALIAS_INDEX.get(key);
  if (!ids || ids.length === 0) return { decision: 'none' };
  if (ids.length === 1) return { decision: 'exact', series: series(ids[0]!, year)! };
  return { decision: 'ambiguous', candidates: ids.map((id) => series(id, year)!) };
}

export interface YearCheck {
  ok: boolean;
  reason?: string;
}

/** Catch an impossible series/year pair locally, rather than as an empty result. */
export function checkSeriesYear(id: number, year: number): YearCheck {
  const s = series(id, year);
  if (!s) return { ok: false, reason: `There is no issue series with id ${id}.` };
  if (year < MIN_YEAR) {
    return { ok: false, reason: `The gazette begins in ${MIN_YEAR}; ${year} predates it.` };
  }
  if (year < s.from) {
    return {
      ok: false,
      reason: `Τεύχος ${s.name} begins in ${s.from}, so there is no ${s.name} issue for ${year}.`,
    };
  }
  if (s.to !== null && year > s.to) {
    return {
      ok: false,
      reason: `Τεύχος ${s.name} stopped publishing in ${s.to}, so there is no ${s.name} issue for ${year}.`,
    };
  }
  return { ok: true };
}
