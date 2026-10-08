import type { z } from 'zod';
import type { Cache } from '../cache.js';
import type { Config } from '../config.js';
import type { EtActions } from '../et/actions.js';
import type { Logger } from '../logger.js';
import type { PdfParser } from '../pdf/pipeline.js';

export interface ToolContext {
  actions: EtActions;
  /** Parses issue PDFs. Loaded lazily; may be disabled. */
  pdf: PdfParser;
  cache: Cache;
  logger: Logger;
  config: Config;
  now: () => number;
}

export interface ToolResult {
  text: string;
  structured: Record<string, unknown>;
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  /**
   * True when a successful result can contain, or point at, the text of a
   * legal act.
   *
   * src/server.ts uses this to inject NOT_CONSOLIDATED_LAW into the tool's
   * description, its rendered text and its structured payload. Handlers must
   * not add that warning themselves — the flag is the mechanism, so that
   * forgetting it is a test failure rather than a silent omission.
   */
  returnsLaw?: boolean;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}
