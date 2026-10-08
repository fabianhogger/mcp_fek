/**
 * The endpoint surface, and one request-body builder per endpoint.
 *
 * None of this is documented. It was read out of the search.et.gr React
 * bundle (the endpoint table it calls `f`, plus each page's payload builder)
 * and then verified against the live service. Field names are therefore
 * upstream's spelling, not ours, and the oddities are real:
 *
 *  - `/simplesearch` takes arrays for year and issue but plain strings for
 *    everything else, and its date fields are *ranges* in one string.
 *  - `/searchasep` takes scalars where every sibling takes arrays.
 *  - `/searchlegislation` wants a law-type id in a field called
 *    `legislationCatalogues`.
 *  - `/documententitybyid` and `/issuegroupidsbyyear` are GETs that take their
 *    argument as a path segment.
 *
 * Keeping the quirks here means nothing above this file has to know them.
 */

export const EP = {
  searchByDate: '/searchbydate',
  simpleSearch: '/simplesearch',
  search: '/search',
  searchLegislation: '/searchlegislation',
  searchAsep: '/searchasep',
  searchCompany: '/searchcompany',
  /** Company name lookup. Takes `{partialName}`, despite the row prefix. */
  companies: '/companies',
  /** Lookup by publication code (ΚΑΔ), not by business activity code. */
  searchKad: '/searchkad',
  documentEntityById: '/documententitybyid',
  issueGroupIdsByYear: '/issuegroupidsbyyear',
  /**
   * Listed in the bundle's endpoint table but NOT usable: it answers 400 with
   * or without a path segment. The site never calls it — its year dropdown is
   * built client-side by `getYearRange()`, counting from 1833 to the current
   * year. So the year list is computed locally too; see fek/years.ts.
   */
  yearsUnusable: '/years',
  categories: '/categories',
  archetypes: '/archetypes',
  tags: '/tags',
  /**
   * The tag and named-entity vocabulary. Unused in v1: tag and entity
   * browsing is out of scope, and /tagsbyissue answers 400 to every payload
   * tried, including the `?ui=true` form the bundle sends. Left here so the
   * next person knows the names without re-reading the bundle.
   */
  tagsByIssue: '/tagsbyissue?ui=true',
  tagsByPartialMatch: '/tagsbypartialmatch',
  categoriesByPartialMatch: '/categoriesbypartialmatch',
  namedEntityByPartialNameAndArchetype: '/namedentitybypartialnameandarchetype',
  /**
   * Exists, and the bundle carries an edge-type map for it (modification,
   * expansion, reference, invalidation, identity, replacement, reinstatement)
   * — a citation graph between acts, which would be the single most valuable
   * thing here. But /timeline/{search_ID} returns 404: the id it wants is not
   * the search row id, and the scheme is not yet known. Unused for now.
   */
  timeline: '/timeline',
} as const;

/** Row key prefixes, which differ per endpoint. */
export const PREFIX = {
  search: 'search_',
  documentEntity: 'documententitybyid_',
  issueGroups: 'issuegroupidsbyyear_',
  years: 'years_',
  categories: 'categories_',
  archetypes: 'archetypes_',
  tags: 'tags_',
  tagsByIssue: 'tagsbyissue_',
} as const;

export interface SearchByDateBody {
  datePublished: string;
}

export function searchByDateBody(dateIso: string): SearchByDateBody {
  return { datePublished: dateIso };
}

export interface SimpleSearchBody {
  selectYear: string[];
  selectIssue: string[];
  documentNumber: string;
  searchText: string;
  /** A range: "YYYY-MM-DD YYYY-MM-DD", or ''. */
  datePublished: string;
  dateReleased: string;
}

export interface SimpleSearchInput {
  years?: readonly number[] | undefined;
  issueGroups?: readonly number[] | undefined;
  documentNumber?: string | undefined;
  searchText?: string | undefined;
  publishedRange?: string | undefined;
  releasedRange?: string | undefined;
}

export function simpleSearchBody(input: SimpleSearchInput): SimpleSearchBody {
  return {
    selectYear: (input.years ?? []).map(String),
    selectIssue: (input.issueGroups ?? []).map(String),
    documentNumber: input.documentNumber ?? '',
    searchText: input.searchText ?? '',
    datePublished: input.publishedRange ?? '',
    dateReleased: input.releasedRange ?? '',
  };
}

