import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Cache } from './cache.js';
import { loadConfig, type Config } from './config.js';
import { EtActions } from './et/actions.js';
import { EtClient } from './et/client.js';
import { EtError } from './et/errors.js';
import { resolveOrigins } from './et/origins.js';
import { NOT_CONSOLIDATED_LAW } from './fek/disclaimer.js';
import { createLogger, type Logger } from './logger.js';
import { PdfPipeline } from './pdf/pipeline.js';
import { TOOLS } from './tools/index.js';
import type { ToolContext, ToolDef } from './tools/types.js';
import { VERSION } from './version.js';

export interface CreateServerOptions {
  config?: Config;
  logger?: Logger;
  /** Overridable so tests can drive the whole server from fixtures. */
  client?: EtClient;
  /** Injected separately in tests, which serve PDFs from local fixtures. */
  pdf?: PdfPipeline;
  cache?: Cache;
  now?: () => number;
}

export interface CreatedServer {
  server: McpServer;
  context: ToolContext;
}

const INSTRUCTIONS =
  'Search and retrieve the Greek Government Gazette (ΦΕΚ) published by the Εθνικό ' +
  'Τυπογραφείο: laws, presidential decrees, ministerial decisions, appointments, ' +
  'ΑΣΕΠ announcements and company filings, across every issue series from 1833. ' +
  'Queries and names work in Greek or Latin characters. ' +
  'To turn a reference like «ΦΕΚ Β\' 1234/2024» or «Ν. 5324/2026» into a document, ' +
  'call resolve_citation — it parses the reference and returns the issue with a PDF link. ' +
  'search_fek is full-text over the body of the acts, but it returns whole issues: ' +
  'a Τεύχος Β issue holds a dozen unrelated acts, so follow a hit with get_fek to see ' +
  'which act inside it matched. The full-text index does not reach before 1992, and ' +
  'issues older than roughly 2000 are scanned images with no extractable text — in ' +
  'those cases the metadata and the PDF link are the whole answer, and get_fek says so ' +
  'via text_source. ' +
  `Most importantly: ${NOT_CONSOLIDATED_LAW}`;

/**
 * Decorate a tool description with the law-currency warning.
 *
 * Done here rather than in each tool so that a new law-returning tool cannot
 * ship without it: the flag is the only switch, and policy.test.ts asserts
 * which tools carry it.
 */
function describe(tool: ToolDef): string {
  return tool.returnsLaw ? `${tool.description} ${NOT_CONSOLIDATED_LAW}` : tool.description;
}

export function createServer(options: CreateServerOptions = {}): CreatedServer {
  const config = options.config ?? loadConfig();
  const logger = options.logger ?? createLogger(config.logLevel);

  const now = options.now ?? Date.now;

  const client =
    options.client ??
    new EtClient({
      origins: resolveOrigins(config),
      logger,
      timeoutMs: config.timeoutMs,
      maxConcurrency: config.maxConcurrency,
      minSpacingMs: config.minSpacingMs,
      now,
    });

  const cache =
    options.cache ?? new Cache({ dir: config.cacheDir, disableDisk: config.disableDiskCache });

  const context: ToolContext = {
    actions: new EtActions(client, logger),
    pdf: options.pdf ?? new PdfPipeline({ client, config, logger }),
    cache,
    logger,
    config,
    now,
  };

  const server = new McpServer(
    { name: 'mcp-fek', version: VERSION },
    { instructions: INSTRUCTIONS },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: describe(tool),
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.handler(args ?? {}, context);
          // The warning rides along on every successful law result, in both
          // channels, because a model may read either one.
          const attach = tool.returnsLaw === true && result.isError !== true;
          return {
            content: [
              {
                type: 'text' as const,
                text: attach ? `${result.text}\n\n${NOT_CONSOLIDATED_LAW}` : result.text,
              },
            ],
            structuredContent: attach
              ? { ...result.structured, law_currency_warning: NOT_CONSOLIDATED_LAW }
              : result.structured,
            ...(result.isError ? { isError: true } : {}),
          };
        } catch (e) {
          // Upstream failures become one actionable sentence, never a trace.
          const message =
            e instanceof EtError
              ? e.userMessage
              : `Unexpected failure in ${tool.name}: ${(e as Error).message}`;
          logger.warn(`${tool.name} failed`, (e as Error).message);
          return {
            content: [{ type: 'text' as const, text: message }],
            structuredContent: {
              status: 'error',
              kind: e instanceof EtError ? e.kind : 'internal',
            },
            isError: true,
          };
        }
      },
    );
  }

  return { server, context };
}
