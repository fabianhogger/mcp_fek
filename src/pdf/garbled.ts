/**
 * Detecting text that came out of an undecodable font encoding.
 *
 * Some issues embed subset fonts with no ToUnicode map. The 76-page strategy
 * annex of Π.Υ.Σ. 22/2026 is the reference case: it extracts as
 * `D\}ZR^l}N]\aRXRg}` under pypdf, poppler *and* pdf.js alike. The mapping is
 * genuinely absent from the file, so no library and no amount of OCR-free
 * cleverness recovers it — the only correct response is to notice and drop it.
 *
 * Dropping matters more than it sounds: handed to a model, that string
 * produces a confident summary of nothing.
 *
 * Two signals together, because either alone has false positives. An English
 * annex is legitimately low on Greek letters; a table of contents is
 * legitimately full of punctuation.
 */

const GREEK = /[Ͱ-Ͽἀ-῿]/;

/** Below this, the sample is too small for the ratios to mean anything. */
const MIN_LENGTH = 200;
/**
 * A lower bar for a single paragraph.
 *
 * Paragraph-level filtering is what stops a readable paragraph being thrown
 * away because it shared a chunk with the annex, so it has to work on shorter
 * samples than a whole section. Still long enough that a heading or a one-line
 * citation cannot trip it.
 */
const MIN_PARAGRAPH_LENGTH = 80;
const MAX_NON_GREEK_RATIO = 0.5;
const MIN_DELIMITER_RATIO = 0.02;
const MIN_REPLACEMENT_RATIO = 0.15;

export function isGarbled(text: string, minLength = MIN_LENGTH): boolean {
  if (text.length < minLength) return false;

  let letters = 0;
  let greek = 0;
  let delimiters = 0;
  let unmapped = 0;

  for (const ch of text) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      if (GREEK.test(ch)) greek++;
    }
    if (ch === '}' || ch === '~' || ch === '\\') delimiters++;
    // pdf.js does not necessarily produce the same substitutes pypdf does for
    // a font with no usable encoding; it tends toward private-use and control
    // characters instead. Both tells are accepted.
    const code = ch.codePointAt(0)!;
    if (
      (code >= 0xe000 && code <= 0xf8ff) ||
      (code >= 0xf0000 && code <= 0xffffd) ||
      (code < 0x20 && ch !== '\n' && ch !== '\t' && ch !== '\r')
    ) {
      unmapped++;
    }
  }

  if (letters === 0) return false;
  if (greek / letters >= MAX_NON_GREEK_RATIO) return false;

  return (
    delimiters / text.length > MIN_DELIMITER_RATIO ||
    unmapped / text.length > MIN_REPLACEMENT_RATIO
  );
}

/**
 * Is this single paragraph unrecoverable?
 *
 * Used to strip the undecodable annex out before chunking rather than after.
 * Chunking first and filtering second loses readable text whenever the
 * boundary between good and broken falls inside one chunk — which is exactly
 * what happens to the operative tail of a cabinet act whose annex follows it.
 */
export function isGarbledParagraph(text: string): boolean {
  return isGarbled(text, MIN_PARAGRAPH_LENGTH);
}
