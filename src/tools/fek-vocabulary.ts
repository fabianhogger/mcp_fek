import { z } from 'zod';
import { TTL } from '../cache.js';
import type { VocabularyItem } from '../domain/types.js';
import { LAW_TYPES } from '../fek/lawtypes.js';
import { allSeries, series as seriesById, type Series } from '../fek/series.js';
import { yearRange } from '../fek/years.js';
import { joinSections, showing, table } from '../format/render.js';
import { search } from '../text/match.js';
import { invalidInput, limitSchema, SCOPE } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * What the other tools' filter arguments will accept.
 *
 * The ids here are not decoration: `series` ids go into a search's
 * `selectIssue`, and `law_types` ids into `/searchlegislation`'s
 * `legislationCatalogues`. A model that guesses them gets zero results with no
 * explanation, so there has to be a way to look them up.
 *
 * `series`, `law_types` and `years` need no network at all. `years` is
 * computed rather than fetched because the upstream /years endpoint answers
 * 400 in every form and the site generates its own dropdown client-side;
 * `kind: "series"` with a year crosses the static table with the API's record
 * of which series actually published that year, which is the useful case.
 */
const KINDS = ['series', 'law_types', 'years', 'categories'] as const;

export const fekVocabulary: ToolDef = {
  name: 'fek_vocabulary',
  title: 'List ΦΕΚ filter vocabulary',
  description:
    'Look up the controlled vocabulary the other ΦΕΚ tools filter by. ' +
    'Use kind="series" for the issue series (τεύχος) — their ids, printed names ' +
    'and the years each one actually published, which is how you learn that ' +
    'Τεύχος Γ starts in 1984 or that Ν.Π.Δ.Δ. stopped in 2006. ' +
    'Use kind="law_types" for the act types accepted when resolving a law number ' +
    '(Νόμος, Προεδρικό Διάταγμα, Πράξη Νομοθετικού Περιεχομένου and the historic ones). ' +
    'Use kind="categories" for the subject vocabulary, and kind="years" for the ' +
    'publication years. Pass a year with kind="series" to see which series actually ' +
    'published that year rather than which exist in principle. ' +
    'Call this before guessing an id. ' +
    SCOPE,
  inputSchema: {
    kind: z.enum(KINDS).describe('Which vocabulary to list.'),
    query: z
      .string()
      .optional()
      .describe('Narrow the list by name, in Greek or Latin letters. Applies to categories.'),
    year: z
      .number()
      .int()
      .optional()
      .describe(
        'Resolve names as of this year. Matters for series 11, which was ΑΕ-ΕΠΕ ' +
          'before 2015 and ΠΡΑ.Δ.Ι.Τ. from 2015.',
      ),
    limit: limitSchema(100, 50),
  },

  async handler(args, ctx) {
    const kind = args['kind'] as (typeof KINDS)[number] | undefined;
    const year = args['year'] as number | undefined;
    const query = (args['query'] as string | undefined)?.trim() || undefined;
    const limit = (args['limit'] as number) ?? 50;

    if (!kind) return invalidInput(`kind is required; one of ${KINDS.join(', ')}.`);

    if (kind === 'years') {
      const all = yearRange(ctx.now());
      const shown = all.slice(0, limit);
      return {
        text: joinSections([
          `Publication years, ${all[all.length - 1]} to ${all[0]}`,
          shown.join(', '),
          showing(shown.length, all.length),
          'Not every series published in every year; pass a year to kind="series" to see which did.',
        ]),
        structured: { status: 'ok', kind, total: all.length, years: shown },
      };
    }

    if (kind === 'categories') {
      const { value } = await ctx.cache.get(
        'categories',
        { ttlMs: TTL.vocabulary, staleIfError: true },
        () => ctx.actions.categories(),
      );
      const matched = query ? filterByName(value, query) : value;
      const shown = matched.slice(0, limit);
      return {
        text: joinSections([
          query ? `Subject categories matching ${JSON.stringify(query)}` : 'Subject categories',
          table(shown, [
            { header: 'id', get: (c: VocabularyItem) => c.id, align: 'right' },
            { header: 'category', get: (c: VocabularyItem) => c.value },
          ]),
          showing(shown.length, matched.length),
          matched.length === 0 && query
            ? `Nothing matched ${JSON.stringify(query)}. Call again without a query for the full list.`
            : null,
        ]),
        structured: {
          status: matched.length === 0 ? 'not_found' : 'ok',
          kind,
          total: matched.length,
          categories: shown.map((c) => ({ id: c.id, value: c.value })),
        },
      };
    }

    if (kind === 'series') {
      const all = year === undefined ? allSeries(year) : await seriesForYear(ctx, year);
      const shown = all.slice(0, limit);
      return {
        text: joinSections([
          year ? `ΦΕΚ issue series that published in ${year}` : 'ΦΕΚ issue series (τεύχη)',
          table(shown, [
            { header: 'id', get: (s) => s.id, align: 'right' },
            { header: 'series', get: (s) => s.name },
            { header: 'from', get: (s) => s.from, align: 'right' },
            { header: 'until', get: (s) => s.to ?? 'current' },
          ]),
          showing(shown.length, all.length),
          'Pass either the id or the name as the `series` argument of the search tools.',
        ]),
        structured: {
          status: 'ok',
          kind,
          total: all.length,
          series: shown.map((s) => ({
            id: s.id,
            name: s.name,
            from_year: s.from,
            to_year: s.to,
          })),
        },
      };
    }

    const shown = LAW_TYPES.slice(0, limit);
    return {
      text: joinSections([
        'Types of legislative act',
        table(shown, [
          { header: 'id', get: (t) => t.id, align: 'right' },
          { header: 'abbr', get: (t) => t.abbr },
          { header: 'name', get: (t) => t.label },
        ]),
        showing(shown.length, LAW_TYPES.length),
        'Pass the id or the abbreviation as the `law_type` argument of find_law.',
      ]),
      structured: {
        status: 'ok',
        kind,
        total: LAW_TYPES.length,
        law_types: shown.map((t) => ({ id: t.id, abbr: t.abbr, label: t.label })),
      },
    };
  },
};

/**
 * Which series actually published in a year.
 *
 * The static table says a series exists; this says it was used. The two differ
 * often enough to matter — Τεύχος Δ exists since 1959 but publishes rarely.
 */
async function seriesForYear(ctx: ToolContext, year: number): Promise<Series[]> {
  const { value } = await ctx.cache.get(
    `issuegroupidsbyyear:${year}`,
    { ttlMs: TTL.issueGroupsPastYear, staleIfError: true },
    () => ctx.actions.issueGroupIdsByYear(year),
  );
  const found = value.map((id) => seriesById(id, year)).filter((s): s is Series => s !== undefined);
  // Fall back to the static table rather than returning nothing if the year is
  // one the API has no record for.
  return found.length > 0 ? found : [...allSeries(year)];
}

/** Fuzzy match on a Greek label, so "ygeia" finds «ΥΓΕΙΑ». */
function filterByName(items: readonly VocabularyItem[], query: string): VocabularyItem[] {
  const result = search(
    query,
    items.map((item) => ({ names: [item.value], id: item.id, item })),
    { limit: 100 },
  );
  return result.candidates.map((c) => c.item.item);
}
