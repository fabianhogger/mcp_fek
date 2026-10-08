import { EtError } from './errors.js';
import { httpFetch, type HttpFetch } from './http.js';

/**
 * Downloading a gazette PDF.
 *
 * Streamed with a hard byte cap rather than buffered, because the size range
 * is extreme: the median Τεύχος Β issue is six pages, but a single issue can
 * run to 888 pages and a law to 9.4 MB. The cap is checked against
 * Content-Length first and then again mid-stream, because a server is free to
 * understate or omit it.
 *
 * Separate from src/et/client.ts because this is a different origin with
 * different characteristics: megabyte responses, no JSON envelope, and its own
 * stricter concurrency gate.
 */

export interface DownloadOptions {
  url: string;
  maxBytes: number;
  timeoutMs: number;
  fetchImpl?: HttpFetch;
}

export async function downloadPdf(opts: DownloadOptions): Promise<Uint8Array> {
  const fetchImpl = opts.fetchImpl ?? httpFetch;
  const res = await fetchImpl({
    url: opts.url,
    method: 'GET',
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes,
    binary: true,
  });

  if (res.status === 404) {
    throw new EtError({
      kind: 'bad_request',
      action: 'downloadPdf',
      status: 404,
      detail: 'no PDF exists at that path, so the issue reference is probably wrong',
    });
  }
  if (res.status !== 200 || !res.bytes) {
    throw new EtError({
      kind: res.status >= 500 ? 'upstream_error' : 'bad_request',
      action: 'downloadPdf',
      status: res.status,
    });
  }

  // A PDF always starts %PDF-. Anything else means we were served an error
  // page or a redirect target, and handing it to the parser wastes seconds
  // before failing less clearly.
  const header = Buffer.from(res.bytes.slice(0, 5)).toString('latin1');
  if (header !== '%PDF-') {
    throw new EtError({
      kind: 'invalid_shape',
      action: 'downloadPdf',
      detail: `expected a PDF, got ${JSON.stringify(header)}`,
    });
  }

  return res.bytes;
}
