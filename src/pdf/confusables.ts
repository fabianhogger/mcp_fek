/**
 * Latin lookalikes mapped to Greek, 1:1 so offsets survive.
 *
 * This exists because the largest laws spell their own heading `NOMOΣ` with a
 * Latin N and a Latin O. An anchor pattern written in Greek therefore misses
 * the very document it was written for.
 *
 * Deliberately NOT the same thing as src/text/normalize.ts `fold`. That folder
 * also strips accents, uppercases and collapses punctuation, all of which
 * change the string's length — and the parser matches anchors on a shadow copy
 * and then slices the *original* at the offsets it found. A length-changing
 * transform would silently shift every slice. Keeping this strictly
 * character-for-character is what makes that safe.
 */

const FROM = 'ABEZHIKMNOPTXY';
const TO = 'ΑΒΕΖΗΙΚΜΝΟΡΤΧΥ';

const MAP = new Map<string, string>();
for (let i = 0; i < FROM.length; i++) MAP.set(FROM[i]!, TO[i]!);

/**
 * Transliterate Latin capitals that are visually identical to Greek ones.
 *
 * The result is only ever used for *finding* anchors. Text handed back to a
 * caller is always sliced from the original.
 */
export function toGreekLookalikes(text: string): string {
  let out = '';
  for (const ch of text) out += MAP.get(ch) ?? ch;
  return out;
}

/** Guards the invariant the parser depends on. */
export function preservesLength(text: string): boolean {
  return toGreekLookalikes(text).length === text.length;
}
