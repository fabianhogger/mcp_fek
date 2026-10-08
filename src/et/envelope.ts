import { EtError } from './errors.js';

/**
 * Unwrapping the API's response envelope.
 *
 * Every endpoint answers with the same outer shape:
 *
 *   {"status":"ok","message":"Operation completed successfully","data":"[{…}]"}
 *
 * and `data` is a JSON-encoded *string* inside the already-parsed JSON body,
 * so it has to be parsed a second time. Miss that and every field reads as
 * undefined with no error anywhere.
 *
 * Rows also carry a per-endpoint key prefix — `search_PrimaryLabel`,
 * `documententitybyid_Pages`, `issuegroupidsbyyear_IssueGroupID` — which is
 * why `unprefix` exists: the prefix is upstream's business, not the domain's.
 */

export type RawRow = Record<string, unknown>;

interface Envelope {
  status?: unknown;
  message?: unknown;
  data?: unknown;
}

export function unwrap(body: string, action: string): RawRow[] {
  let outer: Envelope;
  try {
    outer = JSON.parse(body) as Envelope;
  } catch {
    throw new EtError({
      kind: 'invalid_shape',
      action,
      detail: `response was not JSON (starts with ${JSON.stringify(body.slice(0, 40))})`,
    });
  }

  if (outer.status !== 'ok') {
    throw new EtError({
      kind: 'invalid_shape',
      action,
      detail: `envelope status=${JSON.stringify(outer.status)}${
        typeof outer.message === 'string' ? ` message=${JSON.stringify(outer.message)}` : ''
      }`,
    });
  }

  const raw = outer.data;
  // An empty day, an unknown id, a search with no matches: all of these come
  // back as an empty string or null rather than "[]".
  if (raw === null || raw === undefined || raw === '') return [];

  // Defensive: should the upstream ever stop double-encoding, accept an array.
  if (Array.isArray(raw)) return raw as RawRow[];

  if (typeof raw !== 'string') {
    throw new EtError({
      kind: 'invalid_shape',
      action,
      detail: `data field was ${typeof raw}, expected a JSON-encoded string`,
    });
  }

  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw new EtError({
      kind: 'invalid_shape',
      action,
      detail: 'the data field is not valid JSON once decoded',
    });
  }

  if (!Array.isArray(rows)) {
    throw new EtError({
      kind: 'invalid_shape',
      action,
      detail: `decoded data was ${typeof rows}, expected an array`,
    });
  }
  return rows as RawRow[];
}

/** Strip an endpoint's key prefix: `search_Pages` -> `Pages`. */
export function unprefix(row: RawRow, prefix: string): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.startsWith(prefix) ? k.slice(prefix.length) : k] = v;
  }
  return out;
}

export interface SplitRows {
  rows: RawRow[];
  /**
   * The stemmed form the index actually searched for, when the query had text.
   *
   * Worth surfacing: searching «τηλεργασία» is really searching `τηλεργασ`,
   * which is why hits can contain «τηλεργασίας» or look unrelated. Without
   * this a model cannot explain its own results.
   */
  stemmedQuery: string | null;
}

/**
 * Separate the trailing stemmed-query marker from the actual results.
 *
 * A text search appends a final element that is not a result at all, just
 * `{"search_stemmedQuery":"τηλεργασ"}`. Counting it as a hit inflates every
 * total by one and renders a blank row.
 */
export function popStemmedQuery(rows: readonly RawRow[], prefix = 'search_'): SplitRows {
  const key = `${prefix}stemmedQuery`;
  const last = rows[rows.length - 1];
  if (last && typeof last[key] === 'string' && Object.keys(last).length === 1) {
    return { rows: rows.slice(0, -1), stemmedQuery: last[key] as string };
  }
  return { rows: [...rows], stemmedQuery: null };
}
