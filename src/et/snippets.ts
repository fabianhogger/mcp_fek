/**
 * The two match fields a text search adds to each row, which are encoded
 * differently from one another for no reason anyone wrote down.
 *
 * `search_MatchedText` is base64 of UTF-8: a window of roughly a thousand
 * characters of the act's body, ending at the match. It is the index's own
 * copy of the text, which has been accent-stripped and lowercased — so it is
 * genuinely useful for locating and summarising, and must never be presented
 * as the published wording of a law.
 *
 * `search_HighlightedText`, despite the parallel name, is *not* base64. It is
 * a plain JSON array of the surface forms that matched: `["τηλεργασια"]`,
 * `["τηλεργασιας"]`. Running it through base64 yields nothing.
 */

/** Decode a base64 body extract. Returns null rather than throwing on junk. */
export function decodeMatchedText(input: unknown): string | null {
  if (typeof input !== 'string' || input.trim() === '') return null;
  try {
    const text = Buffer.from(input, 'base64').toString('utf8');
    // A mis-decode produces replacement characters rather than an exception.
    if (text === '' || text.includes('�')) return null;
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

/** The matched surface forms. Plain JSON, not base64. */
export function parseHighlighted(input: unknown): readonly string[] {
  if (Array.isArray(input)) return input.filter((x): x is string => typeof x === 'string');
  if (typeof input !== 'string' || input.trim() === '') return [];
  try {
    const parsed = JSON.parse(input) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    // Not JSON: treat a bare word as a single term rather than losing it.
    return [input.trim()];
  }
  return [];
}

/**
 * The caveat that must accompany any extract.
 *
 * Stated once here so every tool that shows an extract says the same thing.
 */
export const EXTRACT_CAVEAT =
  'Extracts come from the gazette search index, which stores text ' +
  'accent-stripped and in lower case. Use them to judge relevance, not to quote ' +
  'the published wording — fetch the issue for that.';
