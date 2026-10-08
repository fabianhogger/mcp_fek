#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { EtActions } from './et/actions.js';
import { EtClient } from './et/client.js';
import { httpFetch } from './et/http.js';
import { API_ENV_VAR, BLOB_ENV_VAR, pdfUrl, resolveOrigins } from './et/origins.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';
import { TOOLS } from './tools/index.js';
import { VERSION } from './version.js';

/**
 * CLI entry point. The only file that touches process state or stdio.
 *
 * stdout belongs to the JSON-RPC transport. Every diagnostic goes to stderr;
 * a single stray write to stdout corrupts the protocol stream.
 */

const HELP = `mcp-fek ${VERSION}

An MCP server for the Greek Government Gazette (ΦΕΚ, Εθνικό Τυπογραφείο):
search issues, resolve citations, fetch PDFs and extract article text.

Usage
  fek-mcp                  run the server over stdio (what an MCP client does)
  fek-mcp --self-test      check both upstream origins and list the tools, then exit
  fek-mcp --version
  fek-mcp --help

Environment
  ${API_ENV_VAR}        override the search backend origin
  ${BLOB_ENV_VAR}       override the PDF blob origin
  FEK_TIMEOUT_MS           per-request timeout (default 15000)
  FEK_PDF_TIMEOUT_MS       per-PDF-download timeout (default 120000)
  FEK_MAX_CONCURRENCY      in-flight upstream requests (default 2)
  FEK_MIN_SPACING_MS       minimum gap between requests (default 250)
  FEK_PDF_MAX_BYTES        refuse larger PDFs (default 120000000)
  FEK_PDF_TEXT=0           disable PDF text extraction entirely
  FEK_PDF_CACHE_MB         budget for extracted text (default 256)
  FEK_MAX_ENRICH           per-call title lookups (default 10)
  FEK_NO_DISK_CACHE=1      keep the cache in memory only
  FEK_CACHE_DIR            where to persist the cache
  FEK_LOG_LEVEL            debug | info | warn | error | silent

Client configuration
  {
    "mcpServers": {
      "fek": { "command": "npx", "args": ["-y", "mcp-fek"] }
    }
  }

No API key is needed; the gazette search backend is public.
`;

/**
 * Check both upstream origins and report which one is broken.
 *
 * Worth doing properly rather than printing a banner: the two hostnames are
 * undocumented Azure resources, they fail independently, and when one is
 * renamed every tool stops working at once. One command should say which.
 */
async function selfTest(): Promise<number> {
  const config = loadConfig();
  const out = (s: string): void => {
    process.stderr.write(`${s}\n`);
  };

  out(`mcp-fek ${VERSION}`);
  out('');
  out(`tools (${TOOLS.length}):`);
  for (const t of TOOLS) out(`  ${t.name.padEnd(18)} ${t.title}`);
  out('');

  const origins = resolveOrigins(config);
  out(`api  ${origins.api}${origins.apiOverridden ? `  (overridden by ${API_ENV_VAR})` : ''}`);
  out(`blob ${origins.blob}${origins.blobOverridden ? `  (overridden by ${BLOB_ENV_VAR})` : ''}`);
  out('');

  let failed = false;

  // The cheapest call that proves the search backend is itself: a by-number
  // lookup of a known issue. It exercises the double-decoded envelope too, so
  // a response that is merely HTTP 200 does not pass.
  const actions = new EtActions(
    new EtClient({ origins, httpFetch, timeoutMs: config.timeoutMs, logger: createLogger('silent') }),
  );
  try {
    const { hits } = await actions.simpleSearch({
      years: [2026],
      issueGroups: [1],
      documentNumber: '121',
    });
    out(`api  OK — resolved ${hits[0]?.label ?? 'no rows'} (${hits.length} row(s))`);
  } catch (e) {
    failed = true;
    out(`api  FAILED — ${(e as Error).message}`);
    out('');
    out('  The gazette search API is undocumented and runs on an Azure hostname that can');
    out(`  be renamed without notice. Find the current origin in the network tab of`);
    out(`  https://search.et.gr and set ${API_ENV_VAR}.`);
  }

  // A HEAD against an issue that has existed since 1985 and will not change.
  try {
    const url = pdfUrl(origins, { year: 2026, issueGroup: 1, number: 121 });
    const res = await httpFetch({ url, method: 'HEAD', timeoutMs: config.timeoutMs });
    if (res.status === 200) {
      out(`blob OK — ${url} responds 200`);
    } else {
      failed = true;
      out(`blob FAILED — HTTP ${res.status} for ${url}`);
      out(`  Set ${BLOB_ENV_VAR} if the PDF storage origin has moved.`);
    }
  } catch (e) {
    failed = true;
    out(`blob FAILED — ${(e as Error).message}`);
    out(`  Set ${BLOB_ENV_VAR} if the PDF storage origin has moved.`);
  }

  out('');
  out(config.pdfText ? 'pdf  text extraction enabled' : 'pdf  text extraction disabled (FEK_PDF_TEXT=0)');
  out('');
  out(failed ? 'self-test FAILED' : 'self-test OK');
  return failed ? 1 : 0;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    process.stderr.write(HELP);
    return;
  }
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stderr.write(`${VERSION}\n`);
    return;
  }
  if (argv.includes('--self-test')) {
    process.exitCode = await selfTest();
    return;
  }

  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const { server } = createServer({ config, logger });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info(`mcp-fek ${VERSION} ready on stdio`);
}

// Never let a crash write to stdout: the client is parsing it as JSON-RPC.
process.on('uncaughtException', (e) => {
  process.stderr.write(`[mcp-fek] fatal: ${e.stack ?? e.message}\n`);
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  process.stderr.write(`[mcp-fek] fatal: ${String(e)}\n`);
  process.exit(1);
});

main().catch((e: unknown) => {
  process.stderr.write(`[mcp-fek] fatal: ${(e as Error).stack ?? String(e)}\n`);
  process.exit(1);
});
