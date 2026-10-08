import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * A cache for extracted PDF text, separate from the JSON cache.
 *
 * It has to be separate. src/cache.ts is an LRU sized by entry count, and one
 * issue's extracted text runs to 450,000 characters — a handful of those would
 * evict every piece of reference vocabulary the server has. This one is sized
 * by bytes, gzips its contents (gazette Greek compresses about 4:1), and
 * evicts by age.
 *
 * Entries are keyed by document id *and* parser version: the stored value is
 * the output of src/pdf/structure.ts, so changing the parser must invalidate
 * everything rather than serve results the current code would not produce.
 */

/** Bump when the parser's output shape or behaviour changes. */
export const PARSER_VERSION = 2;

export interface StoreOptions {
  dir: string;
  /** Byte budget for the compressed entries. 0 disables the store. */
  maxBytes: number;
  now?: () => number;
}

export class TextStore {
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly now: () => number;

  constructor(options: StoreOptions) {
    this.dir = join(options.dir, 'pdftext');
    this.maxBytes = options.maxBytes;
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.maxBytes > 0;
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    try {
      const raw = await readFile(this.pathFor(key));
      const parsed = JSON.parse(gunzipSync(raw).toString('utf8')) as { v?: number; value?: T };
      if (parsed.v !== PARSER_VERSION) return undefined;
      return parsed.value;
    } catch {
      // Missing, unreadable, or written by an older parser: just re-extract.
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    const path = this.pathFor(key);
    try {
      await mkdir(this.dir, { recursive: true });
      const payload = gzipSync(Buffer.from(JSON.stringify({ v: PARSER_VERSION, value }), 'utf8'));
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(tmp, payload);
      await rename(tmp, path);
      await this.evict();
    } catch {
      // Read-only home, full disk, sandbox: extraction still worked, it just
      // will not be remembered. Never fail a tool call over a cache write.
    }
  }

  private pathFor(key: string): string {
    const h = createHash('sha256').update(`v${PARSER_VERSION}:${key}`).digest('hex');
    return join(this.dir, `${h}.json.gz`);
  }

  /** Drop the oldest entries until the store is back inside its budget. */
  private async evict(): Promise<void> {
    const names = await readdir(this.dir);
    const entries: Array<{ path: string; size: number; mtime: number }> = [];
    let total = 0;
    for (const name of names) {
      if (!name.endsWith('.json.gz')) continue;
      const path = join(this.dir, name);
      try {
        const info = await stat(path);
        entries.push({ path, size: info.size, mtime: info.mtimeMs });
        total += info.size;
      } catch {
        // Raced with another process's eviction; nothing to do.
      }
    }
    if (total <= this.maxBytes) return;

    entries.sort((a, b) => a.mtime - b.mtime);
    for (const entry of entries) {
      if (total <= this.maxBytes) break;
      try {
        await unlink(entry.path);
        total -= entry.size;
      } catch {
        // Already gone.
      }
    }
  }
}
