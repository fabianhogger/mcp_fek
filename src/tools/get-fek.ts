import { z } from 'zod';
import { TTL } from '../cache.js';
import type { DocumentEntity } from '../domain/types.js';
import { EXTRACT_CAVEAT } from '../et/snippets.js';
import { joinSections, kv, table } from '../format/render.js';
import { TEXT_INDEX_FROM } from '../fek/limits.js';
import { lawName, renderToc, sectionText, type ParsedFek, type Section } from '../pdf/doc.js';
import { looksScanned } from '../pdf/pipeline.js';
import { identify, type Identified } from './identify.js';
import { loadEntity } from './fek-subjects.js';
import { invalidInput, SCOPE } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * One issue, in as much detail as is actually available.
 *
 * Availability varies enormously across the archive, and the tool's job is to
 * be honest about which case the caller is in rather than returning less and
 * saying nothing:
 *
 *  - a born-digital issue has extractable text, a table of contents and
 *    per-article addressing;
 *  - an older issue is a scanned image whose PDF holds no text at all (the
 *    1985 Α' 100 extracts to literally zero characters), so the metadata and
 *    the link are the whole answer;
 *  - and in between, the search index may hold an extract even when the PDF
 *    does not.
 *
 * `text_source` says which of those happened, so a model never reports an
 * absence of text as an absence of law.
 */
export const getFek: ToolDef = {
  name: 'get_fek',
  title: 'Get a ΦΕΚ issue',
  description:
    'Retrieve one ΦΕΚ issue: its metadata, subject topics, a direct PDF link and — for ' +
    'born-digital issues — its table of contents and the text of individual articles. ' +
    'Identify the issue by fek_id, by a written citation, by series plus number plus year, ' +
    'or by the search_id from an earlier result. ' +
    'Issues from roughly before the 2000s are scanned images with no extractable text; ' +
    'for those the metadata and the PDF link are the complete answer, and text_source ' +
    'reports which case you are in rather than failing. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    fek_id: z.string().optional().describe('The 11-digit id, e.g. "20260100121".'),
    search_id: z.string().optional().describe('The internal search row id, if you have one.'),
    citation: z.string().optional().describe('A written reference, e.g. "ΦΕΚ Β\' 6047/2026".'),
    series: z.string().optional().describe('Issue series, used with number and year.'),
    number: z.number().int().optional().describe('The φύλλο number, used with series and year.'),
    year: z.number().int().optional().describe('The year, used with series and number.'),
    include_text: z
      .enum(['auto', 'none', 'full'])
      .optional()
      .describe(
        'Whether to extract text from the PDF: "auto" (default) extracts when the issue is ' +
          'born-digital, "none" returns metadata only, "full" returns the whole text.',
      ),
    articles: z
      .array(z.number().int())
      .optional()
      .describe('Return only these article numbers (Άρθρο N), instead of the whole text.'),
    max_chars: z
      .number()
      .int()
      .min(500)
      .max(200_000)
      .optional()
      .describe('Cap on returned text (default 8000). A single law can exceed 450,000 characters.'),
    toc_limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('How many table-of-contents entries to show (default 60).'),
  },

  async handler(args, ctx) {
    const identified = await identify(args, ctx);
    if (identified.kind === 'invalid') return invalidInput(identified.message);

    const mode = (args['include_text'] as 'auto' | 'none' | 'full' | undefined) ?? 'auto';
    const articles = (args['articles'] as number[] | undefined) ?? [];
    const maxChars = (args['max_chars'] as number) ?? 8000;

    const entity = await loadEntity(ctx, identified);
    const text = mode === 'none' ? noText('not_requested') : await loadText(ctx, identified, mode);

    const parsed = text.parsed;
    const label = entity?.label ?? identified.label;
    const name = parsed ? lawName(parsed, label) : label;

    const body =
      parsed && articles.length >= 0
        ? sectionText(parsed.sections, {
            numbers: articles,
            maxChars,
            label: (s: Section) => sectionLabel(identified.ref.issueGroup, s),
          })
        : null;

    return {
      text: joinSections([
        heading(name, parsed, entity),
        kv([
          ['fek_id', identified.fekId],
          ['series', entity ? `${entity.seriesName} (${entity.issueGroup})` : null],
          ['number', identified.ref.number],
          ['year', identified.ref.year],
          ['published', entity?.publicationDate ?? null],
          ['signed', entity?.issueDate ?? null],
          ['pages', entity?.pages ?? parsed?.pageCount ?? null],
          ['protocol no.', entity?.protocolNumber ?? null],
          ['re-released', entity?.reReleaseDate ?? null],
          ['pdf', identified.pdfUrl],
        ]),
        entity && entity.topics.length > 0
          ? table(entity.topics, [
              { header: 'topic_id', get: (t) => t.id },
              { header: 'topic', get: (t) => t.name },
            ])
          : null,
        parsed && parsed.toc.length > 0
          ? joinSections([
              contentsHeading(identified.ref.issueGroup, parsed),
              renderToc(parsed.toc, (args['toc_limit'] as number) ?? 60),
            ])
          : null,
        body && body.text !== '' ? `---\n${body.text}` : null,
        body?.truncated === true
          ? `Text was cut at ${maxChars} characters. Ask for specific articles, or raise max_chars.`
          : null,
        articles.length === 0 && parsed && parsed.sections.length > 1 && body?.truncated === true
          ? `This issue has ${parsed.sections.length} ${unitName(identified.ref.issueGroup)}; ` +
            'pass `articles` to fetch particular ones.'
          : null,
        parsed && parsed.droppedUnreadable > 0
          ? `${parsed.droppedUnreadable} part(s) of this issue use a font encoding with no ` +
            'character map and could not be read at all. They are omitted rather than ' +
            'guessed at; the PDF renders them correctly.'
          : null,
        identified.note,
        text.note,
        entity === null
          ? 'No metadata is recorded against this issue in the gazette index, which is common ' +
            'for older issues. The PDF link above is derived from the reference itself and is ' +
            'worth trying regardless.'
          : null,
      ]),
      structured: {
        status: 'ok',
        fek_id: identified.fekId,
        search_id: identified.searchId,
        label,
        law_name: parsed && parsed.lawType !== '' ? name : null,
        law_type: parsed?.lawType || null,
        law_number: parsed?.lawNumber || null,
        law_title: parsed?.lawTitle || null,
        series: entity?.seriesName ?? null,
        series_id: identified.ref.issueGroup,
        number: identified.ref.number,
        year: identified.ref.year,
        pages: entity?.pages ?? parsed?.pageCount ?? null,
        issue_date: entity?.issueDate ?? null,
        publication_date: entity?.publicationDate ?? null,
        protocol_number: entity?.protocolNumber ?? null,
        re_release_date: entity?.reReleaseDate ?? null,
        topics: entity ? entity.topics.map((t) => ({ id: t.id, name: t.name })) : [],
        text_source: text.source,
        contents: parsed
          ? parsed.toc.map((e) => ({
              number: e.number,
              title: e.title,
              part: e.part || null,
              chapter: e.chapter || null,
            }))
          : [],
        text: body?.text || null,
        text_truncated: body?.truncated ?? false,
        articles_included: body?.included ?? [],
        unreadable_parts: parsed?.droppedUnreadable ?? 0,
        pdf_url: identified.pdfUrl,
      },
    };
  },
};

