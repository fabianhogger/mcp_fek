/**
 * The domain model, free of upstream naming.
 *
 * Everything the API returns arrives with a per-endpoint key prefix
 * (`search_PrimaryLabel`, `documententitybyid_Pages`) and US-format dates.
 * src/et/rows.ts absorbs all of that, so nothing above it has to know.
 */

export interface Publication {
  /**
   * The API's own row id, needed for /documententitybyid and nothing else.
   *
   * Null when the row did not carry one — which is the normal case for
   * /documententitybyid itself, whose rows omit the id you looked them up by.
   */
  searchId: string | null;
  /** The φύλλο number within the series and year. */
  number: number;
  issueGroup: number;
  year: number;
  /** The series name as printed for this year, e.g. "Β". */
  seriesName: string;
  /** The label the gazette prints, e.g. "Β 6047/2026". */
  label: string;
  pages: number | null;
  /** Date the act was signed/issued, ISO. */
  issueDate: string | null;
  /** Date it appeared in the gazette, ISO. This is the one people cite. */
  publicationDate: string | null;
  /** `YYYY` + 2-digit series + 5-digit number. */
  fekId: string;
  pdfUrl: string;
}

export interface SearchHit extends Publication {
  /**
   * A window of body text around the match, decoded from search_MatchedText.
   *
   * Accent-stripped and lowercased by the upstream index, so it locates and
   * summarises but must never be quoted as the published wording.
   */
  extract: string | null;
  /** The surface forms that actually matched, from search_HighlightedText. */
  matchedTerms: readonly string[];
  /** Title/description, present only on legislation and ΑΣΕΠ searches. */
  description: string | null;
}

export interface LawHit extends SearchHit {
  lawTypeId: number | null;
  /** The law's own number, e.g. 5324 — distinct from the φύλλο number. */
  lawNumber: string | null;
}

export interface Topic {
  id: string;
  name: string;
}

export interface DocumentEntity extends Publication {
  topics: readonly Topic[];
  subjectIds: readonly string[];
  protocolNumber: string | null;
  /** Set when the issue was re-released, typically a διόρθωση σφάλματος. */
  reReleaseDate: string | null;
}

/** A reference-vocabulary row: an id plus the Greek label it stands for. */
export interface VocabularyItem {
  id: string;
  value: string;
}

/**
 * A ΚΑΔ (Κωδικός Αριθμός Δημοσίευσης) lookup result.
 *
 * The code the Εθνικό Τυπογραφείο assigns to a submission when it is accepted
 * for publication. Whoever filed it has the code and the date, and needs to
 * know which issue it came out in — which is the question this answers.
 */
export interface KadHit extends Publication {
  publicationCode: string | null;
  /** When the code was issued, which precedes publication by days or weeks. */
  publicationCodeDate: string | null;
  protocolNumber: string | null;
  topic: string | null;
  /** The publication was cancelled after the code was issued. */
  cancelled: boolean;
}
