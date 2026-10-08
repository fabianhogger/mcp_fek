import { squash } from './clean.js';
import { toGreekLookalikes } from './confusables.js';
import type { ParsedFek, Section, TocEntry } from './doc.js';
import { isGarbled, isGarbledParagraph } from './garbled.js';

/**
 * Turning gazette text into an addressable document.
 *
 * Ported from the Python implementation in vibecodes/fek, which was tuned
 * against real issues over a working deployment. The anchors are not guesses:
 * each one is the shape these documents actually have, and the comments record
 * why the obvious simpler version does not work.
 *
 * Four document shapes have to be handled, because the gazette has four:
 *
 *  1. A Τεύχος Α law with a ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ and numbered articles.
 *  2. A short Τεύχος Α decree with articles but no table of contents (the
 *     median Τεύχος Α is three pages).
 *  3. A cabinet act with no articles at all, whose body is a free-form
 *     strategy document.
 *  4. A Τεύχος Β issue: many unrelated acts, delimited by bare `(n)` markers
 *     that tie back to a ΠΕΡΙΕΧΟΜΕΝΑ list. This is ~90% of all volume.
 */

const ARTICLE = /^[ \t]*Άρθρο\s+(\d+)(?:[ \t]+(.*))?$/gm;
const ARTICLE_LINE = /^[ \t]*Άρθρο\s+(\d+)(?:[ \t]+(.*))?$/;

