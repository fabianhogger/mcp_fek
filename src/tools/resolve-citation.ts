import { z } from 'zod';
import { TTL } from '../cache.js';
import type { SearchHit } from '../domain/types.js';
import { parseCitation } from '../fek/citation.js';
import { fekId } from '../fek/ids.js';
import { joinSections, kv, oneLine, table } from '../format/render.js';
import { pdfUrl } from '../et/origins.js';
import { invalidInput, limitSchema, SCOPE } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * Turn a reference a person wrote into a document.
 *
 * This is the tool people will reach for most, because quoting a reference is
 * how Greek legal and administrative writing points at anything: «όπως
 * τροποποιήθηκε με το ΦΕΚ Β' 1234/2024».
 *
 * An issue reference needs no network at all — the id and the PDF path are
 * arithmetic on (series, number, year). One search call is still made, to
 * attach the page count and the row id that other tools need, but the answer
 * survives that call failing.
 */
export const resolveCitation: ToolDef = {
  name: 'resolve_citation',
  title: 'Resolve a ΦΕΚ citation',
  description:
    'Turn a written reference into the ΦΕΚ it points at. Understands the issue forms ' +
    "«ΦΕΚ Β' 1234/2024», «Β 1234/2024» and «ΦΕΚ ΔΕΥΤΕΡΟ 1234/2024», the law forms " +
    '«Ν. 5324/2026», «ΝΟΜΟΣ 5324/2026» and «Π.Δ. 47/2026», special series such as ' +
    '«Α.Σ.Ε.Π. 1/2026», and the 11-digit internal id «20260100121». ' +
    'Greek typed in Latin letters is handled, as are the several apostrophes used after ' +
    'a series letter. Returns how the reference was read, so you can check the ' +
    'interpretation, along with a direct PDF link. ' +
    'Use this rather than search_fek whenever you have a reference rather than a topic. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    citation: z
      .string()
      .describe('The reference as written, e.g. "ΦΕΚ Β\' 1234/2024" or "Ν. 5324/2026".'),
    limit: limitSchema(50, 5),
  },

  async handler(args, ctx) {
    const input = (args['citation'] as string | undefined)?.trim();
    if (!input) return invalidInput('citation is required.');
    const limit = (args['limit'] as number) ?? 5;

    const parsed = parseCitation(input);

    if (parsed.kind === 'unparsed') {
      return {
        text: parsed.reason,
        structured: { status: 'unparsed', citation: input, reason: parsed.reason },
        isError: true,
      };
    }

    if (parsed.kind === 'issue') {
      const { ref, series } = parsed;
      const id = fekId(ref);
      const url = pdfUrl(ctx.actions.origins, ref);

      // Attach the page count and row id, but never let this decide the
      // answer: the identity is already known from arithmetic.
      let hit: SearchHit | undefined;
      let lookupNote: string | null = null;
      try {
        const { value } = await ctx.cache.get(
          `simplesearch:citation:${id}`,
          { ttlMs: TTL.searchHistoric, staleIfError: true },
          () =>
            ctx.actions.simpleSearch({
              years: [ref.year],
              issueGroups: [ref.issueGroup],
              documentNumber: String(ref.number),
            }),
        );
        hit = value.hits.find((h) => h.fekId === id) ?? value.hits[0];
        if (!hit) {
          lookupNote =
            'The gazette search has no record of this issue, so it may not exist. ' +
            'The PDF link is still worth trying: it is derived from the reference itself.';
        }
      } catch (e) {
        lookupNote = `Could not confirm this issue against the gazette search (${(e as Error).message}). The PDF link is derived from the reference and should still work.`;
        ctx.logger.debug('citation confirmation failed', (e as Error).message);
      }

      return {
        text: joinSections([
          `${parsed.series.name} ${ref.number}/${ref.year}`,
          kv([
            ['read as', `Τεύχος ${series.name} (series ${series.id}), issue ${ref.number}, year ${ref.year}`],
            ['fek_id', id],
            ['pages', hit?.pages ?? null],
            ['published', hit?.publicationDate ?? null],
            ['signed', hit?.issueDate ?? null],
            ['pdf', url],
          ]),
          parsed.confidence === 'low' ? parsed.note ?? null : null,
          lookupNote,
          'Call get_fek with this fek_id for the table of contents and article text.',
        ]),
        structured: {
          status: hit ? 'ok' : 'unconfirmed',
          citation: input,
          parsed: {
            kind: 'issue',
            series: series.name,
            series_id: series.id,
            number: ref.number,
            year: ref.year,
            confidence: parsed.confidence,
            ...(parsed.note ? { note: parsed.note } : {}),
          },
          fek_id: id,
          search_id: hit?.searchId ?? null,
          pages: hit?.pages ?? null,
          publication_date: hit?.publicationDate ?? null,
          issue_date: hit?.issueDate ?? null,
          pdf_url: url,
        },
      };
    }

    // A law reference: the number is the law's own, not a φύλλο number, so it
    // has to be looked up. Without a year every era matches.
    const { lawType, number, year } = parsed;
    const hits = await lookupLaw(ctx, lawType.id, number, year);

    if (hits.length === 0) {
      return {
        text: joinSections([
          `No ${lawType.abbr} ${number}${year ? `/${year}` : ''} found in the gazette's legislation index.`,
          'Check the number, or try find_law with a title fragment instead.',
        ]),
        structured: { status: 'not_found', citation: input },
      };
    }

    const shown = hits.slice(0, limit);
    return {
      text: joinSections([
        `${lawType.abbr} ${number}${year ? `/${year}` : ''} — ${lawType.label}`,
        table(shown, [
          { header: 'published in', get: (h) => h.label },
          { header: 'date', get: (h) => h.publicationDate },
          { header: 'pages', get: (h) => h.pages, align: 'right' },
          { header: 'fek_id', get: (h) => h.fekId },
          { header: 'title', get: (h) => oneLine(h.description, 90) },
        ]),
        parsed.note ?? null,
        hits.length > 1 && year === undefined
          ? `${hits.length} acts share the number ${number} across different eras; the years above distinguish them.`
          : null,
        'Call get_fek with a fek_id for the table of contents and article text.',
      ]),
      structured: {
        status: 'ok',
        citation: input,
        parsed: {
          kind: 'law',
          law_type: lawType.abbr,
          law_type_id: lawType.id,
          number,
          year: year ?? null,
          confidence: parsed.confidence,
          ...(parsed.note ? { note: parsed.note } : {}),
        },
        total: hits.length,
        results: shown.map((h) => ({
          fek_id: h.fekId,
          search_id: h.searchId,
          label: h.label,
          series_id: h.issueGroup,
          year: h.year,
          pages: h.pages,
          publication_date: h.publicationDate,
          title: h.description,
          pdf_url: h.pdfUrl,
        })),
      },
    };
  },
};

export async function lookupLaw(
  ctx: ToolContext,
  lawTypeId: number,
  number: string,
  year: number | undefined,
): Promise<SearchHit[]> {
  const years = year === undefined ? [] : [year];
  const { value } = await ctx.cache.get(
    `searchlegislation:${lawTypeId}:${number}:${years.join(',')}`,
    { ttlMs: TTL.searchHistoric, staleIfError: true },
    () => ctx.actions.searchLegislation({ lawTypeId, number, years }),
  );
  // Newest first: when the number collides across eras the modern act is
  // almost always the one meant.
  return [...value].sort((a, b) => b.year - a.year);
}
