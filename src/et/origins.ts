import type { Config } from '../config.js';
import { pdfPath, type FekRef } from '../fek/ids.js';

/**
 * The two upstream origins, and the only file in src/ allowed to name them.
 *
 * search.et.gr is a React shell; the HTML contains nothing but a mount point.
 * The data comes from an Azure App Service, and the PDFs from an Azure blob
 * container. Neither hostname is documented, promised, or ours — they are
 * deployment details of somebody else's infrastructure that happen to be
 * publicly reachable, and a rename would break every tool at once.
 *
 * Containing that risk is the entire point of this module:
 *   - the strings appear exactly once, so there is one place to change;
 *   - both are overridable by environment variable, so the fix needs no release;
 *   - looksLikeOriginMoved() turns the failure into a message that names the
 *     dead host and the variable that overrides it, instead of a bare 404;
 *   - test/unit/hygiene.test.ts greps src/ and fails if either hostname
 *     appears anywhere else, so the boundary is enforced rather than merely
 *     intended.
 */

export const DEFAULT_API_ORIGIN = 'https://searchetv99.azurewebsites.net';
export const DEFAULT_BLOB_ORIGIN = 'https://ia37rg02wpsa01.blob.core.windows.net';

/** The public site, for links a human may want to click. */
export const SITE_ORIGIN = 'https://search.et.gr';

export const API_ENV_VAR = 'FEK_API_BASE_URL';
export const BLOB_ENV_VAR = 'FEK_BLOB_BASE_URL';

export interface Origins {
  api: string;
  blob: string;
  apiOverridden: boolean;
  blobOverridden: boolean;
}

export function resolveOrigins(config: Config): Origins {
  return {
    api: config.apiBaseUrl ?? DEFAULT_API_ORIGIN,
    blob: config.blobBaseUrl ?? DEFAULT_BLOB_ORIGIN,
    apiOverridden: config.apiBaseUrl !== undefined,
    blobOverridden: config.blobBaseUrl !== undefined,
  };
}

/**
 * Build an API URL.
 *
 * Path parameters are appended as slash-joined segments, which is what the
 * site's own `getUrlWithParams` does: `/documententitybyid/806565`, not a
 * query string.
 */
export function apiUrl(
  origins: Origins,
  endpoint: string,
  ...path: ReadonlyArray<string | number>
): string {
  const base = `${origins.api}/api${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
  if (path.length === 0) return base;
  return `${base}/${path.map((p) => encodeURIComponent(String(p))).join('/')}`;
}

export function pdfUrl(origins: Origins, ref: FekRef): string {
  return `${origins.blob}/${pdfPath(ref)}`;
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Does this response mean the host is no longer our API?
 *
 * A JSON API is never legitimately served HTML here, so an HTML body is the
 * tell. In practice a decommissioned Azure App Service answers with its own
 * branded error page, and a renamed one stops resolving entirely (handled as
 * `unreachable` in the client).
 */
export function looksLikeOriginMoved(
  status: number,
  contentType: string | undefined,
  body: string,
): boolean {
  const html =
    (contentType ?? '').toLowerCase().includes('text/html') ||
    /^\s*<(?:!doctype|html)/i.test(body);
  if (!html) return false;
  if (status === 404 || status === 403 || status === 503) return true;
  // An HTML 200 from a JSON endpoint is the Azure default page.
  return status === 200;
}