const LAW_HEADING =
  /(ΝΟΜΟΣ|ΠΡΟΕΔΡΙΚΟ\s+ΔΙΑΤΑΓΜΑ|ΠΡΑΞΗ\s+ΝΟΜΟΘΕΤΙΚΟΥ\s+ΠΕΡΙΕΧΟΜΕΝΟΥ)\s+ΥΠ['’]?\s*ΑΡΙΘΜ\.?\s*(\d+)/;

/**
 * Cabinet acts head differently: «Πράξη 22 της 30-7-2026», under a
 * ΠΡΑΞΕΙΣ ΥΠΟΥΡΓΙΚΟΥ ΣΥΜΒΟΥΛΙΟΥ banner that kerning may split as
 * «ΣΥΜΒΟΥ ΛΙΟΥ» — which is why the banner itself is not the anchor.
 */
const PYS_HEADING = /^[ \t]*Πράξη\s+(\d+)\s+της\s+([\d./-]+)/m;

/**
 * Where the preamble ends and the enacted text begins.
 *
 * Note the `(?!\p{L})` rather than `\b`. JavaScript's `\b` is defined over
 * ASCII `\w`, so there is no word boundary after a Greek letter and `\b` here
 * simply never matches — the Python original could use it because Python's
 * `\b` is Unicode-aware for str patterns. Getting this wrong silently leaves
 * the whole enacting formula inside the act's title.
 */
const LAW_BODY_START =
  /^\s*(?:Ο|Η|ΟΙ|ΤΟ)\s+(?:ΠΡΟΕΔΡΟΣ|ΥΠΟΥΡΓΟΣ|ΥΠΟΥΡΓΟΙ|ΑΝΤΙΠΡΟΕΔΡΟΣ|ΥΠΟΥΡΓΙΚΟ)(?!\p{L})/mu;

/** Matched against squashed text, because kerning splits both of these. */
const TOC_ANCHOR_A = /ΠΙΝΑΚΑΣΠΕΡΙΕΧΟΜΕΝΩΝ/;
const TOC_ANCHOR_B = /ΠΕΡΙΕΧΟΜΕΝΑ/;

const PART = /^[ \t]*(ΜΕΡΟΣ|ΚΕΦΑΛΑΙΟ)\s+([Α-Ω]+['’]?)\s*[:.]?\s*(.*)$/;

/** A Τεύχος Β table-of-contents line: «1 Κοστολόγηση … 56349». */
const TOC_ITEM_B = /^[ \t]*(\d{1,3})[ \t]+(\S.*)$/;

/**
 * An act heading within a Τεύχος Β issue.
 *
 * The `(n)` marker sits either at the end of an «Αριθμ. …» protocol line or,
 * for acts with no protocol number, alone on its own line.
 */
const ACT_HEADING_B = /^[ \t]*(?:Αριθμ\.?[ \t]*(\S[^\n]*?)[ \t]*)?\((\d{1,3})\)[ \t]*$/gm;

const TYPE_LABELS: Readonly<Record<string, string>> = {
  ΝΟΜΟΣ: 'Ν.',
  'ΠΡΟΕΔΡΙΚΟ ΔΙΑΤΑΓΜΑ': 'Π.Δ.',
  'ΠΡΑΞΗ ΝΟΜΟΘΕΤΙΚΟΥ ΠΕΡΙΕΧΟΜΕΝΟΥ': 'Π.Ν.Π.',
};

const LAW_NAME_MAX = 400;
const HEADING_SEARCH_WINDOW = 8000;

/** Free-form documents carry no headings, so they are chunked into blocks. */
const CHUNK_CHARS = 6000;
const CHUNK_PREVIEW = 180;

function entry(number: number, title: string, part = '', chapter = ''): TocEntry {
  return { number, title, part, chapter };
}

/** The act's title: everything between its heading and the enacting formula. */
function titleAfter(text: string, offset: number): string {
  const tail = text.slice(offset);
  const end = LAW_BODY_START.exec(tail);
  const title = end ? tail.slice(0, end.index) : tail.slice(0, LAW_NAME_MAX);
  return title.replace(/\s*\n\s*/g, ' ').trim().slice(0, LAW_NAME_MAX);
}

export interface LawHeading {
  type: string;
  number: string;
  title: string;
}

export function parseLawHeading(text: string): LawHeading {
  // Anchors are matched against a lookalike-normalised shadow copy, because
  // the largest laws spell their own heading NOMOΣ with a Latin N and O. The
  // transform is 1:1, so offsets into the original stay valid.
  const normalised = toGreekLookalikes(text);

  const match = LAW_HEADING.exec(normalised);
  if (match) {
    const kind = match[1]!.replace(/\s+/g, ' ');
    return {
      type: TYPE_LABELS[kind] ?? kind,
      number: match[2]!,
      title: titleAfter(text, match.index + match[0].length),
    };
  }

  const cabinet = PYS_HEADING.exec(normalised);
  if (cabinet) {
    return {
      type: 'Π.Υ.Σ.',
      number: cabinet[1]!,
      title: titleAfter(text, cabinet.index + cabinet[0].length),
    };
  }

  return { type: '', number: '', title: '' };
}

/**
 * Where the article body starts.
 *
 * Table-of-contents entries and body headings share the «Άρθρο N» form, so
 * they cannot be told apart by shape. But the body restarts the numbering, so
 * the split is the first point at which the article number stops increasing.
 */
export function splitTocBody(text: string): number {
  const matches = [...text.matchAll(ARTICLE)];
  if (matches.length < 2) return 0;
  let previous = 0;
  for (const match of matches) {
    const current = Number(match[1]);
    if (current <= previous) return match.index;
    previous = current;
  }
  return 0;
}

/** Parse the ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ of a Τεύχος Α law. */
export function parseTocA(tocText: string): TocEntry[] {
  const entries: TocEntry[] = [];
  let part = '';
  let chapter = '';
  // Titles wrap across lines, so accumulate into the last entry seen.
  let pending: TocEntry | null = null;

  for (const line of tocText.split('\n')) {
    const stripped = line.trim();
    if (stripped === '') continue;

    const structural = PART.exec(line);
    if (structural) {
      pending = null;
      const label = `${structural[1]} ${structural[2]}: ${structural[3]}`.trim();
      if (structural[1] === 'ΜΕΡΟΣ') {
        part = label;
        chapter = '';
      } else {
        chapter = label;
      }
      continue;
    }

    const article = ARTICLE_LINE.exec(line);
    if (article) {
      pending = entry(Number(article[1]), (article[2] ?? '').trim(), part, chapter);
      entries.push(pending);
    } else if (pending !== null) {
      pending.title = `${pending.title} ${stripped}`.trim();
    }
  }

  return entries;
}

/** Parse the numbered ΑΠΟΦΑΣΕΙΣ list of a Τεύχος Β issue. */
export function parseTocB(text: string): TocEntry[] {
  if (!TOC_ANCHOR_B.test(squash(text))) return [];

  // The list sits between the first ΑΠΟΦΑΣΕΙΣ heading and the second, which is
  // where the acts themselves begin.
  const start = text.indexOf('ΑΠΟΦΑΣΕΙΣ');
  if (start < 0) return [];
  const body = text.indexOf('ΑΠΟΦΑΣΕΙΣ', start + 1);
  const tocText = text.slice(start + 'ΑΠΟΦΑΣΕΙΣ'.length, body > 0 ? body : undefined);

  const entries: TocEntry[] = [];
  let pending: TocEntry | null = null;
  for (const line of tocText.split('\n')) {
    const stripped = line.trim();
    if (stripped === '') continue;
    const item = TOC_ITEM_B.exec(line);
    if (item) {
      pending = entry(Number(item[1]), item[2]!.trim());
      entries.push(pending);
    } else if (pending !== null) {
      pending.title = `${pending.title} ${stripped}`.trim();
    }
  }

  // Trailing page numbers are an artefact of the two-column layout.
  for (const e of entries) e.title = e.title.replace(/\s*\d{4,6}\s*$/, '').trim();
  return entries;
}

function firstLine(text: string, limit = 200): string {
  for (const line of text.split('\n')) {
    const stripped = line.trim();
    if (stripped !== '') return stripped.slice(0, limit);
  }
  return '';
}

export function parseSectionsA(bodyText: string): Section[] {
  const matches = [...bodyText.matchAll(ARTICLE)];
  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : bodyText.length;
    const text = bodyText.slice(match.index + match[0].length, end).trim();
    // In the body the title usually sits on the line below the heading, not
    // beside it as it does in the table of contents.
    const title = (match[2] ?? '').trim() || firstLine(text);
    sections.push({ number: Number(match[1]), title, text });
  }
  return sections;
}

/**
 * Split an unstructured document into addressable blocks.
 *
 * For acts with no «Άρθρο» headings at all — an 80-page national strategy
 * approved by a cabinet act, say. Without this the whole thing is one
 * 190,000-character section, which is the same as not being addressable.
 *
 * Unrecoverable paragraphs are dropped here, before the blocks are formed,
 * rather than by discarding whole blocks afterwards. It matters: the cabinet
 * act's operative text runs straight into its undecodable annex, so the
 * boundary falls inside a block, and filtering afterwards throws away the
 * publication clause along with the garbage.
 */
export function chunk(text: string, chunkChars = CHUNK_CHARS): Section[] {
  if (text.trim() === '') return [];

  const blocks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const raw of text.split(/\n\s*\n/)) {
    const paragraph = raw.trim();
    if (paragraph === '') continue;
    if (isGarbledParagraph(paragraph)) continue;
    if (size > 0 && size + paragraph.length > chunkChars) {
      blocks.push(current.join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(paragraph);
    size += paragraph.length;
  }
  if (current.length > 0) blocks.push(current.join('\n\n'));

  return blocks.map((block, i) => ({
    number: i + 1,
    title: `${block.slice(0, CHUNK_PREVIEW).replace(/\s+/g, ' ').trim()}…`,
    text: block,
  }));
}

/** Split a Τεύχος Β issue into its individual acts. */
export function parseSectionsB(text: string, toc: readonly TocEntry[]): Section[] {
  const start = text.indexOf('ΑΠΟΦΑΣΕΙΣ');
  const bodyStart = start >= 0 ? text.indexOf('ΑΠΟΦΑΣΕΙΣ', start + 1) : -1;
  const body = bodyStart > 0 ? text.slice(bodyStart) : text;

  const matches = [...body.matchAll(ACT_HEADING_B)];
  const titles = new Map(toc.map((e) => [e.number, e.title]));
  const sections: Section[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const end = i + 1 < matches.length ? matches[i + 1]!.index : body.length;
    const number = Number(match[2]);
    const sectionText = body.slice(match.index + match[0].length, end).trim();
    sections.push({
      number,
      title: titles.get(number) || firstLine(sectionText),
      text: sectionText,
    });
  }
  return sections;
}

export interface ParseTextOptions {
  pageCount: number;
  /** 2 for Τεύχος Β, which has a different structure entirely. */
  issueGroup: number;
}

/**
 * Parse already-extracted text.
 *
 * Kept separate from reading a PDF so the structural logic can be tested
 * without shipping 15 MB of binaries — the same split the Python version made,
 * and the reason its test suite ports across directly.
 *
 * Line endings are normalised first because every anchor below is
 * line-anchored, and a trailing `\r` defeats any of them ending in `$`
 * without the multiline flag (`PART` is one). pdf.js never emits `\r`, so
 * this costs nothing in production and makes text read from a file — a
 * snapshot checked out on Windows, say — parse identically.
 */
export function parseText(input: string, opts: ParseTextOptions): ParsedFek {
  const text = input.includes('\r') ? input.replace(/\r\n?/g, '\n') : input;
  const heading = parseLawHeading(text.slice(0, HEADING_SEARCH_WINDOW));
  let lawTitle = heading.title;
  let toc: TocEntry[];
  let sections: Section[];

  if (opts.issueGroup === 2) {
    toc = parseTocB(text);
    sections = parseSectionsB(text, toc);
    if (lawTitle === '' && toc.length > 0) lawTitle = toc[0]!.title;
  } else {
    const split = splitTocBody(text);
    const hasToc = TOC_ANCHOR_A.test(squash(text.slice(0, split || HEADING_SEARCH_WINDOW)));
    if (split > 0 && hasToc) {
      toc = parseTocA(text.slice(0, split));
      sections = parseSectionsA(text.slice(split));
    } else {
      // Short acts carry no table of contents at all.
      toc = [];
      sections = parseSectionsA(text);
      if (sections.length === 0) {
        // No articles either: a free-form document such as a national strategy
        // approved by a cabinet act.
        sections = chunk(text);
      }
    }
  }

  // Fall back to the table of contents when article headings could not be
  // split out, so the document is still addressable.
  if (sections.length === 0 && toc.length > 0) {
    sections = toc.map((e) => ({ number: e.number, title: e.title, text: '' }));
  }

  // Drop anything whose font encoding is unrecoverable. Summarising it would
  // produce a confident description of nothing.
  const readable = sections.filter((s) => !isGarbled(s.text));
  const droppedUnreadable = sections.length - readable.length;
  if (droppedUnreadable > 0) {
    const kept = new Set(readable.map((s) => s.number));
    sections = readable;
    if (toc.length > 0) toc = toc.filter((e) => kept.has(e.number));
  }

  // A short act has no table of contents; derive one from the sections so
  // every document presents the same shape regardless of size.
  if (toc.length === 0 && sections.length > 0) {
    toc = sections.map((s) => entry(s.number, s.title));
  }

  return {
    pageCount: opts.pageCount,
    lawType: heading.type,
    lawNumber: heading.number,
    lawTitle,
    toc,
    sections,
    fullText: text,
    droppedUnreadable,
  };
}
