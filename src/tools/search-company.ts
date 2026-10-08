import { z } from 'zod';
import { TTL } from '../cache.js';
import type { VocabularyItem } from '../domain/types.js';
import { joinSections, showing, table } from '../format/render.js';
import { MIN_QUERY_LEN } from '../fek/limits.js';
import { search } from '../text/match.js';
import { invalidInput, limitSchema, SCOPE } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * Company filings in the gazette.
 *
 * Greek companies publish statutory notices — incorporations, capital
 * changes, mergers, dissolutions — in Τεύχος ΑΕ-ΕΠΕ, renamed ΠΡΑ.Δ.Ι.Τ. from
 * 2015. The index is keyed on the gazette's own internal company id, not on a
 * name, so this tool resolves the name first.
 *
 * It never picks between similarly named companies. «ΤΡΑΠΕΖΑ …» matches dozens,
 * and returning one company's filings as though they were another's is exactly
 * the sort of confidently wrong answer worth refusing to give.
 */
export const searchCompany: ToolDef = {
  name: 'search_company',
  title: 'Find a company’s ΦΕΚ filings',
  description:
    'Find the ΦΕΚ issues in which a Greek company published statutory notices — ' +
    'incorporation, capital changes, board appointments, mergers, dissolution. ' +
    'These appear in Τεύχος ΑΕ-ΕΠΕ, renamed ΠΡΑ.Δ.Ι.Τ. from 2015. ' +
    'Pass the company name, in Greek or Latin letters; the name is resolved against ' +
    'the gazette’s company register first, and if several companies match you get ' +
    'the candidates rather than one of them chosen arbitrarily. Pass company_id from ' +
    'that shortlist to pick one. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    name: z
      .string()
      .optional()
      .describe(
        `Company name or a fragment of it, at least ${MIN_QUERY_LEN} characters. ` +
          'Greek or Latin letters.',
      ),
    company_id: z
      .string()
      .optional()
      .describe('The gazette’s internal company id, from an earlier shortlist.'),
    registry_number: z
      .string()
      .optional()
      .describe(
        'A company registry number to narrow by. Requires registry_type, which ' +
          'selects which registry it belongs to.',
      ),
    registry_type: z
      .enum(['0', '1', '2'])
      .optional()
      .describe(
        'Which registry registry_number belongs to. The upstream exposes three, ' +
          'padded to 5, 12 and 9 digits respectively; which is ΑΡ.Μ.Α.Ε., Γ.Ε.ΜΗ. and ' +
          'ΑΦΜ is not documented anywhere and has not been confirmed, so prefer ' +
          'searching by name.',
      ),
    limit: limitSchema(100, 25),
  },

  async handler(args, ctx) {
    const name = (args['name'] as string | undefined)?.trim() || undefined;
    const companyIdArg = (args['company_id'] as string | undefined)?.trim() || undefined;
    const registryNumber = (args['registry_number'] as string | undefined)?.trim() || undefined;
    const registryType = args['registry_type'] as string | undefined;
    const limit = (args['limit'] as number) ?? 25;

    if (!name && !companyIdArg) {
      return invalidInput('Pass either a company `name` or a `company_id`.');
    }
    if (name && !companyIdArg && name.length < MIN_QUERY_LEN) {
      return invalidInput(
        `The company register needs at least ${MIN_QUERY_LEN} characters to search on.`,
      );
    }
    if (registryNumber && registryType === undefined) {
      return invalidInput(
        'registry_number needs registry_type, which selects the registry it belongs to.',
      );
    }

    let companyId = companyIdArg;
    let companyName: string | undefined;

    if (!companyId && name) {
      const matches = await lookupCompanies(ctx, name);
      if (matches.length === 0) {
        return {
          text: joinSections([
            `No company in the gazette register matches ${JSON.stringify(name)}.`,
            'The register holds the name as filed, which is often the full legal name ' +
              '(«… ΑΝΩΝΥΜΗ ΕΤΑΙΡΕΙΑ»). Try a distinctive word from it rather than a trade name.',
          ]),
          structured: { status: 'not_found', query: name },
        };
      }
      if (matches.length > 1) {
        // Deliberately not resolved: attributing one company's filings to
        // another is worse than asking which was meant.
        const shown = matches.slice(0, limit);
        return {
          text: joinSections([
            `${matches.length} companies match ${JSON.stringify(name)}:`,
            table(shown, [
              { header: 'company_id', get: (c) => c.id },
              { header: 'name', get: (c) => c.value },
            ]),
            showing(shown.length, matches.length),
            'Call search_company again with one of these company_id values.',
          ]),
          structured: {
            status: 'ambiguous',
            query: name,
            total: matches.length,
            candidates: shown.map((c) => ({ company_id: c.id, name: c.value })),
          },
        };
      }
      companyId = matches[0]!.id;
      companyName = matches[0]!.value;
    }

    const { value: hits } = await ctx.cache.get(
      `searchcompany:${companyId}:${registryType ?? ''}:${registryNumber ?? ''}`,
      { ttlMs: TTL.searchHistoric, staleIfError: true },
      () =>
        ctx.actions.searchCompany({
          companyId: companyId!,
          registryType,
          registryNumber,
          companyName,
        }),
    );

    const shown = hits.slice(0, limit);
    const heading = companyName ?? `company ${companyId}`;

    if (hits.length === 0) {
      return {
        text: `No ΦΕΚ filings are recorded for ${heading}.`,
        structured: { status: 'empty', company_id: companyId, company_name: companyName ?? null },
      };
    }

    return {
      text: joinSections([
        `ΦΕΚ filings for ${heading} (${hits.length})`,
        table(shown, [
          { header: 'issue', get: (h) => h.label },
          { header: 'published', get: (h) => h.publicationDate },
          { header: 'pages', get: (h) => h.pages, align: 'right' },
          { header: 'fek_id', get: (h) => h.fekId },
        ]),
        showing(shown.length, hits.length),
        'Filings are listed newest first. Call get_fek with a fek_id for the notice itself.',
      ]),
      structured: {
        status: 'ok',
        company_id: companyId,
        company_name: companyName ?? null,
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
          pdf_url: h.pdfUrl,
        })),
      },
    };
  },
};

/**
 * Resolve a company name against the register.
 *
 * The upstream already does a substring match, so the local matcher is only
 * there to promote an exact or near-exact name to the top and to let a
 * Latin-typed query through.
 */
async function lookupCompanies(ctx: ToolContext, name: string): Promise<VocabularyItem[]> {
  const { value } = await ctx.cache.get(
    `companies:${name.toLowerCase()}`,
    { ttlMs: TTL.vocabulary, staleIfError: true },
    () => ctx.actions.companies(name),
  );
  if (value.length <= 1) return value;

  const ranked = search(
    name,
    value.map((item) => ({ names: [item.value], id: item.id, item })),
    { limit: 100 },
  );
  // An unambiguous winner means one company's name really is what was asked
  // for; otherwise keep the whole field so the caller chooses.
  if (ranked.decision === 'unique' && ranked.best) return [ranked.best.item];
  return ranked.candidates.length > 0 ? ranked.candidates.map((c) => c.item.item) : value;
}
