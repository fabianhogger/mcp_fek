/**
 * The parsed shape of an issue, and how it is rendered to a budget.
 *
 * The whole reason this exists: one gazette issue can be 112 pages and 450,000
 * characters. Returning that is useless. Returning a table of contents plus
 * the two articles a caller actually asked for is the useful thing, and that
 * requires the document to be addressable rather than a blob.
 */

export interface TocEntry {
  /** Άρθρο number for Τεύχος Α, or the ΑΠΟΦΑΣΕΙΣ item number for Τεύχος Β. */
  number: number;
  title: string;
  /** The enclosing ΜΕΡΟΣ, for context. */
  part: string;
  /** The enclosing ΚΕΦΑΛΑΙΟ. */
  chapter: string;
}

export interface Section {
  number: number;
  title: string;
  text: string;
}

export interface ParsedFek {
  pageCount: number;
  /** "Ν." / "Π.Δ." / "Π.Ν.Π." / "Π.Υ.Σ.", or '' for a Τεύχος Β issue. */
  lawType: string;
  lawNumber: string;
  lawTitle: string;
  toc: readonly TocEntry[];
  sections: readonly Section[];
  fullText: string;
  /** Sections dropped because their font encoding was unrecoverable. */
  droppedUnreadable: number;
}

/** A short citable name: «Ν. 5324/2026», or «ΦΕΚ Β 5013/2026» for an issue. */
export function lawName(parsed: ParsedFek, label: string): string {
  if (parsed.lawType && parsed.lawNumber) {
    const year = label.slice(label.lastIndexOf('/') + 1);
    return `${parsed.lawType} ${parsed.lawNumber}/${year}`;
  }
  return `ΦΕΚ ${label}`;
}

/**
 * Flatten the table of contents.
 *
 * ΜΕΡΟΣ and ΚΕΦΑΛΑΙΟ headings are emitted only when they change rather than
 * repeated on every entry: on the largest law that is the difference between
 * 36,000 and 13,000 characters.
 */
export function renderToc(toc: readonly TocEntry[], limit?: number): string {
  const entries = limit === undefined ? toc : toc.slice(0, limit);
  const lines: string[] = [];
  let part = '';
  let chapter = '';
  for (const entry of entries) {
    if (entry.part && entry.part !== part) {
      part = entry.part;
      chapter = '';
      lines.push('', part);
    }
    if (entry.chapter && entry.chapter !== chapter) {
      chapter = entry.chapter;
      lines.push(chapter);
    }
    lines.push(`${entry.number}. ${entry.title}`.trim());
  }
  return lines.join('\n').trim();
}

export interface SectionTextOptions {
  /** Which sections to return. Empty means "from the start". */
  numbers: readonly number[];
  maxChars: number;
  /** How a section heading is labelled; differs between Α and Β issues. */
  label: (section: Section) => string;
}

export interface SectionTextResult {
  text: string;
  /** Sections actually included. */
  included: readonly number[];
  /** True when the budget cut the text short. */
  truncated: boolean;
}

export function sectionText(
  sections: readonly Section[],
  opts: SectionTextOptions,
): SectionTextResult {
  const wanted =
    opts.numbers.length > 0
      ? sections.filter((s) => opts.numbers.includes(s.number))
      : sections;
  if (wanted.length === 0) {
    return { text: '', included: [], truncated: false };
  }

  const blocks: string[] = [];
  const included: number[] = [];
  let used = 0;
  let truncated = false;

  for (const section of wanted) {
    const full = `${opts.label(section)}\n${section.text}`.trim();
    if (used + full.length > opts.maxChars) {
      const room = Math.max(0, opts.maxChars - used);
      // Only bother including a fragment if it is long enough to be worth
      // reading; otherwise stop cleanly and say so.
      if (room > 200) {
        blocks.push(`${full.slice(0, room)}…`);
        included.push(section.number);
      }
      truncated = true;
      break;
    }
    blocks.push(full);
    included.push(section.number);
    used += full.length;
  }

  return { text: blocks.join('\n\n'), included, truncated };
}

/** Which sections exist but were not returned, so a caller can ask for them. */
export function remainingSections(
  sections: readonly Section[],
  included: readonly number[],
): number[] {
  return sections.map((s) => s.number).filter((n) => !included.includes(n));
}
