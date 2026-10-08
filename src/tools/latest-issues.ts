import { z } from 'zod';
import { listingStaleIfError, listingTtl, TTL } from '../cache.js';
import type { DocumentEntity, Publication } from '../domain/types.js';
import { athensTime, athensToday, isWeekend, recentDates } from '../et/dates.js';
import { joinSections, oneLine, showing, table } from '../format/render.js';
import { resolveSeries } from '../fek/series.js';
import { invalidInput, isoDateSchema, limitSchema, SCOPE, seriesSchema } from './shared.js';
import type { ToolContext, ToolDef } from './types.js';

/**
 * What the gazette published recently.
 *
 * Two things shape this tool more than anything else.
 *
 * First, the listing endpoint returns no titles at all — only series, number,
 * date and page count. Titles live inside the PDFs. So there is an enrichment
 * pass over /documententitybyid to pull topics, bounded by FEK_MAX_ENRICH
 * because an evening listing can hold ninety rows and nobody wants ninety
 * requests for one tool call.
 *
 * Second, a same-day listing is incomplete. It fills through the working day:
 * one weekday it held four rows at 13:00 and ninety by evening. Reporting
 * "4 issues published today" at lunchtime is wrong in a way that looks right,
 * so every same-day answer carries the time it was taken.
 */

interface EnrichedPublication extends Publication {
  topics: readonly string[];
}

export const latestIssues: ToolDef = {
  name: 'latest_issues',
  title: 'List recent ΦΕΚ issues',
  description:
    'List the ΦΕΚ issues published on a date or over the last few days — the ' +
    '"what is new" view. Optionally filter by issue series, so you can ask for ' +
    'just the laws (Τεύχος Α) or just ministerial decisions (Τεύχος Β). ' +
    'The listing carries no titles, so by default each issue is enriched with its ' +
    'subject topics from a second lookup; set enrich=false for a faster, barer list. ' +
    'An empty result is normal: the gazette does not publish at weekends or on public ' +
    'holidays. A listing for today is still filling up and the result says when it was ' +
    'taken, so do not report it as a final count. ' +
    SCOPE,
  returnsLaw: true,
  inputSchema: {
    date: isoDateSchema.optional().describe('A single publication date. Defaults to today in Athens.'),
    days_back: z
      .number()
      .int()
      .min(1)
      .max(14)
      .optional()
      .describe('Include this many calendar days ending at `date` (1-14, default 1).'),
    series: z
      .array(seriesSchema)
      .optional()
      .describe('Keep only these issue series. Omit for all series.'),
    enrich: z
      .boolean()
      .optional()
      .describe('Look up subject topics per issue (default true). Costs one request per issue.'),
    limit: limitSchema(100, 30),
  },

  async handler(args, ctx) {
    const daysBack = (args['days_back'] as number) ?? 1;
    const limit = (args['limit'] as number) ?? 30;
    const enrich = (args['enrich'] as boolean | undefined) ?? true;
    const today = athensToday(ctx.now());
    const date = (args['date'] as string | undefined) ?? today;

    const seriesFilter = new Set<number>();
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
      seriesFilter.add(resolved.series.id);
    }

    const dates = recentDates(date, daysBack);
    const all: Publication[] = [];
    for (const d of dates) {
      all.push(...(await listFor(ctx, d)));
    }

    const filtered =
      seriesFilter.size === 0 ? all : all.filter((p) => seriesFilter.has(p.issueGroup));
    // Newest first, and within a day the lower series (laws) before the rest.
    filtered.sort(
      (a, b) =>
        (b.publicationDate ?? '').localeCompare(a.publicationDate ?? '') ||
        a.issueGroup - b.issueGroup ||
        a.number - b.number,
    );
    const shown = filtered.slice(0, limit);
    const enriched = enrich ? await enrichTopics(ctx, shown) : shown.map(withoutTopics);

    const includesToday = dates.includes(today);
    const notes: Array<string | null> = [
      showing(shown.length, filtered.length),
      includesToday
        ? `Today's listing was taken at ${athensTime(ctx.now())} Europe/Athens and is still filling up; issues appear through the working day.`
        : null,
      filtered.length === 0 ? emptyExplanation(dates) : null,
      enrich && shown.length > ctx.config.maxEnrich
        ? `Topics were looked up for the first ${ctx.config.maxEnrich} issues only (FEK_MAX_ENRICH).`
        : null,
      'Use get_fek with a fek_id for the full issue, its table of contents and article text.',
    ];

    return {
      text: joinSections([
        heading(dates, filtered.length),
        table(enriched, [
          { header: 'issue', get: (p) => p.label },
          { header: 'published', get: (p) => p.publicationDate },
          { header: 'pages', get: (p) => p.pages, align: 'right' },
          { header: 'topics', get: (p) => oneLine(p.topics.join('; '), 70) },
          { header: 'fek_id', get: (p) => p.fekId },
        ]),
        ...notes,
      ]),
      structured: {
        status: filtered.length === 0 ? 'empty' : 'ok',
        dates,
        total: filtered.length,
        taken_at_athens: athensTime(ctx.now()),
        listing_may_be_incomplete: includesToday,
        issues: enriched.map((p) => ({
          fek_id: p.fekId,
          search_id: p.searchId,
          label: p.label,
          series: p.seriesName,
          series_id: p.issueGroup,
          number: p.number,
          year: p.year,
          pages: p.pages,
          issue_date: p.issueDate,
          publication_date: p.publicationDate,
          topics: p.topics,
          pdf_url: p.pdfUrl,
        })),
      },
    };
  },
};

