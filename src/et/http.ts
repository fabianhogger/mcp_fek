import { USER_AGENT } from '../version.js';
import { EtError } from './errors.js';

/**
 * The HTTP floor.
 *
 * Deliberately global `fetch` rather than node:https. oasa-mcp hand-rolls
 * node:https for one reason — it dials a specific IP while pinning SNI to the
 * real hostname, to survive a DNS black hole. Nothing here needs that: Azure
 * resolves fine, and what we do need is POST with a JSON body and the ability
 * to stream a 9 MB PDF without buffering it twice. `HttpFetch` stays a type so
 * tests inject a fake, and the unit suite stubs global fetch to throw.
 */

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST' | 'HEAD';
  /** JSON body; serialised here so no caller has to remember the header. */
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  /** Refuse a response larger than this. Guards against HTML error pages. */
  maxBytes?: number | undefined;
  /** Return the raw bytes instead of decoded text. For PDFs. */
  binary?: boolean | undefined;
}

export interface HttpResponse {
  status: number;
  contentType: string | undefined;
  /** Decoded text. Empty for HEAD and for binary responses. */
  body: string;
  /** Set only when the request asked for binary. */
  bytes?: Uint8Array | undefined;
  headers: Headers;
}

export type HttpFetch = (req: HttpRequest) => Promise<HttpResponse>;

/** 4 MB is far more than any JSON response here; a bigger body is a mistake. */
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

function headersFor(method: HttpRequest['method']): Record<string, string> {
  const h: Record<string, string> = {
    // The site itself sends only this. No auth, no cookie, no nonce.
    Accept: 'application/json, text/plain, */*',
    'User-Agent': USER_AGENT,
  };
  if (method === 'POST') h['Content-Type'] = 'application/json';
  return h;
}

export const httpFetch: HttpFetch = async (req) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), req.timeoutMs);
  const onAbort = (): void => controller.abort(req.signal?.reason);
  req.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(req.url, {
      method: req.method,
      headers: headersFor(req.method),
      ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
      signal: controller.signal,
      redirect: 'follow',
      // The API is public and the SPA itself sends credentials: "omit".
      // Never attach ambient credentials to a third-party origin.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });

    const contentType = res.headers.get('content-type') ?? undefined;
    if (req.method === 'HEAD') {
      return { status: res.status, contentType, body: '', headers: res.headers };
    }

    const max = req.maxBytes ?? DEFAULT_MAX_BYTES;
    const declared = Number(res.headers.get('content-length') ?? '0');
    if (declared > max) {
      throw new EtError({
        kind: 'too_large',
        action: req.url,
        detail: `${declared} bytes exceeds the ${max} byte limit`,
      });
    }

    const bytes = await readCapped(res, max, req.url);
    if (req.binary === true) {
      return { status: res.status, contentType, body: '', bytes, headers: res.headers };
    }
    return {
      status: res.status,
      contentType,
      body: Buffer.from(bytes).toString('utf8'),
      headers: res.headers,
    };
  } catch (e) {
    if (e instanceof EtError) throw e;
    throw asTransportError(e, req.url);
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
};

/**
 * Read the body but stop at the cap.
 *
 * Streamed rather than buffered through `res.arrayBuffer()` because a single
 * Τεύχος Β issue can run to 888 pages, and the cap has to bite mid-download
 * rather than after the whole thing has arrived.
 */
async function readCapped(res: Response, max: number, url: string): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        throw new EtError({
          kind: 'too_large',
          action: url,
          detail: `response exceeded the ${max} byte limit mid-stream`,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Classify a thrown fetch failure.
 *
 * DNS failure is the signal that matters: if the Azure hostname stops
 * resolving it has almost certainly been renamed, which is a different
 * problem from the service being briefly down, and the message has to say so.
 */
export function asTransportError(e: unknown, url: string): EtError {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const code = err.cause?.code ?? '';
  const message = err.message ?? String(e);
  const host = safeHost(url);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new EtError({
      kind: 'origin_moved',
      action: url,
      host,
      detail: `DNS lookup failed (${code})`,
    });
  }
  if (err.name === 'AbortError' || /timeout/i.test(message)) {
    return new EtError({ kind: 'unreachable', action: url, host, detail: 'request timed out' });
  }
  return new EtError({ kind: 'unreachable', action: url, host, detail: message });
}

function safeHost(url: string): string | undefined {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
