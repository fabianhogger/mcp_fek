import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Cache } from '../../src/cache.js';
import { loadConfig, type Config } from '../../src/config.js';
import { EtClient } from '../../src/et/client.js';
import type { HttpFetch } from '../../src/et/http.js';
import { resolveOrigins } from '../../src/et/origins.js';
import { silentLogger } from '../../src/logger.js';
import { PdfPipeline } from '../../src/pdf/pipeline.js';
import { createServer } from '../../src/server.js';
import { mockHttpFetch, type MockOptions } from './fixtures.js';
import { hasPdf, pdfPath } from './pdf-fixtures.js';

/**
 * Fixed instant: 2026-10-07 18:30 Europe/Athens, i.e. the evening of a weekday
 * on which the gazette listing is complete. Several behaviours depend on
 * whether "now" is the same day as a listing, so the clock is pinned.
 */
export const FIXED_NOW = Date.parse('2026-10-07T15:30:00Z');
/** The same day at 11:00 Athens, when the listing is still filling. */
export const MORNING_NOW = Date.parse('2026-10-07T08:00:00Z');

export interface TestServer {
  client: Client;
  calls: string[];
  close: () => Promise<void>;
}

/**
 * A full MCP client+server pair driven from recorded fixtures.
 *
 * Exercising the real protocol rather than calling handlers directly is what
 * catches schema-generation problems: a tool can work perfectly in-process and
 * still be uncallable because its JSON Schema came out empty.
 */
export async function makeTestServer(
  opts: {
    now?: number;
    failures?: MockOptions['failures'];
    overrides?: MockOptions['overrides'];
    /** Turn off PDF extraction, as FEK_PDF_TEXT=0 does in production. */
    pdfText?: boolean;
  } = {},
): Promise<TestServer> {
  const calls: string[] = [];
  const httpFetch: HttpFetch = mockHttpFetch({
    calls,
    ...(opts.failures ? { failures: opts.failures } : {}),
    ...(opts.overrides ? { overrides: opts.overrides } : {}),
  });

  const config: Config = {
    ...loadConfig(),
    // Never write an extracted-text cache from a test run.
    pdfCacheMb: 0,
    pdfText: opts.pdfText ?? true,
  };
  const now = (): number => opts.now ?? FIXED_NOW;

  const etClient = new EtClient({
    origins: resolveOrigins(config),
    httpFetch,
    minSpacingMs: 0,
    sleep: async () => {},
    random: () => 0.1,
    now,
  });

  const { server } = createServer({
    config,
    client: etClient,
    pdf: new PdfPipeline({
      client: etClient,
      config,
      logger: silentLogger,
      fetchImpl: localPdfFetch(calls),
    }),
    cache: new Cache({ disableDisk: true }),
    logger: silentLogger,
    now,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

  return {
    client,
    calls,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Call a tool and return its rendered text plus structured payload. */
export async function callTool(
  srv: TestServer,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; structured: Record<string, unknown>; isError: boolean }> {
  const res = await srv.client.callTool({ name, arguments: args });
  const text =
    (res.content as Array<{ type: string; text?: string }> | undefined)
      ?.map((c) => c.text ?? '')
      .join('\n') ?? '';
  return {
    text,
    structured: (res.structuredContent ?? {}) as Record<string, unknown>,
    isError: res.isError === true,
  };
}

/**
 * Serve PDFs from the local fixture directory.
 *
 * The PDFs are gitignored, so a caller that has not run `npm run fetch:pdfs`
 * gets a 404 — which is the same path a genuinely missing issue takes, so the
 * degraded behaviour is still exercised rather than the test exploding.
 */
function localPdfFetch(calls: string[]): HttpFetch {
  return async (req) => {
    calls.push(req.url);
    const id = /\/(\d{11})\.pdf$/.exec(req.url)?.[1];
    if (!id || !hasPdf(id)) {
      return {
        status: 404,
        contentType: 'application/xml',
        body: '',
        headers: new Headers(),
      };
    }
    const bytes = new Uint8Array(readFileSync(pdfPath(id)));
    return {
      status: 200,
      contentType: 'application/pdf',
      body: '',
      bytes,
      headers: new Headers(),
    };
  };
}