function withoutTopics(p: Publication): EnrichedPublication {
  return { ...p, topics: [] };
}

function heading(dates: readonly string[], total: number): string {
  const span =
    dates.length === 1 ? `on ${dates[0]}` : `from ${dates[dates.length - 1]} to ${dates[0]}`;
  return `ΦΕΚ issues published ${span} (${total})`;
}

/** Say why nothing came back, so a model does not read it as a fault. */
function emptyExplanation(dates: readonly string[]): string {
  const allWeekend = dates.every(isWeekend);
  if (allWeekend) {
    return 'Nothing published: every date in this range is a weekend, when the gazette does not publish.';
  }
  return (
    'Nothing published on these dates. That is normal for weekends and public holidays, ' +
    'and for the early part of a working day before the listing fills.'
  );
}

async function listFor(ctx: ToolContext, dateIso: string): Promise<Publication[]> {
  const now = ctx.now();
  const result = await ctx.cache.get(
    `searchbydate:${dateIso}`,
    {
      ttlMs: listingTtl(dateIso, now),
      // A stale same-day listing does not merely undercount: it reports
      // "nothing published" for a day that published ninety issues.
      staleIfError: listingStaleIfError(dateIso, now),
    },
    () => ctx.actions.searchByDate(dateIso),
  );
  return result.value;
}

/**
 * Attach subject topics, which is the only way to get anything title-like out
 * of a daily listing.
 */
async function enrichTopics(
  ctx: ToolContext,
  issues: readonly Publication[],
): Promise<EnrichedPublication[]> {
  const budget = ctx.config.maxEnrich;
  const out: EnrichedPublication[] = [];
  let spent = 0;

  for (const issue of issues) {
    if (spent >= budget || issue.searchId === null) {
      out.push(withoutTopics(issue));
      continue;
    }
    spent++;
    try {
      const searchId = issue.searchId;
      const entity = await ctx.cache.get(
        `documententity:${searchId}`,
        { ttlMs: TTL.documentEntity, staleIfError: true },
        () => ctx.actions.documentEntityById(searchId),
      );
      out.push(merge(issue, entity.value));
    } catch (e) {
      // Enrichment is a nicety; losing it must never lose the issue itself.
      ctx.logger.debug(`enrichment failed for ${issue.label}`, (e as Error).message);
      out.push(withoutTopics(issue));
    }
  }
  return out;
}

function merge(issue: Publication, entity: DocumentEntity | null): EnrichedPublication {
  return { ...issue, topics: entity ? entity.topics.map((t) => t.name) : [] };
}
