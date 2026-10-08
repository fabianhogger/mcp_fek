import { fold } from '../text/normalize.js';
import { parseFekId, type FekRef } from './ids.js';
import { MIN_YEAR } from './limits.js';
import { resolveLawType, type LawType } from './lawtypes.js';
import { checkSeriesYear, resolveSeries, seriesName, type Series } from './series.js';

/**
 * Parsing the references people actually write.
 *
 * Greek legal citations are written a dozen ways and almost never the way a
 * form would ask for them:
 *
 *   ΦΕΚ Β' 1234/2024     ΦΕΚ Β΄ 1234/2024     ΦΕΚ Β’ 1234/2024
 *   Β 1234/2024          B 1234/2024 (Latin)  ΦΕΚ ΔΕΥΤΕΡΟ 1234/2024
 *   Ν. 5324/2026         ΝΟΜΟΣ 5324/2026      νόμος 5324/2026
 *   Π.Δ. 47/2026         Α.Σ.Ε.Π. 1/2026      20260100121
 *
 * The three marks after a series letter — U+0027, U+0384, U+2019 — are
 * interchangeable in practice and none of them is semantic.
 *
 * Everything here is pure. An issue citation resolves to a document id and a
 * PDF URL with no network call at all, which is why resolve_citation can
 * answer instantly and get_fek can accept a citation directly.
 */

export type Citation =
  | {
      kind: 'issue';
      ref: FekRef;
      series: Series;
      confidence: 'high' | 'low';
      /** Why confidence is low, when it is. */
      note?: string;
    }
  | {
      kind: 'law';
      lawType: LawType;
      number: string;
      year: number | undefined;
      confidence: 'high' | 'low';
      note?: string;
    }
  | { kind: 'unparsed'; reason: string };

/**
 * Marks that appear after a series letter and carry no meaning.
 *
 * Stripped before anything else, because they sit exactly where the parser
 * needs a word boundary.
 */
const CITATION_MARKS = /['΄’´ʹ′"`]/g;

/**
 * Two-digit years, expanded with a cutoff.
 *
 * The gazette predates 2000 by 167 years, so a bare "98" is far more likely to
 * be 1998 than 2098. Anything at or below the current two-digit year could be
 * either, so such a reading is always flagged low-confidence rather than
 * silently assumed.
 */
function expandTwoDigitYear(yy: number): number {
  return yy <= 30 ? 2000 + yy : 1900 + yy;
}

export function parseCitation(input: string): Citation {
  const raw = input.trim();
  if (raw === '') return { kind: 'unparsed', reason: 'empty citation' };

  // An 11-digit document id, checked before any cleaning touches it.
  const asId = parseFekId(raw);
  if (asId) {
    const series = resolveSeries(asId.issueGroup, asId.year);
    if (series.decision === 'exact') {
      return { kind: 'issue', ref: asId, series: series.series, confidence: 'high' };
    }
    return { kind: 'unparsed', reason: `${raw} has no known issue series ${asId.issueGroup}` };
  }

  const cleaned = raw.replace(CITATION_MARKS, ' ').replace(/\s+/g, ' ').trim();

  // Split the numeric tail off first and fold only the prefix.
  //
  // This order matters: `fold` collapses every non-alphanumeric character to a
  // space, the citation's slash included, so folding the whole string destroys
  // the one separator the grammar depends on.
  const withYear = /^(.*?)\s*(\d{1,5})\s*\/\s*(\d{2,4})$/.exec(cleaned);
  if (withYear) {
    const { year, note } = readYear(withYear[3]!);
    if (year === null) {
      return {
        kind: 'unparsed',
        reason: `${JSON.stringify(input)} has a year this gazette cannot have: ${withYear[3]}`,
      };
    }
    return fromParts(input, stripPrefixWords(withYear[1]!), withYear[2]!, year, note);
  }

  // A law with no year at all: «Ν. 5324». Only ever a law — a bare issue
  // number without a year identifies nothing, since the numbering restarts
  // every year.
  const withoutYear = /^(.*?)\s*(\d{1,5})$/.exec(cleaned);
  if (withoutYear) {
    const prefix = stripPrefixWords(withoutYear[1]!);
    const type = resolveType(prefix);
    if (type) {
      return {
        kind: 'law',
        lawType: type,
        number: withoutYear[2]!,
        year: undefined,
        confidence: 'low',
        note:
          'No year given. Law numbers repeat across eras — there is both a Ν. 5324/1932 and a ' +
          'Ν. 5324/2026 — so every match will be returned and the year is needed to be sure.',
      };
    }
  }

  return unparsed(input);
}

/**
 * Drop the leading «ΦΕΚ» / «ΤΕΥΧΟΣ» noise words, which carry no information.
 *
 * Accents are stripped and the case normalised first. Note that \b cannot be
 * used to find the end of these words: it is defined over ASCII \w, so there
 * is no word boundary after a Greek letter and the pattern simply never
 * matches. Hence the explicit lookahead.
 */
const NOISE_WORDS = /^(?:ΦΕΚ|FEK|ΤΕΥΧΟΣ|TEYXOS)(?=[\s.]|$)[\s.]*/u;

function stripPrefixWords(prefix: string): string {
  // Dotted «Φ.Ε.Κ.» first, so the undotted pattern can do the rest.
  let out = prefix
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/^Φ\.?Ε\.?Κ\.?(?=[\s.]|$)[\s.]*/u, '')
    .trim();
  for (;;) {
    const next = out.replace(NOISE_WORDS, '').trim();
    if (next === out) return out;
    out = next;
  }
}

