/**
 * Repairing the three text artefacts every gazette PDF has.
 *
 * All three are documented behaviours of the source documents rather than
 * extraction bugs, so they are handled here once rather than worked around at
 * every call site.
 */

/** Lowercase Greek and Latin, for deciding whether a hyphen joins a word. */
const LOWER = 'α-ωάέήίόύώϊϋΐΰςa-z';

/**
 * Page furniture, repeated on every page of every issue.
 *
 * The bare `\d{1,6}` line is the running page number, and the single `E` is
 * the masthead's drop cap. Both would otherwise land in the middle of an
 * article's text.
 */
const FURNITURE = new RegExp(
  '^(?:' +
    'ΕΦΗΜΕΡΙΔΑ\\s+ΤΗΣ\\s+ΚΥΒΕΡΝΗΣΕΩΣ' +
    '|ΤΗΣ\\s+ΕΛΛΗΝΙΚΗΣ\\s+ΔΗΜΟΚΡΑΤΙΑΣ' +
    '|E' +
    "|\\d*\\s*Τεύχος\\s+[Α-ΩA-Z]['’]?\\s*\\d+/\\d{2}\\.\\d{2}\\.\\d{4}\\s*\\d*" +
    '|\\d{1,6}' +
    ')\\s*$',
  'gm',
);

/**
 * Rejoin a word split across a line break.
 *
 * Only joins when both sides are lowercase, so a genuine dash between words
 * survives: «Κληρονομιάς - Στρατηγική» must not become one word, while
 * «Δι-\naχείρισης» must.
 */
export function dehyphenate(text: string): string {
  return text.replace(new RegExp(`([${LOWER}])\\s*-\\s*\\n\\s*([${LOWER}])`, 'g'), '$1$2');
}

/**
 * Strip all whitespace.
 *
 * Kerning inserts spaces inside words — «ΟΡΓ ΑΝΙΣΜΟΣ», «Γ ραμματείας»,
 * «ΠΕΡ ΙΕΧΟΜΕΝΑ». Repairing that would need a lexicon and would risk merging
 * genuinely separate words, so instead every structural anchor that can be is
 * matched whitespace-insensitively against a squashed copy.
 */
export function squash(text: string): string {
  return text.replace(/\s+/g, '');
}

export function clean(text: string): string {
  let out = text.replace(/ /g, ' ').replace(/­/g, '');
  out = out.replace(FURNITURE, '');
  out = dehyphenate(out);
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}
