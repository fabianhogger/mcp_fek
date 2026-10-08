import { z } from 'zod';
import { TTL } from '../cache.js';
import type { DocumentEntity } from '../domain/types.js';
import { joinSections, kv, table } from '../format/render.js';
import { invalidInput, SCOPE } from './shared.js';
import { identify, type Identified } from './identify.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * What an issue is about, without downloading it.
 *
 * The daily listing carries no titles, so the subject topics attached to an
 * issue are the cheapest description of it available — one request instead of
 * a multi-megabyte PDF. The ids come back too, because they are the same ids
 * the search tools filter on, which makes this a way in as well as a readout.
 */
export const fekSubjects: ToolDef = {
  name: 'fek_subjects',
  title: 'Describe what a ΦΕΚ issue covers',
  description:
    'Get the subject topics and protocol number recorded against a ΦΕΚ issue, without ' +
    'downloading the PDF. Useful for judging whether an issue is worth opening, since ' +
    'the daily listing carries no titles at all. ' +
    'Accepts a fek_id, an internal search_id, a written citation, or series plus number ' +
    'and year. Also reports a re-release date when the issue was republished, which is ' +
    'how a correction (διόρθωση σφάλματος) shows up. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    fek_id: z.string().optional().describe('The 11-digit id, e.g. "20260100121".'),
    search_id: z.string().optional().describe('The internal search row id, if you have one.'),
    citation: z.string().optional().describe('A written reference, e.g. "ΦΕΚ Β\' 6047/2026".'),
    series: z.string().optional().describe('Issue series, used with number and year.'),
    number: z.number().int().optional().describe('The φύλλο number, used with series and year.'),
    year: z.number().int().optional().describe('The year, used with series and number.'),
  },

  async handler(args, ctx) {
    const identified = await identify(args, ctx);
    if (identified.kind === 'invalid') return invalidInput(identified.message);

    const entity = await loadEntity(ctx, identified);
    if (!entity) {
      return {
        text: joinSections([
          `No subject metadata is recorded for ${identified.label}.`,
          'That is common for older issues. The PDF is still available:',
          identified.pdfUrl,
        ]),
        structured: {
          status: 'not_found',
          fek_id: identified.fekId,
          label: identified.label,
          pdf_url: identified.pdfUrl,
        },
      };
    }

    return {
      text: joinSections([
        entity.label,
        kv([
          ['fek_id', entity.fekId],
          ['published', entity.publicationDate],
          ['signed', entity.issueDate],
          ['pages', entity.pages],
          ['protocol no.', entity.protocolNumber],
          ['re-released', entity.reReleaseDate],
          ['pdf', entity.pdfUrl],
        ]),
        entity.topics.length > 0
          ? table(entity.topics, [
              { header: 'topic_id', get: (t) => t.id },
              { header: 'topic', get: (t) => t.name },
            ])
          : 'No subject topics recorded for this issue.',
        entity.reReleaseDate
          ? 'This issue carries a re-release date, which usually means a correction ' +
            '(διόρθωση σφάλματος) was published. Check whether the correction affects the text you need.'
          : null,
        'Call get_fek with this fek_id for the table of contents and article text.',
      ]),
      structured: {
        status: 'ok',
        fek_id: entity.fekId,
        search_id: entity.searchId,
        label: entity.label,
        series: entity.seriesName,
        series_id: entity.issueGroup,
        number: entity.number,
        year: entity.year,
        pages: entity.pages,
        issue_date: entity.issueDate,
        publication_date: entity.publicationDate,
        protocol_number: entity.protocolNumber,
        re_release_date: entity.reReleaseDate,
        topics: entity.topics.map((t) => ({ id: t.id, name: t.name })),
        subject_ids: entity.subjectIds,
        pdf_url: entity.pdfUrl,
      },
    };
  },
};

export async function loadEntity(
  ctx: ToolContext,
  identified: Identified & { kind: 'ok' },
): Promise<DocumentEntity | null> {
  // Already loaded while resolving the identifier; fetching again would cost a
  // second request for the same bytes.
  if (identified.entity !== undefined) return identified.entity;
  const searchId = identified.searchId;
  if (searchId === null || searchId === '') return null;
  const { value } = await ctx.cache.get(
    `documententity:${searchId}`,
    // Not 90 days despite the PDF being immutable: a correction updates the
    // re-release date on an existing entity.
    { ttlMs: TTL.documentEntity, staleIfError: true },
    () => ctx.actions.documentEntityById(searchId),
  );
  return value;
}