/**
 * Resolve the prefix as a law type, trying it with and without its separators.
 *
 * Both spellings have to be tried because the alias table is folded, and
 * folding turns «Π.Δ.» into «Π Δ» while «ΠΔ» stays «ΠΔ» — two different keys
 * for the same thing.
 */
function resolveType(prefix: string): LawType | null {
  if (prefix === '') return null;
  const direct = resolveLawType(prefix);
  if (direct.decision === 'exact') return direct.lawType;
  const squashed = resolveLawType(prefix.replace(/[^\p{L}\p{N}]+/gu, ''));
  return squashed.decision === 'exact' ? squashed.lawType : null;
}

function resolveSeriesToken(prefix: string, year: number): Series | null {
  if (prefix === '') return null;
  const direct = resolveSeries(prefix, year);
  if (direct.decision === 'exact') return direct.series;
  const squashed = resolveSeries(prefix.replace(/[^\p{L}\p{N}]+/gu, ''), year);
  return squashed.decision === 'exact' ? squashed.series : null;
}

function fromParts(
  input: string,
  prefix: string,
  numberText: string,
  year: number,
  note: string | undefined,
): Citation {
  // Law types are tried first: «Ν.» and «Π.Δ.» name an act, and no issue
  // series shares a spelling with them.
  const type = resolveType(prefix);
  if (type) {
    return {
      kind: 'law',
      lawType: type,
      number: numberText,
      year,
      confidence: note ? 'low' : 'high',
      ...(note ? { note } : {}),
    };
  }

  const series = resolveSeriesToken(prefix, year);
  if (!series) return unparsed(input);

  const number = Number(numberText);
  if (number === 0) return unparsed(input);

  const check = checkSeriesYear(series.id, year);
  if (!check.ok) {
    return {
      kind: 'unparsed',
      reason: `${seriesName(series.id, year)} ${number}/${year} cannot exist: ${check.reason}`,
    };
  }

  return {
    kind: 'issue',
    ref: { year, issueGroup: series.id, number },
    series,
    confidence: note ? 'low' : 'high',
    ...(note ? { note } : {}),
  };
}

function unparsed(input: string): Citation {
  return {
    kind: 'unparsed',
    reason:
      `Could not read ${JSON.stringify(input)} as a ΦΕΚ reference. Recognised forms are ` +
      "«ΦΕΚ Β' 1234/2024», «Β 1234/2024», «Ν. 5324/2026», «Π.Δ. 47/2026», " +
      '«Α.Σ.Ε.Π. 1/2026» and the 11-digit id «20260100121».',
  };
}

function readYear(raw: string): { year: number | null; note?: string } {
  if (raw.length === 4) {
    const year = Number(raw);
    return year < MIN_YEAR ? { year: null } : { year };
  }
  if (raw.length === 2) {
    const year = expandTwoDigitYear(Number(raw));
    return {
      year,
      note: `The two-digit year "${raw}" was read as ${year}; confirm if that is not what was meant.`,
    };
  }
  return { year: null };
}
