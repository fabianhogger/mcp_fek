import type {
  DocumentEntity,
  KadHit,
  LawHit,
  Publication,
  SearchHit,
  Topic,
  VocabularyItem,
} from '../domain/types.js';
import { fekId } from '../fek/ids.js';
import { seriesName } from '../fek/series.js';
import { parseUsDateTime } from './dates.js';
import type { RawRow } from './envelope.js';
import { pdfUrl, type Origins } from './origins.js';
import { decodeMatchedText, parseHighlighted } from './snippets.js';

/**
 * Raw upstream rows to domain objects.
 *
 * Every upstream quirk is absorbed here: the per-endpoint key prefixes, the
 * fact that every scalar arrives as a string (`"search_Pages":"4"`), the US
 * date format, and the issue label that has to be recomputed because series 11
 * renamed itself in 2015 and the stored label does not always agree.
 */

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number | null {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Pull a prefixed field: get(row, 'search_', 'Pages'). */
function get(row: RawRow, prefix: string, field: string): unknown {
  return row[`${prefix}${field}`] ?? row[field];
}

/**
 * The year of an issue.
 *
 * `PrimaryLabel` is "Β 6047/2026", so the year is after the slash. Preferred
 * over the publication date because an issue dated 31 December can be
 * published in January and still belong to the earlier year's numbering.
 */
function yearOf(label: string | null, publicationDate: string | null): number | null {
  if (label) {
    const m = /\/(\d{4})\s*$/.exec(label);
    if (m) return Number(m[1]);
  }
  if (publicationDate) return Number(publicationDate.slice(0, 4));
  return null;
}

export function toPublication(row: RawRow, prefix: string, origins: Origins): Publication | null {
  const label = str(get(row, prefix, 'PrimaryLabel'));
  const number = num(get(row, prefix, 'DocumentNumber'));
  const issueGroup = num(get(row, prefix, 'IssueGroupID'));
  const publicationDate = parseUsDateTime(get(row, prefix, 'PublicationDate'));
  const year = yearOf(label, publicationDate);

  // Without these three there is no document to point at, and a row that
  // lacks them is upstream noise rather than something to render as a result.
  if (number === null || issueGroup === null || year === null) return null;

  const ref = { year, issueGroup, number };
  return {
    searchId: str(get(row, prefix, 'ID')),
    number,
    issueGroup,
    year,
    seriesName: seriesName(issueGroup, year),
    label: label ?? `${seriesName(issueGroup, year)} ${number}/${year}`,
    pages: num(get(row, prefix, 'Pages')),
    issueDate: parseUsDateTime(get(row, prefix, 'IssueDate')),
    publicationDate,
    fekId: fekId(ref),
    pdfUrl: pdfUrl(origins, ref),
  };
}

export function toSearchHit(row: RawRow, prefix: string, origins: Origins): SearchHit | null {
  const base = toPublication(row, prefix, origins);
  if (!base) return null;
  return {
    ...base,
    extract: decodeMatchedText(get(row, prefix, 'MatchedText')),
    matchedTerms: parseHighlighted(get(row, prefix, 'HighlightedText')),
    description: str(get(row, prefix, 'Description')),
  };
}

export function toLawHit(row: RawRow, prefix: string, origins: Origins): LawHit | null {
  const base = toSearchHit(row, prefix, origins);
  if (!base) return null;
  return {
    ...base,
    lawTypeId: num(get(row, prefix, 'LawID')),
    lawNumber: str(get(row, prefix, 'LawProtocolNumber')),
  };
}

/**
 * Assemble a document entity from the several rows /documententitybyid returns.
 *
 * The response is not one object: the first row carries the metadata and the
 * rest carry one topic or subject each, so they have to be folded together.
 */
export function toDocumentEntity(
  rows: readonly RawRow[],
  prefix: string,
  origins: Origins,
): DocumentEntity | null {
  const head = rows.find((r) => get(r, prefix, 'DocumentNumber') !== undefined);
  if (!head) return null;
  const base = toPublication(head, prefix, origins);
  if (!base) return null;

  const topics: Topic[] = [];
  const subjectIds: string[] = [];
  for (const row of rows) {
    const topicId = str(get(row, prefix, 'topics_ID'));
    const topicName = str(get(row, prefix, 'topics_Name'));
    if (topicId && topicName && !topics.some((t) => t.id === topicId)) {
      topics.push({ id: topicId, name: topicName });
    }
    const subjectId = str(get(row, prefix, 'subjects_ID'));
    if (subjectId && !subjectIds.includes(subjectId)) subjectIds.push(subjectId);
  }

  const protocolNumber =
    str(get(head, prefix, 'protocolnumber_Value')) ??
    rows.map((r) => str(get(r, prefix, 'protocolnumber_Value'))).find((v) => v !== null) ??
    null;

  return {
    ...base,
    topics,
    subjectIds,
    protocolNumber,
    reReleaseDate: parseUsDateTime(get(head, prefix, 'ReReleaseDate')),
  };
}

/** A reference-vocabulary row, whose two fields are `<prefix>ID` and `<prefix>Value`. */
export function toVocabularyItem(row: RawRow, prefix: string): VocabularyItem | null {
  const id = str(get(row, prefix, 'ID'));
  const value = str(get(row, prefix, 'Value')) ?? str(get(row, prefix, 'Name'));
  if (!id || !value) return null;
  return { id, value };
}

/**
 * A ΚΑΔ lookup row.
 *
 * Shaped unlike every other search result: the row id is
 * `DocumentEntityID` rather than `ID`, the year is explicit rather than
 * parsed out of the label, and it carries the publication code and its topic.
 */
export function toKadHit(row: RawRow, prefix: string, origins: Origins): KadHit | null {
  const number = num(get(row, prefix, 'DocumentNumber'));
  const issueGroup = num(get(row, prefix, 'IssueGroupID'));
  const year = num(get(row, prefix, 'Year'));
  if (number === null || issueGroup === null || year === null) return null;

  const ref = { year, issueGroup, number };
  return {
    searchId: str(get(row, prefix, 'DocumentEntityID')),
    number,
    issueGroup,
    year,
    seriesName: seriesName(issueGroup, year),
    label: str(get(row, prefix, 'PrimaryLabel')) ?? formatLabelFor(ref),
    pages: num(get(row, prefix, 'Pages')),
    issueDate: parseUsDateTime(get(row, prefix, 'IssueDate')),
    publicationDate: parseUsDateTime(get(row, prefix, 'PublicationDate')),
    fekId: fekId(ref),
    pdfUrl: pdfUrl(origins, ref),
    publicationCode: str(get(row, prefix, 'PublicationIdentifyingCode')),
    publicationCodeDate: parseUsDateTime(get(row, prefix, 'PublicationIdentifyingCodeDate')),
    protocolNumber: str(get(row, prefix, 'ProtocolNumber')),
    topic: str(get(row, prefix, 'Topic')),
    cancelled: str(get(row, prefix, 'IsCancelled')) === '1',
  };
}

function formatLabelFor(ref: { year: number; issueGroup: number; number: number }): string {
  return `${seriesName(ref.issueGroup, ref.year)} ${ref.number}/${ref.year}`;
}
