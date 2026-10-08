import { z } from 'zod';
import { TTL } from '../cache.js';
import { KAD_MIN_YEAR } from '../et/endpoints.js';
import { joinSections, kv, showing, table } from '../format/render.js';
import { invalidInput, limitSchema, SCOPE } from './shared.js';
import type { ToolDef } from './types.js';

/**
 * Where did my filing end up?
 *
 * When something is submitted for publication the Εθνικό Τυπογραφείο issues a
 * ΚΑΔ — Κωδικός Αριθμός Δημοσίευσης — and the submitter has that code and its
 * date but not yet an issue number. Weeks later it appears in some issue, and
 * the code is the only link between the two.
 *
 * Despite the name this is not the business activity code (also abbreviated
 * ΚΑΔ, Κωδικός Αριθμός Δραστηριότητας), which has nothing to do with the
 * gazette. The confusion is worth heading off in the description, because a
 * model asked about "ΚΑΔ 62.01" would otherwise reach for this tool.
 */
export const lookupKad: ToolDef = {
  name: 'lookup_kad',
  title: 'Look up a ΦΕΚ publication code (ΚΑΔ)',
  description:
    'Find which ΦΕΚ issue a publication code was published in. The ΚΑΔ ' +
    '(Κωδικός Αριθμός Δημοσίευσης) is the receipt number the Εθνικό Τυπογραφείο issues ' +
    'when it accepts a document for publication, weeks before the issue itself appears — ' +
    'so this answers "my filing has ΚΑΔ 8290 from 2003, where did it come out?". ' +
    'Both the code and its year are required, because codes restart each year. ' +
    'Note this is NOT the business activity code (Κωδικός Αριθμός Δραστηριότητας), which ' +
    'is a tax classification unrelated to the gazette. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    code: z
      .string()
      .describe('The publication code (ΚΑΔ), digits only, e.g. "8290".'),
    year: z
      .number()
      .int()
      .min(KAD_MIN_YEAR)
      .max(2100)
      .describe(`The year the code was issued. The register starts at ${KAD_MIN_YEAR}.`),
    limit: limitSchema(50, 20),
  },

  async handler(args, ctx) {
    const code = (args['code'] as string | undefined)?.trim();
    const year = args['year'] as number | undefined;
    const limit = (args['limit'] as number) ?? 20;

    if (!code) return invalidInput('code is required: the ΚΑΔ from the publication receipt.');
    if (year === undefined) {
      return invalidInput(
        'year is required: publication codes restart each year, so a code alone is ambiguous.',
      );
    }
    if (!/^\d{1,8}$/.test(code)) {
      return invalidInput(
        `${JSON.stringify(code)} is not a publication code. These are digits only, e.g. "8290". ` +
          'If you meant a business activity code (Κωδικός Αριθμός Δραστηριότητας) such as ' +
          '"62.01", that is a tax classification and does not appear in the gazette.',
      );
    }
    if (year < KAD_MIN_YEAR) {
      return invalidInput(
        `The publication-code register starts at ${KAD_MIN_YEAR}; there are no codes for ${year}.`,
      );
    }

    const { value: hits } = await ctx.cache.get(
      `searchkad:${code}:${year}`,
      { ttlMs: TTL.searchHistoric, staleIfError: true },
      () => ctx.actions.searchKad({ code, year }),
    );

    if (hits.length === 0) {
      return {
        text: joinSections([
          `No ΦΕΚ is recorded against publication code ${code} for ${year}.`,
          'Check the year on the receipt: the code is issued when the document is accepted, ' +
            'which can fall in the year before it is published.',
        ]),
        structured: { status: 'not_found', code, year },
      };
    }

    const shown = hits.slice(0, limit);
    const single = shown.length === 1 ? shown[0]! : undefined;

    return {
      text: joinSections([
        `Publication code ${code}/${year}`,
        single
          ? kv([
              ['published in', single.label],
              ['fek_id', single.fekId],
              ['code issued', single.publicationCodeDate],
              ['published', single.publicationDate],
              ['protocol no.', single.protocolNumber],
              ['topic', single.topic],
              ['pdf', single.pdfUrl],
            ])
          : table(shown, [
              { header: 'published in', get: (h) => h.label },
              { header: 'code issued', get: (h) => h.publicationCodeDate },
              { header: 'published', get: (h) => h.publicationDate },
              { header: 'topic', get: (h) => h.topic },
              { header: 'fek_id', get: (h) => h.fekId },
            ]),
        showing(shown.length, hits.length),
        shown.some((h) => h.cancelled)
          ? 'One or more of these publications is marked cancelled, which means the ' +
            'submission was withdrawn after the code was issued.'
          : null,
        'Call get_fek with the fek_id for the issue itself.',
      ]),
      structured: {
        status: 'ok',
        code,
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
          publication_code: h.publicationCode,
          publication_code_date: h.publicationCodeDate,
          publication_date: h.publicationDate,
          protocol_number: h.protocolNumber,
          topic: h.topic,
          cancelled: h.cancelled,
          pdf_url: h.pdfUrl,
        })),
      },
    };
  },
};
