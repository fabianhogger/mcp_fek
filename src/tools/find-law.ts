import { z } from 'zod';
import { joinSections, oneLine, showing, table } from '../format/render.js';
import { resolveLawType } from '../fek/lawtypes.js';
import { invalidInput, limitSchema, SCOPE, yearSchema } from './shared.js';
import { lookupLaw } from './resolve-citation.js';
import type { ToolDef } from './types.js';

/**
 * Which ΦΕΚ a numbered law was published in.
 *
 * The legislation index is the only part of this API that returns a title, so
 * this tool is also the best source of titles anywhere here.
 *
 * Its one trap is the era collision, and it is not hypothetical: asking for
 * law 5324 with no year returns Α 63/1932 *and* Α 121/2026, because the
 * numbering restarted. Guessing the modern one would be right most of the
 * time, which is exactly what makes it dangerous — so both are returned and
 * the collision is named.
 */
export const findLaw: ToolDef = {
  name: 'find_law',
  title: 'Find the ΦΕΚ for a numbered law',
  description:
    'Find which ΦΕΚ issue a numbered legislative act was published in, and get its ' +
    'official title. Covers laws (Ν.), presidential decrees (Π.Δ.), acts of legislative ' +
    'content (Π.Ν.Π.) and the historic types; call fek_vocabulary with kind="law_types" ' +
    'for the full list. ' +
    'Give the year whenever you know it: law numbers restart between eras, so law 5324 ' +
    'without a year matches both a 1932 act and a 2026 one. Without a year every match ' +
    'is returned, newest first. ' +
    'This is the only part of the gazette index that carries act titles. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    number: z.string().describe('The act\'s own number, e.g. "5324". Not the φύλλο number.'),
    law_type: z
      .string()
      .optional()
      .describe(
        'Type of act: "Ν." (default), "Π.Δ.", "Π.Ν.Π.", "Ν.Δ.", or an id from ' +
          'fek_vocabulary kind="law_types". The full Greek word works too.',
      ),
    year: yearSchema.optional().describe('The year of the act. Strongly recommended.'),
    limit: limitSchema(50, 10),
  },

  async handler(args, ctx) {
    const number = (args['number'] as string | undefined)?.trim();
    if (!number) return invalidInput('number is required, e.g. "5324".');
    if (!/^\d{1,5}$/.test(number)) {
      return invalidInput(
        `${JSON.stringify(number)} is not an act number. Pass digits only, e.g. "5324"; ` +
          'if you have a full reference use resolve_citation instead.',
      );
    }
    const year = args['year'] as number | undefined;
    const limit = (args['limit'] as number) ?? 10;

    const typeInput = (args['law_type'] as string | undefined)?.trim() ?? 'Ν.';
    const resolved = resolveLawType(typeInput);
    if (resolved.decision === 'none') {
      return invalidInput(
        `Unknown act type ${JSON.stringify(typeInput)}. Call fek_vocabulary with ` +
          'kind="law_types" for the list.',
      );
    }
    if (resolved.decision === 'ambiguous') {
      return invalidInput(
        `${JSON.stringify(typeInput)} matches several act types: ${resolved.candidates
          .map((c) => `${c.abbr} (id ${c.id})`)
          .join(', ')}. Pass the id instead.`,
      );
    }
    const lawType = resolved.lawType;

    const hits = await lookupLaw(ctx, lawType.id, number, year);
    const shown = hits.slice(0, limit);

    if (hits.length === 0) {
      return {
        text: joinSections([
          `No ${lawType.abbr} ${number}${year ? `/${year}` : ''} in the gazette's legislation index.`,
          year !== undefined
            ? `Try again without the year: the act may be numbered under a different one, ` +
              'since a law passed in December is often published the following January.'
            : 'Check the number and the act type — a Π.Δ. and a Ν. can share a number.',
        ]),
        structured: {
          status: 'not_found',
          law_type: lawType.abbr,
          number,
          year: year ?? null,
        },
      };
    }

    return {
      text: joinSections([
        `${lawType.label} ${number}${year ? `/${year}` : ''} (${hits.length} ${
          hits.length === 1 ? 'match' : 'matches'
        })`,
        table(shown, [
          { header: 'act', get: (h) => `${lawType.abbr} ${number}/${h.year}` },
          { header: 'published in', get: (h) => h.label },
          { header: 'date', get: (h) => h.publicationDate },
          { header: 'pages', get: (h) => h.pages, align: 'right' },
          { header: 'fek_id', get: (h) => h.fekId },
          { header: 'title', get: (h) => oneLine(h.description, 90) },
        ]),
        showing(shown.length, hits.length),
        collisionNote(hits.length, year, number),
        'Call get_fek with a fek_id for the table of contents and article text.',
      ]),
      structured: {
        status: 'ok',
        law_type: lawType.abbr,
        law_type_id: lawType.id,
        number,
        year: year ?? null,
        total: hits.length,
        ambiguous_across_eras: year === undefined && hits.length > 1,
        results: shown.map((h) => ({
          fek_id: h.fekId,
          search_id: h.searchId,
          label: h.label,
          series_id: h.issueGroup,
          year: h.year,
          pages: h.pages,
          publication_date: h.publicationDate,
          issue_date: h.issueDate,
          title: h.description,
          pdf_url: h.pdfUrl,
        })),
      },
    };
  },
};

/**
 * Name the era collision explicitly.
 *
 * Verified against the live index: `{number: 5324}` with no year returns
 * Α 63/1932 alongside Α 121/2026.
 */
function collisionNote(total: number, year: number | undefined, number: string): string | null {
  if (year !== undefined || total <= 1) return null;
  return (
    `Act number ${number} has been used in more than one era, so these are different acts ` +
    'that merely share a number — not one act published twice. Pass `year` to pick the ' +
    'one you mean; do not assume the most recent.'
  );
}