/**
 * The site refuses to search on nothing at all, and so do we.
 *
 * Mirroring the rule locally matters because the upstream's own response to an
 * empty search is not an error — it is a very large, very slow result set.
 */
export function hasAnySearchCriterion(body: SimpleSearchBody): boolean {
  return (
    body.searchText !== '' ||
    body.documentNumber !== '' ||
    body.selectIssue.length > 0 ||
    body.selectYear.length > 0 ||
    body.datePublished !== '' ||
    body.dateReleased !== ''
  );
}

export interface SearchLegislationBody {
  /** A law-type id from fek/lawtypes.ts, as a string. */
  legislationCatalogues: string;
  /** The law's own number, e.g. "5324". */
  legislationNumber: string;
  selectYear: string[];
}

export function searchLegislationBody(input: {
  lawTypeId?: number | undefined;
  number?: string | undefined;
  years?: readonly number[] | undefined;
}): SearchLegislationBody {
  return {
    legislationCatalogues: input.lawTypeId === undefined ? '' : String(input.lawTypeId),
    legislationNumber: input.number ?? '',
    selectYear: (input.years ?? []).map(String),
  };
}

/** Note the scalars: this endpoint does not take arrays, unlike its siblings. */
export interface SearchAsepBody {
  selectYear: string;
  documentNumber: string;
}

export function searchAsepBody(input: {
  year?: number | undefined;
  documentNumber?: string | undefined;
}): SearchAsepBody {
  return {
    selectYear: input.year === undefined ? '' : String(input.year),
    documentNumber: input.documentNumber ?? '',
  };
}

export interface SearchCompanyBody {
  /**
   * The company's internal id from /companies — NOT its name.
   *
   * Verified live: `{"company":"3135"}` alone returns that company's filings,
   * and a name in this field returns nothing rather than erroring.
   */
  company: string;
  /** Which registry the number below belongs to. Optional. */
  companyId: string;
  companyIdNumber: string;
  /** The display name, which the site sends but the search does not need. */
  companyName: string;
}

/**
 * Zero-pad a company registry number to the width its id type expects.
 *
 * Straight from the bundle's `addPaddingToCompanyIdNumber`. Which of the three
 * id types is ΑΡ.Μ.Α.Ε. / Γ.Ε.ΜΗ. / ΑΦΜ is still unconfirmed — only the widths
 * are known — so the tool exposing it says so rather than inventing a label.
 */
export function addPaddingToCompanyIdNumber(companyId: string, value: string): string {
  const widths: Record<string, number> = { '0': 5, '1': 12, '2': 9 };
  const width = widths[companyId];
  return width ? value.padStart(width, '0') : value;
}

export function searchCompanyBody(input: {
  companyId: string;
  registryType?: string | undefined;
  registryNumber?: string | undefined;
  companyName?: string | undefined;
}): SearchCompanyBody {
  const registryType = input.registryType ?? '';
  return {
    company: input.companyId,
    companyId: registryType,
    companyIdNumber: input.registryNumber
      ? addPaddingToCompanyIdNumber(registryType, input.registryNumber)
      : '',
    companyName: input.companyName ?? '',
  };
}

export interface CompaniesBody {
  partialName: string;
}

export function companiesBody(partialName: string): CompaniesBody {
  return { partialName };
}

/**
 * A ΚΑΔ lookup.
 *
 * `protocolNumber` is a misnomer in the upstream's own field naming: the value
 * it wants is the publication code (ΚΑΔ) from the `field_kad` input, and the
 * response returns the document's actual protocol number separately. Both the
 * code and the year are required — the site refuses the search otherwise, and
 * codes are only unique within a year.
 */
export interface SearchKadBody {
  protocolNumber: string;
  selectYear: string;
}

export function searchKadBody(input: { code: string; year: number }): SearchKadBody {
  return { protocolNumber: input.code, selectYear: String(input.year) };
}

/** The ΚΑΔ register does not go back further than this. */
export const KAD_MIN_YEAR = 1994;
