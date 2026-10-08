import { z } from 'zod';
import { TTL } from '../cache.js';
import type { SearchHit } from '../domain/types.js';
import { toApiRange } from '../et/dates.js';
import { EXTRACT_CAVEAT } from '../et/snippets.js';
import { capNote, MIN_QUERY_LEN, textIndexWarning } from '../fek/limits.js';
import { resolveSeries } from '../fek/series.js';
import { joinSections, oneLine, showing, table } from '../format/render.js';
import { invalidInput, isoDateSchema, limitSchema, SCOPE, seriesSchema } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * The main search.
 *
 * Three things about the upstream shape this tool around.
 *
 * It is genuinely full text over the body of the acts — not a title index —
 * and it returns a window of the matching text. But it returns whole *issues*:
 * a Τεύχος Β issue carries a dozen unrelated acts, so a hit says which issue
 * matched and not which act. Saying so, and pointing at get_fek, is the
 * difference between a useful answer and a confidently wrong one.
 *
 * The index does not reach before 1992, so a text query restricted to earlier
 * years returns nothing at all — which looks identical to "no such law".
 *
 * And a result set is silently capped. The site shows a banner; we have to say
 * it in words, or a model reasons as though it saw everything.
 */
export const searchFek: ToolDef = {
  name: 'search_fek',
  title: 'Search ΦΕΚ issues',
  description:
    'Search the Greek Government Gazette (ΦΕΚ) by keyword, issue number, series, year ' +
    'or date range. The keyword search is full text over the body of the published acts, ' +
    'and each hit comes back with a window of the matching text. ' +
    'Results are whole issues, not individual acts: one Τεύχος Β issue contains many ' +
    'unrelated ministerial decisions, so follow a promising hit with get_fek to see which ' +
    'act inside it actually matched. ' +
    'The full-text index does not cover years before 1992, so combine a keyword with ' +
    'earlier years only if you expect nothing. At least one argument is required. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    query: z
      .string()
      .optional()
      .describe(
        `Free-text query, at least ${MIN_QUERY_LEN} characters, in Greek or Latin letters. ` +
          'Matched against the body text of the acts, stemmed and accent-insensitively.',
      ),
    series: z
      .array(seriesSchema)
      .optional()
      .describe('Restrict to these issue series. Omit for all series.'),
    year: z.array(z.number().int()).optional().describe('Restrict to these years.'),
    document_number: z
      .string()
      .optional()
      .describe('The φύλλο number within a series and year, e.g. "121" for Α 121/2026.'),
    published_from: isoDateSchema.optional().describe('Earliest publication date.'),
    published_to: isoDateSchema.optional().describe('Latest publication date.'),
    released_from: isoDateSchema.optional().describe('Earliest date the act was signed.'),
    released_to: isoDateSchema.optional().describe('Latest date the act was signed.'),
    include_extracts: z
      .boolean()
      .optional()
      .describe('Include the matching text window for each hit (default true).'),
    limit: limitSchema(100, 20),
  },

  async handler(args, ctx) {
    const query = (args['query'] as string | undefined)?.trim() || undefined;
    const documentNumber = (args['document_number'] as string | undefined)?.trim() || undefined;
    const years = (args['year'] as number[] | undefined) ?? [];
    const limit = (args['limit'] as number) ?? 20;
    const includeExtracts = (args['include_extracts'] as boolean | undefined) ?? true;

    if (query !== undefined && query.length < MIN_QUERY_LEN) {
      return invalidInput(
        `The gazette search needs at least ${MIN_QUERY_LEN} characters; ${JSON.stringify(query)} is too short.`,
      );
    }

    const issueGroups: number[] = [];
    for (const raw of (args['series'] as string[] | undefined) ?? []) {
      const resolved = resolveSeries(raw);
      if (resolved.decision === 'none') {
        return invalidInput(
          `Unknown issue series ${JSON.stringify(raw)}. Call fek_vocabulary with kind="series" for the list.`,
        );
      }
      if (resolved.decision === 'ambiguous') {
        return invalidInput(
          `${JSON.stringify(raw)} matches several series: ${resolved.candidates
            .map((c) => `${c.name} (id ${c.id})`)
            .join(', ')}. Pass the id instead.`,
        );
      }
      issueGroups.push(resolved.series.id);
    }

    const publishedRange = toApiRange(
      args['published_from'] as string | undefined,
      args['published_to'] as string | undefined,
    );
    const releasedRange = toApiRange(
      args['released_from'] as string | undefined,
      args['released_to'] as string | undefined,
    );

    const criteria =
      query !== undefined ||
      documentNumber !== undefined ||
      issueGroups.length > 0 ||
      years.length > 0 ||
      publishedRange !== '' ||
      releasedRange !== '';
    if (!criteria) {
      // Mirrors the site's own rule. Worth enforcing locally: upstream answers
      // an unconstrained search not with an error but with a very slow,
      // very large result set.
      return invalidInput(
        'A search needs at least one of: query, document_number, series, year, ' +
          'published_from/published_to or released_from/released_to.',
      );
    }

    const input = {
      ...(years.length > 0 ? { years } : {}),
      ...(issueGroups.length > 0 ? { issueGroups } : {}),
      ...(documentNumber !== undefined ? { documentNumber } : {}),
      ...(query !== undefined ? { searchText: query } : {}),
      ...(publishedRange !== '' ? { publishedRange } : {}),
      ...(releasedRange !== '' ? { releasedRange } : {}),
    };

    const touchesToday = publishedRange === '' || publishedRange.includes(new Date(ctx.now()).toISOString().slice(0, 10));
    const { value } = await ctx.cache.get(
      `simplesearch:${JSON.stringify(input)}`,
      {
        ttlMs: touchesToday ? TTL.searchRecent : TTL.searchHistoric,
        staleIfError: !touchesToday,
      },
      () => ctx.actions.simpleSearch(input),
    );

    const { hits, stemmedQuery } = value;
    const shown = hits.slice(0, limit);

    return {
      text: joinSections([
        headline(query, hits.length),
        renderHits(shown, includeExtracts),
        showing(shown.length, hits.length),
        stemmedNote(query, stemmedQuery),
        hits.length === 0 ? emptyExplanation(query, years) : null,
        textIndexWarning(query !== undefined, years, publishedRange),
        capNote(hits.length, query !== undefined),
        includeExtracts && shown.some((h) => h.extract) ? EXTRACT_CAVEAT : null,
        hits.length > 0
          ? 'Each row is a whole gazette issue. A Τεύχος Β issue holds many separate acts, ' +
            'so call get_fek with the fek_id to see which act inside it matched.'
          : null,
      ]),
      structured: {
        status: hits.length === 0 ? 'empty' : 'ok',
        total: hits.length,
        // Not a relevance score: upstream's search_Score is an ordinal, so it
        // is deliberately absent rather than exposed as ranking.
        stemmed_query: stemmedQuery,
        capped: capNote(hits.length, query !== undefined) !== null,
        results: shown.map((h) => ({
          fek_id: h.fekId,
          search_id: h.searchId,
          label: h.label,
          series: h.seriesName,
          series_id: h.issueGroup,
          number: h.number,
          year: h.year,
          pages: h.pages,
          issue_date: h.issueDate,
          publication_date: h.publicationDate,
          description: h.description,
          ...(includeExtracts ? { extract: h.extract, matched_terms: h.matchedTerms } : {}),
          pdf_url: h.pdfUrl,
        })),
      },
    };
  },
};

