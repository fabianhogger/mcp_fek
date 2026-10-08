/**
 * The upstream's failure modes, each reduced to one sentence a model can act on.
 *
 * `origin_moved` is the one that matters most. Both upstream hostnames are
 * undocumented Azure resources that nobody promised to keep; if either is
 * renamed, every tool fails at once and the only useful thing the server can
 * do is say which host died and which environment variable overrides it.
 */
export type EtErrorKind =
  /** DNS or TCP failure: the host did not answer at all. */
  | 'unreachable'
  /** The host answered, but not as this API — almost certainly renamed. */
  | 'origin_moved'
  /** 5xx, 408, 425. Worth retrying. */
  | 'upstream_error'
  /** 429, or an explicit Retry-After. */
  | 'rate_limited'
  /** 4xx we caused. Not worth retrying with the same arguments. */
  | 'bad_request'
  /** The date was not YYYY-MM-DD; the API answers that with a bare 400. */
  | 'bad_date_format'
  /** Valid JSON of an unexpected shape, or a `data` field that will not parse. */
  | 'invalid_shape'
  /** The PDF exceeded the configured size cap. */
  | 'too_large';

export interface EtErrorOptions {
  kind: EtErrorKind;
  /** Which upstream call failed, for the log line. */
  action: string;
  status?: number | undefined;
  retryAfterSeconds?: number | undefined;
  /** Short technical detail; never a stack trace. */
  detail?: string | undefined;
  /** The hostname involved, for origin_moved. */
  host?: string | undefined;
  /** Which env var overrides that host. */
  envVar?: string | undefined;
}

export class EtError extends Error {
  readonly kind: EtErrorKind;
  readonly action: string;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly detail: string | undefined;
  readonly host: string | undefined;
  readonly envVar: string | undefined;

  constructor(options: EtErrorOptions) {
    super(`${options.kind} in ${options.action}${options.detail ? `: ${options.detail}` : ''}`);
    this.name = 'EtError';
    this.kind = options.kind;
    this.action = options.action;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.detail = options.detail;
    this.host = options.host;
    this.envVar = options.envVar;
  }

  /** One actionable sentence, aimed at a model deciding what to do next. */
  get userMessage(): string {
    switch (this.kind) {
      case 'unreachable':
        return (
          `Could not reach the Εθνικό Τυπογραφείο search backend${this.host ? ` at ${this.host}` : ''}. ` +
          'This is usually a transient network fault; retry once before concluding the data is unavailable.'
        );
      case 'origin_moved':
        return (
          `${this.host ?? 'The upstream host'} answered, but not as the gazette search API. ` +
          'That service runs on undocumented Azure hostnames which can be renamed without notice. ' +
          `Find the current origin in the network tab of https://search.et.gr and set ${this.envVar ?? 'FEK_API_BASE_URL'}, ` +
          'or retry later if the service is simply down.'
        );
      case 'upstream_error':
        return (
          `The gazette search backend returned a server error${this.status ? ` (HTTP ${this.status})` : ''}. ` +
          'It is intermittently slow under load; retrying shortly usually works.'
        );
      case 'rate_limited':
        return (
          'The gazette search backend is rate limiting this client' +
          `${this.retryAfterSeconds ? `; wait ${this.retryAfterSeconds}s before retrying` : '; wait before retrying'}.`
        );
      case 'bad_date_format':
        return (
          'The gazette listing accepts only an exact YYYY-MM-DD date and rejects anything else ' +
          `with a generic error${this.detail ? ` (${this.detail})` : ''}. Reformat the date and call again.`
        );
      case 'bad_request':
        return (
          `The gazette search backend rejected these arguments${this.status ? ` (HTTP ${this.status})` : ''}` +
          `${this.detail ? `: ${this.detail}` : ''}. Retrying unchanged will fail the same way.`
        );
      case 'invalid_shape':
        return (
          'The gazette search backend returned a response this server does not recognise' +
          `${this.detail ? ` (${this.detail})` : ''}. The undocumented API may have changed shape.`
        );
      case 'too_large':
        return (
          `That gazette issue is too large to download under the current limit${this.detail ? ` (${this.detail})` : ''}. ` +
          'Raise FEK_PDF_MAX_BYTES, or use the PDF link directly instead of extracted text.'
        );
    }
  }
}

export function isRetryable(e: unknown): boolean {
  if (!(e instanceof EtError)) return false;
  return e.kind === 'unreachable' || e.kind === 'upstream_error' || e.kind === 'rate_limited';
}
