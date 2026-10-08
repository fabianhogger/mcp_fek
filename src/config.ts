import type { LogLevel } from './logger.js';

/**
 * Configuration, all of it from the environment and all of it optional.
 *
 * The two origin overrides are the important ones. Both upstream hostnames are
 * undocumented Azure resources (see src/et/origins.ts); if either is renamed,
 * setting the matching variable is the whole fix, and no code change is needed.
 */
export interface Config {
  apiBaseUrl: string | undefined;
  blobBaseUrl: string | undefined;
  timeoutMs: number;
  pdfTimeoutMs: number;
  maxConcurrency: number;
  minSpacingMs: number;
  pdfMaxBytes: number;
  /** When false the PDF pipeline is never loaded; snippets are the only text source. */
  pdfText: boolean;
  pdfCacheMb: number;
  /** Per-call ceiling on documententitybyid fan-out when filling in titles. */
  maxEnrich: number;
  disableDiskCache: boolean;
  cacheDir: string | undefined;
  logLevel: LogLevel;
}

export function intEnv(key: string, dflt: number, min: number, max: number): number {
  const raw = process.env[key];
  if (!raw) return dflt;
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function boolEnv(key: string, dflt = false): boolean {
  const v = process.env[key];
  if (v === undefined || v.trim() === '') return dflt;
  const s = v.toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return dflt;
}

export function listEnv(key: string): readonly string[] | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return parts.length > 0 ? parts : undefined;
}

/** Reject anything that is not an https origin, so an override cannot downgrade TLS. */
function originEnv(key: string): string | undefined {
  const raw = process.env[key]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} is not a valid URL: ${JSON.stringify(raw)}`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`${key} must be an https:// origin, got ${url.protocol}//`);
  }
  // Keep only the origin; a path here would silently break URL construction.
  return url.origin;
}

export function loadConfig(): Config {
  const level = (process.env['FEK_LOG_LEVEL'] ?? 'info').toLowerCase();
  const logLevel: LogLevel = (
    ['debug', 'info', 'warn', 'error', 'silent'] as const
  ).includes(level as LogLevel)
    ? (level as LogLevel)
    : 'info';

  return Object.freeze({
    apiBaseUrl: originEnv('FEK_API_BASE_URL'),
    blobBaseUrl: originEnv('FEK_BLOB_BASE_URL'),
    timeoutMs: intEnv('FEK_TIMEOUT_MS', 15_000, 1000, 120_000),
    pdfTimeoutMs: intEnv('FEK_PDF_TIMEOUT_MS', 120_000, 5000, 600_000),
    maxConcurrency: intEnv('FEK_MAX_CONCURRENCY', 2, 1, 8),
    minSpacingMs: intEnv('FEK_MIN_SPACING_MS', 250, 0, 10_000),
    pdfMaxBytes: intEnv('FEK_PDF_MAX_BYTES', 120_000_000, 100_000, 1_000_000_000),
    pdfText: boolEnv('FEK_PDF_TEXT', true),
    pdfCacheMb: intEnv('FEK_PDF_CACHE_MB', 256, 0, 8192),
    maxEnrich: intEnv('FEK_MAX_ENRICH', 10, 0, 100),
    disableDiskCache: boolEnv('FEK_NO_DISK_CACHE'),
    cacheDir: process.env['FEK_CACHE_DIR'] || undefined,
    logLevel,
  });
}