function headline(query: string | undefined, total: number): string {
  return query ? `ΦΕΚ issues matching ${JSON.stringify(query)} (${total})` : `ΦΕΚ issues (${total})`;
}

export function renderHits(hits: readonly SearchHit[], includeExtracts: boolean): string {
  return table(hits, [
    { header: 'issue', get: (h) => h.label },
    { header: 'published', get: (h) => h.publicationDate },
    { header: 'pages', get: (h) => h.pages, align: 'right' },
    { header: 'fek_id', get: (h) => h.fekId },
    ...(includeExtracts
      ? [
          {
            header: 'matched text',
            get: (h: SearchHit) => oneLine(h.description ?? h.extract, 110),
          },
        ]
      : []),
  ]);
}

/**
 * Report the stem the index actually searched.
 *
 * Without it a model cannot explain its own results: searching «τηλεργασία»
 * really searches `τηλεργασ`, so hits legitimately contain «τηλεργασίας» and
 * occasionally look unrelated.
 */
function stemmedNote(query: string | undefined, stemmed: string | null): string | null {
  if (!query || !stemmed) return null;
  const q = query.toLowerCase();
  if (stemmed.toLowerCase() === q) return null;
  return `The index searched the stem "${stemmed}", so hits may show other inflections of ${JSON.stringify(query)}.`;
}

function emptyExplanation(query: string | undefined, years: readonly number[]): string {
  if (!query) return 'No issues match those filters.';
  return (
    `Nothing matched ${JSON.stringify(query)}` +
    (years.length > 0 ? ` in ${years.join(', ')}` : '') +
    '. Try a single distinctive word rather than a phrase, drop the year filter, ' +
    'or use find_law if you are after a law by number.'
  );
}
