import type { Config } from '../config.js';
import { downloadPdf } from '../et/blob.js';
import type { EtClient } from '../et/client.js';
import { EtError } from '../et/errors.js';
import type { HttpFetch } from '../et/http.js';
import type { Logger } from '../logger.js';
import type { ParsedFek } from './doc.js';
import { extractText } from './extract.js';
import { TextStore } from './store.js';
import { parseText } from './structure.js';

/**
 * Download, extract, parse, remember.
 *
 * Where the four layers of the PDF side meet. Kept out of the tool so the tool
 * stays about presentation, and so the expensive part has exactly one entry
 * point to cache.
 */

export interface PipelineOptions {
  client: EtClient;
  config: Config;
  logger: Logger;
  fetchImpl?: HttpFetch | undefined;
}

export interface PdfResult {
  parsed: ParsedFek;
  /** True when served from the local store rather than re-extracted. */
  cached: boolean;
}

/**
 * What the tools actually need from the PDF side.
 *
 * Narrow on purpose. Downloading nine megabytes and running pdf.js is the one
 * part of this server that cannot be driven from a recorded fixture, so the
 * tools depend on this interface and the offline suite supplies an
 * implementation backed by the committed text snapshots. That keeps the
 * presentation logic — contents rendering, article selection, budgets, the
 * scanned-issue wording — under test everywhere, and confines the parts that
 * genuinely need the binaries to tests that skip without them.
 */
export interface PdfParser {
  readonly enabled: boolean;
  parse(fekId: string, url: string, issueGroup: number): Promise<PdfResult>;
}

/**
 * How many parsed issues to keep in memory.
 *
 * Small on purpose: one parsed law is ~450,000 characters plus its sections,
 * so this is megabytes per entry. Four covers the realistic pattern — a caller
 * reading several articles out of one or two issues — without growing a
 * long-lived server's footprint.
 */
const MEMORY_ENTRIES = 4;

export class PdfPipeline implements PdfParser {
  private readonly store: TextStore;
  private readonly inFlight = new Map<string, Promise<PdfResult>>();
  /**
   * An in-memory tier, independent of the disk store.
   *
   * Needed because the disk store can be switched off (FEK_PDF_CACHE_MB=0),
   * and without this a caller asking for article 2 after article 1
   * re-downloads and re-parses the entire nine-megabyte issue.
   */
  private readonly memory = new Map<string, ParsedFek>();

  constructor(private readonly opts: PipelineOptions) {
    this.store = new TextStore({
      dir: opts.config.cacheDir ?? defaultDir(),
      maxBytes: opts.config.pdfCacheMb * 1024 * 1024,
    });
  }

  get enabled(): boolean {
    return this.opts.config.pdfText;
  }

  /**
   * Parse an issue's PDF.
   *
   * Single-flighted on the document id: two tools asking for the same issue in
   * one session must not download nine megabytes twice.
   */
  async parse(fekId: string, url: string, issueGroup: number): Promise<PdfResult> {
    if (!this.enabled) {
      throw new EtError({
        kind: 'bad_request',
        action: 'pdf',
        detail: 'PDF text extraction is disabled (FEK_PDF_TEXT=0)',
      });
    }

    const key = `${fekId}:${issueGroup}`;
    const existing = this.inFlight.get(key);
    if (existing) return await existing;

    const inMemory = this.memory.get(key);
    if (inMemory) {
      // Refresh LRU position.
      this.memory.delete(key);
      this.memory.set(key, inMemory);
      return { parsed: inMemory, cached: true };
    }

    const task = (async (): Promise<PdfResult> => {
      const stored = await this.store.get<ParsedFek>(key);
      if (stored) {
        this.remember(key, stored);
        return { parsed: stored, cached: true };
      }

      // The blob gate serialises these: they are megabyte responses, and a
      // fan-out of them is the one thing that could make this server a
      // nuisance to the service it depends on.
      const bytes = await this.opts.client.blob(() =>
        downloadPdf({
          url,
          maxBytes: this.opts.config.pdfMaxBytes,
          timeoutMs: this.opts.config.pdfTimeoutMs,
          ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
        }),
      );

      const extracted = await extractText(bytes);
      const parsed = parseText(extracted.text, {
        pageCount: extracted.pageCount,
        issueGroup,
      });

      this.opts.logger.debug(
        `parsed ${fekId}`,
        `${extracted.pageCount} pages, ${extracted.text.length} chars, ` +
          `${parsed.toc.length} toc, ${parsed.sections.length} sections, ` +
          `${extracted.emptyPages} empty pages`,
      );

      this.remember(key, parsed);
      await this.store.set(key, parsed);
      return { parsed, cached: false };
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return await task;
  }

  private remember(key: string, parsed: ParsedFek): void {
    this.memory.delete(key);
    this.memory.set(key, parsed);
    while (this.memory.size > MEMORY_ENTRIES) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }
}

function defaultDir(): string {
  const xdg = process.env['XDG_CACHE_HOME'];
  return xdg && xdg.trim() !== '' ? `${xdg}/mcp-fek` : `${process.env['HOME'] ?? '/tmp'}/.cache/mcp-fek`;
}

/**
 * Did this PDF simply have no text in it?
 *
 * The distinction a caller needs: an issue from 1985 is a scanned image, and
 * its PDF genuinely contains zero characters. That is not a failure to
 * extract, it is an absence of text, and the two call for different wording.
 */
export function looksScanned(parsed: ParsedFek): boolean {
  return parsed.fullText.trim().length < 200;
}
