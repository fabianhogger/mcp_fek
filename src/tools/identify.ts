import { TTL } from '../cache.js';
import type { DocumentEntity } from '../domain/types.js';
import { pdfUrl } from '../et/origins.js';
import { parseCitation } from '../fek/citation.js';
import { fekId, formatLabel, parseFekId, type FekRef } from '../fek/ids.js';
import { checkSeriesYear, resolveSeries } from '../fek/series.js';
import type { ToolContext } from './types.js';

/**
 * "Which issue do you mean?", answered once for every tool that needs it.
 *
 * There are four ways to name a ΦΕΚ and a model will use whichever it has:
 * the 11-digit id, a written citation, series plus number plus year, or the
 * internal search row id it got from an earlier result. All four have to work,
 * and three of them resolve to a PDF URL with no network call at all.
 *
 * The internal id is the odd one out: it carries no structure, so it has to be
 * looked up before anything else can be said about it.
 */

export type Identified =
  | {
      kind: 'ok';
      ref: FekRef;
      fekId: string;
      label: string;
      pdfUrl: string;
      /** Null when not yet known; needed for the metadata endpoint. */
      searchId: string | null;
      /**
       * The metadata, when resolving already had to fetch it.
       *
       * `undefined` means "not looked up yet", which is different from `null`
       * meaning "looked up and absent". Callers must not re-fetch on
       * `undefined` without checking `searchId` first.
       */
      entity: DocumentEntity | null | undefined;
      /** A caveat about how the input was read, when there is one. */
      note: string | null;
    }
  | { kind: 'invalid'; message: string };

export async function identify(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<Identified> {
  const fekIdArg = (args['fek_id'] as string | undefined)?.trim();
  const searchIdArg = (args['search_id'] as string | undefined)?.trim();
  const citation = (args['citation'] as string | undefined)?.trim();
  const seriesArg = (args['series'] as string | undefined)?.trim();
  const numberArg = args['number'] as number | undefined;
  const yearArg = args['year'] as number | undefined;

  if (fekIdArg) {
    const ref = parseFekId(fekIdArg);
    if (!ref) {
      return {
        kind: 'invalid',
        message:
          `${JSON.stringify(fekIdArg)} is not a ΦΕΚ id. The format is 11 digits: ` +
          'four for the year, two for the series, five for the issue number, e.g. "20260100121".',
      };
    }
    return await withSearchId(ctx, ref, null);
  }

  if (citation) {
    const parsed = parseCitation(citation);
    if (parsed.kind === 'unparsed') return { kind: 'invalid', message: parsed.reason };
    if (parsed.kind === 'law') {
      return {
        kind: 'invalid',
        message:
          `${JSON.stringify(citation)} is a reference to an act, not to a gazette issue, and ` +
          'an act number does not identify the issue it was published in. Call find_law or ' +
          'resolve_citation first, then pass the fek_id it returns.',
      };
    }
    return await withSearchId(
      ctx,
      parsed.ref,
      parsed.confidence === 'low' ? parsed.note ?? null : null,
    );
  }

  if (seriesArg !== undefined && numberArg !== undefined && yearArg !== undefined) {
    const resolved = resolveSeries(seriesArg, yearArg);
    if (resolved.decision === 'none') {
      return {
        kind: 'invalid',
        message:
          `Unknown issue series ${JSON.stringify(seriesArg)}. Call fek_vocabulary with ` +
          'kind="series" for the list.',
      };
    }
    if (resolved.decision === 'ambiguous') {
      return {
        kind: 'invalid',
        message: `${JSON.stringify(seriesArg)} matches several series: ${resolved.candidates
          .map((c) => `${c.name} (id ${c.id})`)
          .join(', ')}. Pass the id instead.`,
      };
    }
    const check = checkSeriesYear(resolved.series.id, yearArg);
    if (!check.ok) return { kind: 'invalid', message: check.reason! };
    return await withSearchId(ctx, { year: yearArg, issueGroup: resolved.series.id, number: numberArg }, null);
  }

  if (searchIdArg) {
    // No structure to work from, so this is the one path that must hit the
    // network before it can say anything at all.
    const entity = await ctx.cache.get(
      `documententity:${searchIdArg}`,
      { ttlMs: TTL.documentEntity, staleIfError: true },
      () => ctx.actions.documentEntityById(searchIdArg),
    );
    const found = entity.value;
    if (!found) {
      return {
        kind: 'invalid',
        message:
          `The gazette has no document with internal id ${JSON.stringify(searchIdArg)}. ` +
          'These ids come from search results; prefer a fek_id or a citation.',
      };
    }
    return {
      kind: 'ok',
      ref: { year: found.year, issueGroup: found.issueGroup, number: found.number },
      fekId: found.fekId,
      label: found.label,
      pdfUrl: found.pdfUrl,
      // The entity's own rows omit the id it was fetched by, so carry the
      // caller's across rather than reading it back off the response.
      searchId: searchIdArg,
      entity: found,
      note: null,
    };
  }

  return {
    kind: 'invalid',
    message:
      'Identify the issue with one of: fek_id ("20260100121"), citation ("ΦΕΚ Β\' 6047/2026"), ' +
      'series plus number plus year, or search_id from an earlier result.',
  };
}

/**
 * Attach the internal row id, which the metadata endpoint needs.
 *
 * Deliberately best-effort: the identity, the label and the PDF link are all
 * arithmetic, so a failure here must downgrade the answer rather than lose it.
 */
async function withSearchId(
  ctx: ToolContext,
  ref: FekRef,
  note: string | null,
): Promise<Identified> {
  const id = fekId(ref);
  const base = {
    kind: 'ok' as const,
    ref,
    fekId: id,
    label: formatLabel(ref),
    pdfUrl: pdfUrl(ctx.actions.origins, ref),
    note,
  };

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
    const hit = value.hits.find((h) => h.fekId === id) ?? value.hits[0];
    return { ...base, searchId: hit?.searchId ?? null, entity: undefined };
  } catch (e) {
    ctx.logger.debug(`could not resolve search_id for ${id}`, (e as Error).message);
    return { ...base, searchId: null, entity: undefined };
  }
}
