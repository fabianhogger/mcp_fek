import { z } from 'zod';
import { TTL } from '../cache.js';
import { joinSections, oneLine, showing, table } from '../format/render.js';
import { invalidInput, limitSchema, SCOPE, yearSchema } from './shared.js';
import type { ToolDef } from './types.js';

/**
 * ΑΣΕΠ announcements (Τεύχος Α.Σ.Ε.Π.).
 *
 * Worth its own tool rather than a filter on search_fek for two reasons: this
 * is the series people search by number far more often than by topic
 * ("προκήρυξη 1/2026"), and it is one of only two endpoints anywhere in this
 * API that returns a title.
 */
export const searchAsep: ToolDef = {
  name: 'search_asep',
  title: 'Search ΑΣΕΠ announcements',
  description:
    'Search Τεύχος Α.Σ.Ε.Π. of the ΦΕΚ — the public-sector recruitment announcements ' +
    '(προκηρύξεις) published by the Ανώτατο Συμβούλιο Επιλογής Προσωπικού. ' +
    'Search by year and announcement number, which is how these are cited ' +
    '("προκήρυξη 1/2026"), or pass a keyword to search their text instead. ' +
    'Unlike most of the gazette index, these results carry the announcement\'s title. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    year: yearSchema.describe('Year of the announcement.'),
    document_number: z
      .string()
      .optional()
      .describe('The announcement number within the year, e.g. "1".'),
    query: z
      .string()
      .optional()
      .describe('Free-text query, used instead of a number to search the announcements.'),
    limit: limitSchema(100, 20),
  },

  async handler(args, ctx) {
    const year = args['year'] as number | undefined;
    const documentNumber = (args['document_number'] as string | undefined)?.trim() || undefined;
    const query = (args['query'] as string | undefined)?.trim() || undefined;
    const limit = (args['limit'] as number) ?? 20;

    if (year === undefined) {
      return invalidInput('year is required: ΑΣΕΠ announcements are numbered within a year.');
    }

    // The keyword path has to go through the general search, because
    // /searchasep takes only a year and a number.
    const hits = query
      ? (
          await ctx.cache.get(
            `simplesearch:asep:${year}:${query}`,
            { ttlMs: TTL.searchHistoric, staleIfError: true },
            () => ctx.actions.simpleSearch({ years: [year], issueGroups: [10], searchText: query }),
          )
        ).value.hits
      : (
          await ctx.cache.get(
            `searchasep:${year}:${documentNumber ?? ''}`,
            { ttlMs: TTL.searchHistoric, staleIfError: true },
            () => ctx.actions.searchAsep({ year, documentNumber }),
          )
        ).value;

    const shown = hits.slice(0, limit);

    if (hits.length === 0) {
      return {
        text: joinSections([
          `No ΑΣΕΠ announcement found for ${year}${documentNumber ? ` number ${documentNumber}` : ''}${
            query ? ` matching ${JSON.stringify(query)}` : ''
          }.`,
          'ΑΣΕΠ publishes only a handful of issues a year, so a high number is unlikely to exist.',
        ]),
        structured: { status: 'empty', year, total: 0 },
      };
    }

    return {
      text: joinSections([
        `ΑΣΕΠ announcements, ${year} (${hits.length})`,
        table(shown, [
          { header: 'issue', get: (h) => h.label },
          { header: 'published', get: (h) => h.publicationDate },
          { header: 'pages', get: (h) => h.pages, align: 'right' },
          { header: 'fek_id', get: (h) => h.fekId },
          { header: 'title', get: (h) => oneLine(h.description ?? h.extract, 110) },
        ]),
        showing(shown.length, hits.length),
        'Call get_fek with a fek_id for the full announcement text.',
      ]),
      structured: {
        status: 'ok',
        year,
        total: hits.length,
        results: shown.map((h) => ({
          fek_id: h.fekId,
          search_id: h.searchId,
          label: h.label,
          series: h.seriesName,
          series_id: h.issueGroup,
          number: h.number,
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
