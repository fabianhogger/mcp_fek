/**
 * Output shaped for a model reader.
 *
 * Never return raw upstream JSON: a gazette search can carry a thousand rows
 * with a 1 KB text extract on each, and the prefixed key names
 * (`search_PrimaryLabel`) are noise. Plain aligned text is the most compact
 * form a model reads reliably, and it keeps column meaning next to the value.
 */

export interface Column<T> {
  header: string;
  get: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
}

export function table<T>(rows: readonly T[], columns: ReadonlyArray<Column<T>>): string {
  if (rows.length === 0) return '(none)';
  const cells = rows.map((r) =>
    columns.map((c) => {
      const v = c.get(r);
      return v === null || v === undefined || v === '' ? '—' : String(v);
    }),
  );
  const widths = columns.map((c, i) =>
    Math.max(c.header.length, ...cells.map((row) => displayWidth(row[i] ?? ''))),
  );
  const line = (vals: string[]): string =>
    vals
      .map((v, i) => {
        const pad = widths[i]! - displayWidth(v);
        const spaces = ' '.repeat(Math.max(0, pad));
        return columns[i]!.align === 'right' ? spaces + v : v + spaces;
      })
      .join('  ')
      .trimEnd();

  return [line(columns.map((c) => c.header)), ...cells.map(line)].join('\n');
}

/** Greek text is single-width; this exists so padding stays honest if that changes. */
function displayWidth(s: string): number {
  return [...s].length;
}

/** A trailing note when a list was cut short, so the model knows to narrow. */
export function showing(shown: number, total: number): string | null {
  return total > shown ? `showing ${shown} of ${total}` : null;
}

export function joinSections(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join('\n\n');
}

/** A `key: value` block for the header of a single-document result. */
export function kv(pairs: ReadonlyArray<readonly [string, string | number | null | undefined]>): string {
  const rows = pairs.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${k.padEnd(width)}  ${String(v)}`).join('\n');
}

/** Collapse a text extract onto one line so it fits a table cell. */
export function oneLine(s: string | null | undefined, max = 160): string | null {
  if (!s) return null;
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

export function round(n: number | null | undefined, places = 5): number | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
