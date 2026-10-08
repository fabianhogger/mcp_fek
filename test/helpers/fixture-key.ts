import { createHash } from 'node:crypto';
import { join } from 'node:path';

export const FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'api');

export interface ManifestEntry {
  file: string;
  /** Why this fixture exists, so nobody deletes it as redundant. */
  why: string;
}
export type Manifest = Record<string, ManifestEntry>;

/**
 * Identify a request by endpoint plus its arguments.
 *
 * The body is canonicalised with sorted keys so a differently-ordered but
 * equivalent body still selects the same fixture.
 */
export function fixtureKey(
  endpoint: string,
  path: ReadonlyArray<string | number>,
  body: unknown,
): string {
  const parts = [endpoint, ...path.map(String)].join('/');
  if (body === undefined) return parts;
  const hash = createHash('sha256').update(canonical(body)).digest('hex').slice(0, 12);
  return `${parts}|${hash}`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
