import type { Logger } from '../logger.js';
import { EtError, isRetryable } from './errors.js';
import { unwrap, type RawRow } from './envelope.js';
import { httpFetch, type HttpFetch } from './http.js';
import {
  API_ENV_VAR,
  apiUrl,
  BLOB_ENV_VAR,
  hostOf,
  looksLikeOriginMoved,
  type Origins,
} from './origins.js';

export interface ClientOptions {
  origins: Origins;
  httpFetch?: HttpFetch;
  logger?: Logger;
  timeoutMs?: number;
  retries?: number;
  maxConcurrency?: number;
  minSpacingMs?: number;
  /** Injectable for deterministic backoff in tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * A FIFO gate limiting in-flight requests, plus a minimum spacing between them.
 *
 * The gazette backend documents no rate limit and has never been seen to
 * return 429 — which is exactly why this is pessimistic. It is one Azure App
 * Service serving a public site, and `latest_issues` over a two-week window
 * plus title enrichment can issue two dozen requests for one tool call.
 * Sharing one gate across every caller means no single call can flood it.
 */
export class Gate {
  private active = 0;
  private lastStart = 0;
  private readonly queue: Array<() => void> = [];

  constructor(
    private readonly limit: number,
    private readonly minSpacingMs: number,
    private readonly sleep: (ms: number) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      const wait = this.lastStart + this.minSpacingMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class EtClient {
  readonly origins: Origins;
  private readonly fetchImpl: HttpFetch;
  private readonly logger: Logger | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly random: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  /** JSON requests. */
  private readonly apiGate: Gate;
  /** PDFs. Megabyte responses, so stricter: one at a time. */
  private readonly blobGate: Gate;

  constructor(options: ClientOptions) {
    this.origins = options.origins;
    this.fetchImpl = options.httpFetch ?? httpFetch;
    this.logger = options.logger;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.retries = options.retries ?? 2;
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? Date.now;
    this.apiGate = new Gate(
      options.maxConcurrency ?? 2,
      options.minSpacingMs ?? 250,
      this.sleep,
      this.now,
    );
    this.blobGate = new Gate(1, Math.max(options.minSpacingMs ?? 250, 500), this.sleep, this.now);
  }

  /** POST an endpoint and return its decoded rows. */
  async post(endpoint: string, body: unknown): Promise<RawRow[]> {
    const url = apiUrl(this.origins, endpoint);
    const res = await this.request(endpoint, { url, method: 'POST', body });
    return unwrap(res, endpoint);
  }

  /** GET an endpoint whose argument is a path segment. */
  async get(endpoint: string, ...path: ReadonlyArray<string | number>): Promise<RawRow[]> {
    const url = apiUrl(this.origins, endpoint, ...path);
    const res = await this.request(endpoint, { url, method: 'GET' });
    return unwrap(res, endpoint);
  }

  /** Run something against the blob origin under the stricter gate. */
  async blob<T>(fn: () => Promise<T>): Promise<T> {
    return await this.blobGate.run(fn);
  }

  private async request(
    action: string,
    req: { url: string; method: 'GET' | 'POST'; body?: unknown },
  ): Promise<string> {
    let lastError: unknown;
    // Bound total time so a retry loop can never outlive a client's patience.
    const deadline = this.now() + this.timeoutMs * 2.5;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        if (this.now() >= deadline) break;
        // Full jitter: spreads retries so a recovering server is not
        // re-hammered in lockstep by every client at once.
        const cap = Math.min(4000, 300 * 2 ** (attempt - 1));
        const wait =
          lastError instanceof EtError && lastError.retryAfterSeconds !== undefined
            ? lastError.retryAfterSeconds * 1000
            : Math.floor(this.random() * cap);
        await this.sleep(wait);
      }

      try {
        return await this.apiGate.run(async () => {
          const res = await this.fetchImpl({
            url: req.url,
            method: req.method,
            ...(req.body !== undefined ? { body: req.body } : {}),
            timeoutMs: this.timeoutMs,
          });
          this.assertOk(action, res.status, res.contentType, res.body);
          return res.body;
        });
      } catch (e) {
        lastError = e;
        if (!isRetryable(e)) throw e;
        this.logger?.debug(`${action} attempt ${attempt + 1} failed`, (e as Error).message);
      }
    }

    throw lastError instanceof EtError
      ? lastError
      : new EtError({ kind: 'unreachable', action, detail: String(lastError) });
  }

  private assertOk(
    action: string,
    status: number,
    contentType: string | undefined,
    body: string,
  ): void {
    // Check this before the status, because the tell is the HTML body: a
    // decommissioned App Service answers with its own branded page, and a JSON
    // API is never legitimately served HTML here.
    if (looksLikeOriginMoved(status, contentType, body)) {
      throw new EtError({
        kind: 'origin_moved',
        action,
        status,
        host: hostOf(this.origins.api),
        envVar: API_ENV_VAR,
        detail: `HTML response (HTTP ${status}) from a JSON endpoint`,
      });
    }

    if (status === 429) {
      throw new EtError({
        kind: 'rate_limited',
        action,
        status,
        retryAfterSeconds: undefined,
      });
    }
    if (status === 400 && action.includes('searchbydate')) {
      // The listing endpoint answers any malformed date with a bare 400 and no
      // body worth reading, so name the real cause rather than relaying it.
      throw new EtError({
        kind: 'bad_date_format',
        action,
        status,
        detail: 'the date must be exactly YYYY-MM-DD',
      });
    }
    if (status >= 500 || status === 408 || status === 425) {
      throw new EtError({ kind: 'upstream_error', action, status });
    }
    if (status < 200 || status >= 300) {
      throw new EtError({ kind: 'bad_request', action, status });
    }
  }
}

/** Which env var overrides the origin that produced this error. */
export function envVarFor(kind: 'api' | 'blob'): string {
  return kind === 'api' ? API_ENV_VAR : BLOB_ENV_VAR;
}
