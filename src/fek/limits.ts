/**
 * Hard limits of the upstream search, taken from the search.et.gr bundle
 * rather than guessed.
 *
 * The result caps are the ones the site itself warns about: it renders a
 * banner when a result set is truncated. A model that does not know a search
 * was capped will reason as though it saw everything.
 */

/** Result cap when `searchText` is used (the site's show1500Banner). */
export const CAP_WITH_TEXT = 1500;
/** The site's show5000Banner. */
export const CAP_MEDIUM = 5000;
/** Result cap for a metadata-only search (the site's show12000Banner). */
export const CAP_WITHOUT_TEXT = 12_000;

/** The site refuses shorter queries; so do we, rather than earning a 400. */
export const MIN_QUERY_LEN = 3;

/** The gazette starts in 1833. */
export const MIN_YEAR = 1833;

/**
 * The full-text index does not reach further back than this.
 *
 * search.et.gr disables its own text input for earlier years ("Search with
 * text input disabled due to selected year (prior 1992)"). Probing confirms
 * hits no earlier than 1998 in practice. Before 1992 only metadata — series,
 * number, date, page count — is searchable.
 */
export const TEXT_INDEX_FROM = 1992;

/** Which cap applies, given whether the query carried text. */
export function capFor(hasText: boolean): number {
  return hasText ? CAP_WITH_TEXT : CAP_WITHOUT_TEXT;
}

/** A note when a result set looks truncated, so the model narrows instead of concluding. */
export function capNote(total: number, hasText: boolean): string | null {
  const cap = capFor(hasText);
  if (total < cap) return null;
  return (
    `This search returned ${total} results, which is the upstream cap of ${cap}. ` +
    'There are almost certainly more matches; narrow by year, series or date range.'
  );
}

/**
 * Warn when a text query cannot possibly work.
 *
 * A keyword search restricted to 1970 returns zero rows, which is
 * indistinguishable from "no such act" unless the gap is named. Takes the
 * years as given plus any years implied by a date range, and warns only when
 * every one of them is out of the index's reach — a 1970-2000 range does
 * cover indexed years, so it gets no warning.
 */
export function textIndexWarning(
  hasQuery: boolean,
  years: readonly number[],
  publishedRange: string,
): string | null {
  if (!hasQuery) return null;
  const bounds: number[] = [...years];
  for (const part of publishedRange.split(' ')) {
    const y = Number(part.slice(0, 4));
    if (Number.isFinite(y) && y > 0) bounds.push(y);
  }
  if (bounds.length === 0 || bounds.some((y) => y >= TEXT_INDEX_FROM)) return null;
  return (
    `The gazette's full-text index does not cover years before ${TEXT_INDEX_FROM}, so a keyword ` +
    'search over this period finds nothing regardless of what was published. Search by ' +
    'series, number or date instead, or use find_law for a law by number.'
  );
}
