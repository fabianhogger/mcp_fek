import { clean } from './clean.js';

/**
 * PDF text extraction, on pdf.js.
 *
 * The library choice is driven by *line structure*, not by extraction quality.
 * Every structural anchor in src/pdf/structure.ts is line-anchored —
 * `^Άρθρο N`, `^ΜΕΡΟΣ`, `^(n)$` — so a library that hands back a page as one
 * space-joined string destroys all of them before the parser ever runs. pdf.js
 * exposes `hasEOL` per text item plus per-item geometry, which is exactly what
 * is needed and what the convenience wrappers around it abstract away.
 *
 * Loaded lazily: `tools/list` and every metadata-only call must not pay for
 * parsing a multi-megabyte dependency they will never use.
 */

export interface ExtractResult {
  text: string;
  pageCount: number;
  /** Pages that yielded no text at all — the signature of a scanned image. */
  emptyPages: number;
}

interface TextItem {
  str: string;
  hasEOL: boolean;
  transform: number[];
  width: number;
}

interface PdfModule {
  getDocument(src: Record<string, unknown>): { promise: Promise<PdfDocument> };
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfPage {
  getTextContent(opts: Record<string, unknown>): Promise<{ items: unknown[] }>;
}

let cached: PdfModule | undefined;

async function load(): Promise<PdfModule> {
  if (!cached) {
    // The legacy build is the one that runs on Node without a DOM.
    cached = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfModule;
  }
  return cached;
}

export interface ExtractOptions {
  /** Stop after this many pages. Used to sample a huge issue cheaply. */
  maxPages?: number | undefined;
}

export async function extractText(
  bytes: Uint8Array,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const pdfjs = await load();
  const doc = await pdfjs.getDocument({
    // A copy, because pdf.js transfers ownership of the buffer it is given.
    data: new Uint8Array(bytes),
    // No scripting, no remote font fetching, no system font probing: this is
    // a file downloaded from a third party and parsed unattended.
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
  }).promise;

  try {
    const limit = opts.maxPages === undefined ? doc.numPages : Math.min(opts.maxPages, doc.numPages);
    const pages: string[] = [];
    let emptyPages = 0;

    for (let n = 1; n <= limit; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent({ includeMarkedContent: false });
      const text = linesFromTextContent(content.items as TextItem[]);
      if (text.trim() === '') emptyPages++;
      pages.push(text);
    }

    return {
      text: clean(pages.join('\n')),
      pageCount: doc.numPages,
      emptyPages,
    };
  } finally {
    await doc.destroy();
  }
}

/**
 * Reconstruct lines from pdf.js text items.
 *
 * `hasEOL` does most of the work and is honoured first. The baseline check is
 * the backstop: in a two-column layout the item order can jump between columns
 * without an EOL flag, and without a break there the two columns' text runs
 * together into a line that matches no anchor.
 */
export function linesFromTextContent(items: readonly TextItem[]): string {
  let out = '';
  let lastBaseline: number | null = null;

  for (const item of items) {
    const baseline = item.transform[5] ?? 0;
    if (lastBaseline !== null && Math.abs(baseline - lastBaseline) > 1 && !out.endsWith('\n')) {
      out += '\n';
    }
    out += item.str;
    if (item.hasEOL) out += '\n';
    lastBaseline = baseline;
  }

  return out;
}