/** What a numbered unit is called, which differs between Α and Β issues. */
function unitName(issueGroup: number): string {
  return issueGroup === 2 ? 'separate acts' : 'articles';
}

function sectionLabel(issueGroup: number, section: Section): string {
  return issueGroup === 2
    ? `(${section.number}) ${section.title}`
    : `Άρθρο ${section.number} ${section.title}`;
}

function contentsHeading(issueGroup: number, parsed: ParsedFek): string {
  return issueGroup === 2
    ? `Acts in this issue (${parsed.toc.length}):`
    : `Contents (${parsed.toc.length} articles):`;
}

function heading(name: string, parsed: ParsedFek | null, entity: DocumentEntity | null): string {
  if (parsed?.lawTitle) return `${name} — ${parsed.lawTitle}`;
  const topics = entity?.topics.map((t) => t.name).join('; ');
  return topics ? `${name} — ${topics}` : name;
}

type TextSource = 'pdf' | 'api_snippet' | 'none' | 'not_requested';

interface LoadedText {
  source: TextSource;
  parsed: ParsedFek | null;
  note: string | null;
}

function noText(source: TextSource, note: string | null = null): LoadedText {
  return { source, parsed: null, note };
}

/**
 * Get the issue's text, and be honest about which of several things happened.
 *
 * The cases are genuinely different and a caller needs to tell them apart:
 * born-digital text extracted fine; the PDF is a scanned image and contains no
 * text at all; extraction is switched off; or the download failed. Only the
 * last is a fault, and none of them should lose the PDF link.
 */
async function loadText(
  ctx: ToolContext,
  identified: Identified & { kind: 'ok' },
  mode: 'auto' | 'full',
): Promise<LoadedText> {
  if (!ctx.pdf.enabled) {
    return noText(
      'none',
      'Text extraction is disabled on this server (FEK_PDF_TEXT=0); use the PDF link.',
    );
  }

  try {
    const { parsed } = await ctx.pdf.parse(
      identified.fekId,
      identified.pdfUrl,
      identified.ref.issueGroup,
    );

    if (looksScanned(parsed)) {
      // Not a failure. Issues from before roughly the 2000s are scanned
      // images: the PDF holds no text layer, so there is nothing to extract
      // and no library or setting changes that.
      return {
        source: 'none',
        parsed: null,
        note: await scannedNote(ctx, identified),
      };
    }

    return { source: 'pdf', parsed, note: null };
  } catch (e) {
    ctx.logger.debug(`pdf pipeline failed for ${identified.fekId}`, (e as Error).message);
    return noText(
      'none',
      `The PDF could not be read (${(e as Error).message}). The link above still works.`,
    );
  }
}

/**
 * For a scan, fall back to the search index's own extract.
 *
 * The index holds text for issues whose PDFs do not, going back to at least
 * 1998, so this is the difference between "here is roughly what it says" and
 * nothing at all — without any OCR.
 */
async function scannedNote(
  ctx: ToolContext,
  identified: Identified & { kind: 'ok' },
): Promise<string> {
  const base =
    `This issue is a scanned image: its PDF has no text layer, so nothing can be ` +
    `extracted from it. Open the PDF link to read it.`;

  if (identified.ref.year < TEXT_INDEX_FROM) return base;

  try {
    const { value } = await ctx.cache.get(
      `simplesearch:citation:${identified.fekId}`,
      { ttlMs: TTL.searchHistoric, staleIfError: true },
      () =>
        ctx.actions.simpleSearch({
          years: [identified.ref.year],
          issueGroups: [identified.ref.issueGroup],
          documentNumber: String(identified.ref.number),
        }),
    );
    const extract = value.hits.find((h) => h.extract !== null)?.extract;
    if (!extract) return base;
    return `${base}\n\nThe gazette's search index does hold an extract of it:\n\n${extract}\n\n${EXTRACT_CAVEAT}`;
  } catch {
    return base;
  }
}
