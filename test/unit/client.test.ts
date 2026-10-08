import { describe, expect, it } from 'vitest';
import { EtClient, Gate, type ClientOptions } from '../../src/et/client.js';
import { EtError } from '../../src/et/errors.js';
import type { HttpFetch } from '../../src/et/http.js';
import { asTransportError } from '../../src/et/http.js';
import { DEFAULT_API_ORIGIN, resolveOrigins } from '../../src/et/origins.js';
import { loadConfig } from '../../src/config.js';

const origins = resolveOrigins(loadConfig());
const ok = (body: string) => ({
  status: 200,
  contentType: 'application/json',
  body,
  headers: new Headers(),
});
const EMPTY = JSON.stringify({ status: 'ok', data: '[]' });

function client(fetchImpl: HttpFetch, opts: Partial<ClientOptions> = {}) {
  return new EtClient({
    origins,
    httpFetch: fetchImpl,
    minSpacingMs: 0,
    sleep: async () => {},
    random: () => 0.5,
    ...opts,
  });
}

describe('status mapping', () => {
  it('reads an HTML body as the origin having moved, and names the env var', async () => {
    // The failure that matters most: both upstream hostnames are undocumented
    // Azure resources. A JSON API served HTML means the host is no longer ours.
    const c = client(async () => ({
      status: 404,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body>Error 404 - Web app not found</body></html>',
      headers: new Headers(),
    }));
    await expect(c.post('/simplesearch', {})).rejects.toThrow(EtError);
    try {
      await c.post('/simplesearch', {});
    } catch (e) {
      const err = e as EtError;
      expect(err.kind).toBe('origin_moved');
      expect(err.userMessage).toContain('FEK_API_BASE_URL');
      expect(err.userMessage).toContain(new URL(DEFAULT_API_ORIGIN).host);
    }
  });

  it('names the real cause of searchbydate 400', async () => {
    // Upstream rejects any malformed date with a bare 400 and no useful body,
    // so relaying "HTTP 400" would tell a model nothing about what to fix.
    const c = client(async () => ({
      status: 400,
      contentType: 'application/json',
      body: '',
      headers: new Headers(),
    }));
    try {
      await c.post('/searchbydate', { datePublished: 'nope' });
      expect.unreachable();
    } catch (e) {
      const err = e as EtError;
      expect(err.kind).toBe('bad_date_format');
      expect(err.userMessage).toMatch(/YYYY-MM-DD/);
    }
  });

  it('classifies 5xx as retryable and 4xx as not', async () => {
    const server = client(async () => ({
      status: 503,
      contentType: 'application/json',
      body: '{}',
      headers: new Headers(),
    }));
    await expect(server.post('/simplesearch', {})).rejects.toMatchObject({
      kind: 'upstream_error',
    });

    const bad = client(async () => ({
      status: 422,
      contentType: 'application/json',
      body: '{}',
      headers: new Headers(),
    }));
    await expect(bad.post('/simplesearch', {})).rejects.toMatchObject({ kind: 'bad_request' });
  });

  it('maps 429 to rate_limited', async () => {
    const c = client(async () => ({
      status: 429,
      contentType: 'application/json',
      body: '',
      headers: new Headers(),
    }));
    await expect(c.post('/simplesearch', {})).rejects.toMatchObject({ kind: 'rate_limited' });
  });
});

describe('retries', () => {
  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    const c = client(async () => {
      calls++;
      if (calls < 3) {
        return { status: 500, contentType: 'application/json', body: '{}', headers: new Headers() };
      }
      return ok(EMPTY);
    });
    await expect(c.post('/simplesearch', {})).resolves.toEqual([]);
    expect(calls).toBe(3);
  });

  it('does not retry a failure we caused', async () => {
    let calls = 0;
    const c = client(async () => {
      calls++;
      return { status: 400, contentType: 'application/json', body: '{}', headers: new Headers() };
    });
    await expect(c.post('/simplesearch', {})).rejects.toMatchObject({ kind: 'bad_request' });
    expect(calls).toBe(1);
  });

  it('sleeps with full jitter, bounded by the cap', async () => {
    const waits: number[] = [];
    const c = client(
      async () => ({ status: 500, contentType: 'application/json', body: '{}', headers: new Headers() }),
      { sleep: async (ms: number) => void waits.push(ms), random: () => 1 },
    );
    await expect(c.post('/simplesearch', {})).rejects.toThrow();
    // Two retries after the first attempt. random()=1 is the worst case, so
    // these are the caps themselves: 300 * 2^0 and 300 * 2^1.
    expect(waits).toEqual([300, 600]);
  });
});

describe('DNS classification', () => {
  it('treats a failed lookup as the origin having moved', () => {
    const e = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const mapped = asTransportError(e, `${DEFAULT_API_ORIGIN}/api/years`);
    expect(mapped.kind).toBe('origin_moved');
  });

  it('treats a timeout as merely unreachable', () => {
    const e = Object.assign(new Error('timeout'), { name: 'AbortError' });
    expect(asTransportError(e, `${DEFAULT_API_ORIGIN}/api/years`).kind).toBe('unreachable');
  });
});

describe('Gate', () => {
  it('never runs more than the limit at once', async () => {
    const gate = new Gate(2, 0, async () => {}, () => 0);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        gate.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('spaces consecutive requests by the configured minimum', async () => {
    const waits: number[] = [];
    // A realistic clock, because a zero clock makes the very first call look
    // overdue and it waits a spacing it should not.
    let clock = 1_760_000_000_000;
    const gate = new Gate(1, 250, async (ms) => void waits.push(ms), () => clock);
    await gate.run(async () => {});
    expect(waits).toEqual([]);

    // A caller arriving immediately afterwards waits the full spacing.
    await gate.run(async () => {});
    expect(waits).toEqual([250]);

    // One arriving after the spacing has already elapsed waits not at all.
    clock += 250;
    await gate.run(async () => {});
    expect(waits).toEqual([250]);
  });
});
