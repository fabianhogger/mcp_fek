import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HttpFetch, HttpRequest } from '../../src/et/http.js';
import { fixtureKey, FIXTURE_DIR, type Manifest } from './fixture-key.js';

const manifest = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'manifest.json'), 'utf8'),
) as Manifest;

export function fixtureBody(key: string): string {
  const entry = manifest[key];
  if (!entry) {
    throw new Error(
      `no fixture for ${key}\nknown keys:\n  ${Object.keys(manifest).join('\n  ')}\n` +
        'Run `npm run record` after adding a target to scripts/record-fixtures.ts.',
    );
  }
  return readFileSync(join(FIXTURE_DIR, entry.file), 'utf8');
}

/** Turn a request URL back into the endpoint + path the fixture key uses. */
function keyFor(req: HttpRequest): string {
  const path = new URL(req.url).pathname.replace(/^\/api/, '');
  const segments = path.split('/').filter((s) => s !== '');
  const endpoint = `/${segments[0] ?? ''}`;
  const rest = segments.slice(1).map((s) => decodeURIComponent(s));
  return fixtureKey(endpoint, rest, req.body);
}

export interface MockOptions {
  /** Scripted failures, consumed in order before any fixture is served. */
  failures?: Array<{ status: number; body?: string; contentType?: string } | Error>;
  /** Every request URL, in order, for asserting call counts. */
  calls?: string[];
  /** Serve these keys from inline bodies instead of a recorded file. */
  overrides?: Record<string, string>;
}

/**
 * An HttpFetch backed by recorded fixtures.
 *
 * Keyed on endpoint plus a hash of the request body, so a POST's arguments
 * select the fixture — which is the only way to tell a text search from a
 * by-number search when both hit /simplesearch.
 */
export function mockHttpFetch(opts: MockOptions = {}): HttpFetch {
  const failures = [...(opts.failures ?? [])];
  return async (req) => {
    opts.calls?.push(req.url);

    const failure = failures.shift();
    if (failure) {
      if (failure instanceof Error) throw failure;
      return {
        status: failure.status,
        contentType: failure.contentType ?? 'application/json',
        body: failure.body ?? '',
        headers: new Headers(),
      };
    }

    const key = keyFor(req);
    const body = opts.overrides?.[key] ?? fixtureBody(key);
    return {
      status: 200,
      contentType: 'application/json',
      body,
      headers: new Headers(),
    };
  };
}
