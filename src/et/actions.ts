import type {
  DocumentEntity,
  KadHit,
  LawHit,
  Publication,
  SearchHit,
  VocabularyItem,
} from '../domain/types.js';
import type { Logger } from '../logger.js';
import type { EtClient } from './client.js';
import { isIsoDate } from './dates.js';
import { popStemmedQuery } from './envelope.js';
import { EtError } from './errors.js';
import {
  EP,
  hasAnySearchCriterion,
  PREFIX,
  companiesBody,
  searchAsepBody,
  searchByDateBody,
  searchCompanyBody,
  searchKadBody,
  searchLegislationBody,
  simpleSearchBody,
  type SimpleSearchInput,
} from './endpoints.js';
import type { Origins } from './origins.js';
import {
  toDocumentEntity,
  toKadHit,
  toLawHit,
  toPublication,
  toSearchHit,
  toVocabularyItem,
} from './rows.js';

/**
 * One typed function per upstream call.
 *
 * This is the only layer that knows which endpoint answers what. Tools call
 * these; they never build a body or name an endpoint themselves.
 */
export class EtActions {
  constructor(
    private readonly client: EtClient,
    private readonly logger?: Logger,
  ) {}

  get origins(): Origins {
    return this.client.origins;
  }

  /**
   * Everything published on one date.
   *
   * An empty result is normal and not an error: the gazette does not publish
   * at weekends or on public holidays. Note also that a same-day listing is
   * incomplete — it fills through the working day — so callers must say when
   * they looked rather than presenting it as the final count.
   */
  async searchByDate(dateIso: string): Promise<Publication[]> {
    if (!isIsoDate(dateIso)) {
      // Caught locally because upstream answers any malformed date with a bare
      // 400, which tells a model nothing about what to fix.
      throw new EtError({
        kind: 'bad_date_format',
        action: EP.searchByDate,
        detail: `${JSON.stringify(dateIso)} is not a valid YYYY-MM-DD date`,
      });
    }
    const rows = await this.client.post(EP.searchByDate, searchByDateBody(dateIso));
    return this.mapRows(rows, (r) => toPublication(r, PREFIX.search, this.origins));
  }

  /**
   * The main search.
   *
   * Returns the stemmed query alongside the hits when the search carried text:
   * the index searches a stem, so «τηλεργασία» really matches `τηλεργασ`, and
   * a caller that cannot see that cannot explain its own results.
   */
  async simpleSearch(
    input: SimpleSearchInput,
  ): Promise<{ hits: SearchHit[]; stemmedQuery: string | null }> {
    const body = simpleSearchBody(input);
    if (!hasAnySearchCriterion(body)) {
      throw new EtError({
        kind: 'bad_request',
        action: EP.simpleSearch,
        detail: 'a search needs at least one of text, number, series, year or date range',
      });
    }
    const raw = await this.client.post(EP.simpleSearch, body);
    const { rows, stemmedQuery } = popStemmedQuery(raw, PREFIX.search);
    return {
      hits: this.mapRows(rows, (r) => toSearchHit(r, PREFIX.search, this.origins)),
      stemmedQuery,
    };
  }

  /**
   * Find the ΦΕΚ a numbered law was published in.
   *
   * The only endpoint that returns a title (`search_Description`), so it is
   * also the best title source anywhere in this API.
   *
   * Beware the era collision: law numbers restart. Searching number 5324 with
   * no year returns Α 63/1932, not the 2026 law of the same number, so a
   * caller that omits the year must be told that every era matched.
   */
  async searchLegislation(input: {
    lawTypeId?: number | undefined;
    number?: string | undefined;
    years?: readonly number[] | undefined;
  }): Promise<LawHit[]> {
    const body = searchLegislationBody(input);
    if (body.legislationCatalogues === '' && body.legislationNumber === '') {
      throw new EtError({
        kind: 'bad_request',
        action: EP.searchLegislation,
        detail: 'a legislation search needs at least a law type or a number',
      });
    }
    const rows = await this.client.post(EP.searchLegislation, body);
    return this.mapRows(rows, (r) => toLawHit(r, PREFIX.search, this.origins));
  }

  /**
   * ΑΣΕΠ announcements.
   *
   * Note the payload: this endpoint takes scalars where every sibling takes
   * arrays. It also returns `search_Description`, so hits carry a title.
   */
  async searchAsep(input: {
    year?: number | undefined;
    documentNumber?: string | undefined;
  }): Promise<SearchHit[]> {
    const rows = await this.client.post(EP.searchAsep, searchAsepBody(input));
    return this.mapRows(rows, (r) => toSearchHit(r, PREFIX.search, this.origins));
  }

  /**
   * Company filings (ΑΕ-ΕΠΕ / ΠΡΑ.Δ.Ι.Τ. issues) for one company.
   *
   * Keyed on the company's internal id, which `companies()` resolves from a
   * name. A name passed here returns nothing rather than erroring, which is
   * why the tool resolves first and never guesses.
   */
  async searchCompany(input: {
    companyId: string;
    registryType?: string | undefined;
    registryNumber?: string | undefined;
    companyName?: string | undefined;
  }): Promise<SearchHit[]> {
    const rows = await this.client.post(EP.searchCompany, searchCompanyBody(input));
    return this.mapRows(rows, (r) => toSearchHit(r, PREFIX.search, this.origins));
  }

  /**
   * Which ΦΕΚ a publication code (ΚΑΔ) ended up in.
   *
   * Both arguments are required: the upstream refuses the search otherwise,
   * and a code is only unique within its year.
   */
  async searchKad(input: { code: string; year: number }): Promise<KadHit[]> {
    const rows = await this.client.post(EP.searchKad, searchKadBody(input));
    return this.mapRows(rows, (r) => toKadHit(r, PREFIX.search, this.origins));
  }

  /** Companies whose name contains this fragment. At least 3 characters. */
  async companies(partialName: string): Promise<VocabularyItem[]> {
    const rows = await this.client.post(EP.companies, companiesBody(partialName));
    return this.mapRows(rows, (r) => toVocabularyItem(r, 'companies_'));
  }

  /** Metadata plus topics and subjects for one issue, by its search row id. */
  async documentEntityById(searchId: string): Promise<DocumentEntity | null> {
    const rows = await this.client.get(EP.documentEntityById, searchId);
    if (rows.length === 0) return null;
    return toDocumentEntity(rows, PREFIX.documentEntity, this.origins);
  }

  /** Which series actually published in a given year. */
  async issueGroupIdsByYear(year: number): Promise<number[]> {
    const rows = await this.client.get(EP.issueGroupIdsByYear, year);
    const ids = new Set<number>();
    for (const row of rows) {
      const raw = row[`${PREFIX.issueGroups}IssueGroupID`];
      const id = Number(typeof raw === 'string' ? raw.trim() : raw);
      if (Number.isFinite(id) && id > 0) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
  }

  async categories(): Promise<VocabularyItem[]> {
    const rows = await this.client.get(EP.categories);
    return this.mapRows(rows, (r) => toVocabularyItem(r, PREFIX.categories));
  }

  /** Drop rows that cannot be mapped, loudly enough to notice in the log. */
  private mapRows<T>(rows: readonly Record<string, unknown>[], map: (r: Record<string, unknown>) => T | null): T[] {
    const out: T[] = [];
    let skipped = 0;
    for (const row of rows) {
      const mapped = map(row);
      if (mapped === null) skipped++;
      else out.push(mapped);
    }
    if (skipped > 0) this.logger?.debug(`skipped ${skipped} unmappable row(s)`);
    return out;
  }
}
