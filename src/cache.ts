import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Two-tier cache with single-flight and stale-if-error.
 *
 * The disk tier matters more than it looks: an MCP stdio server is spawned
 * fresh per session, so without it every session re-fetches the same reference
 * vocabulary and re-downloads the same immutable gazette issues.
 *
 * Extracted PDF text does NOT live here — see src/pdf/store.ts. One issue's
 * text runs to ~450 KB, which would evict every JSON entry from an LRU sized
 * by count.
 */

/** Bumped when a stored shape changes, to invalidate every existing entry. */
export const SCHEMA_VERSION = 1;

export interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface GetOptions {
  ttlMs: number;
  /** Serve an expired entry if the loader fails. Reference data only. */
  staleIfError?: boolean;
  /** Skip the disk tier. */
  memoryOnly?: boolean;
}

export interface CacheResult<T> {
  value: T;
  /** True when served past its TTL because the loader failed. */
  stale: boolean;
  /** When the served value was fetched. */
  storedAt: number;
}

export interface CacheOptions {
  dir?: string | undefined;
  disableDisk?: boolean;
  maxEntries?: number;
  now?: () => number;
}

export function defaultCacheDir(): string {
  const xdg = process.env['XDG_CACHE_HOME'];
  const base = xdg && xdg.trim() !== '' ? xdg : join(homedir() || tmpdir(), '.cache');
  return join(base, 'mcp-fek');
}

export class Cache {
  private readonly mem = new Map<string, CacheEntry<unknown>>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly dir: string;
  private readonly disableDisk: boolean;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CacheOptions = {}) {
    this.dir = options.dir ?? defaultCacheDir();
    this.disableDisk = options.disableDisk ?? false;
    this.maxEntries = options.maxEntries ?? 400;
    this.now = options.now ?? Date.now;
  }

  /** Where the PDF text store puts its files, so both tiers share one root. */
  get root(): string {
    return this.dir;
  }

  /**
   * Fetch through the cache.
   *
   * Concurrent calls for one key share a single loader invocation: several
   * tools may each want the category list, and that must cost one request.
   */
  async get<T>(key: string, opts: GetOptions, loader: () => Promise<T>): Promise<CacheResult<T>> {
    const fresh = this.readMemory<T>(key, opts.ttlMs);
    if (fresh) return { value: fresh.value, stale: false, storedAt: fresh.storedAt };

    if (!opts.memoryOnly && !this.disableDisk) {
      const onDisk = await this.readDisk<T>(key);
      if (onDisk) {
        this.writeMemory(key, onDisk);
        if (this.now() - onDisk.storedAt < opts.ttlMs) {
          return { value: onDisk.value, stale: false, storedAt: onDisk.storedAt };
        }
      }
    }

    const existing = this.inFlight.get(key);
    if (existing) {
      return { value: (await existing) as T, stale: false, storedAt: this.now() };
    }

    const task = (async (): Promise<T> => {
      const value = await loader();
      const entry: CacheEntry<T> = { value, storedAt: this.now() };
      this.writeMemory(key, entry);
      if (!opts.memoryOnly && !this.disableDisk) await this.writeDisk(key, entry);
      return value;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);

    try {
      return { value: await task, stale: false, storedAt: this.now() };
    } catch (e) {
      if (opts.staleIfError) {
        const stale = this.mem.get(key) as CacheEntry<T> | undefined;
        if (stale) return { value: stale.value, stale: true, storedAt: stale.storedAt };
      }
      throw e;
    }
  }

  private readMemory<T>(key: string, ttlMs: number): CacheEntry<T> | undefined {
    const hit = this.mem.get(key) as CacheEntry<T> | undefined;
    if (!hit) return undefined;
    if (this.now() - hit.storedAt >= ttlMs) return undefined;
    // Refresh LRU position.
    this.mem.delete(key);
    this.mem.set(key, hit);
    return hit;
  }

  private writeMemory<T>(key: string, entry: CacheEntry<T>): void {
    this.mem.delete(key);
    this.mem.set(key, entry);
    while (this.mem.size > this.maxEntries) {
      const oldest = this.mem.keys().next().value;
      if (oldest === undefined) break;
      this.mem.delete(oldest);
    }
  }

  private pathFor(key: string): string {
    const h = createHash('sha256').update(`v${SCHEMA_VERSION}:${key}`).digest('hex');
    // Shard by prefix so one directory never holds thousands of files.
    return join(this.dir, 'json', h.slice(0, 2), `${h.slice(2)}.json`);
  }

  private async readDisk<T>(key: string): Promise<CacheEntry<T> | undefined> {
    try {
      const raw = await readFile(this.pathFor(key), 'utf8');
      const parsed = JSON.parse(raw) as { v?: number; storedAt?: number; value?: T };
      if (parsed.v !== SCHEMA_VERSION || typeof parsed.storedAt !== 'number') return undefined;
      return { value: parsed.value as T, storedAt: parsed.storedAt };
    } catch {
      // A missing, unreadable or corrupt cache file is never fatal.
      return undefined;
    }
  }

  private async writeDisk<T>(key: string, entry: CacheEntry<T>): Promise<void> {
    const path = this.pathFor(key);
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.${process.pid}.tmp`;
      await writeFile(
        tmp,
        JSON.stringify({ v: SCHEMA_VERSION, storedAt: entry.storedAt, value: entry.value }),
        'utf8',
      );
      // Atomic replace, so a concurrent reader never sees a partial file.
      await rename(tmp, path);
    } catch {
      // Read-only home, full disk, sandbox: degrade to memory-only silently.
    }
  }

  /** Drop everything from memory. Used by tests. */
  clearMemory(): void {
    this.mem.clear();
  }
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** TTLs, in ms. */
export const TTL = {
  /** Reference vocabulary: changes a few times a year at most. */
  vocabulary: 7 * DAY,
  issueGroupsPastYear: 90 * DAY,
  issueGroupsCurrentYear: 12 * HOUR,
  /**
   * Not 90 days despite the document being immutable: a διόρθωση σφάλματος
   * updates ReReleaseDate on an existing entity.
   */
  documentEntity: 7 * DAY,
  /** Searches whose window touches today can still gain rows. */
  searchRecent: 1 * HOUR,
  searchHistoric: 7 * DAY,
} as const;

/**
 * How long a daily listing may be trusted, as a function of its age.
 *
 * The gazette listing fills through the day: one weekday it held 4 rows at
 * 13:00 and 90 by evening. A stale same-day listing is not merely incomplete,
 * it reports "nothing published" for a day that published 90 issues — so the
 * same-day TTL is short and stale-if-error is off for it.
 */
export function listingTtl(dateIso: string, now: number): number {
  const published = Date.parse(`${dateIso}T12:00:00Z`);
  if (!Number.isFinite(published)) return 5 * MINUTE;
  const ageDays = (now - published) / DAY;
  if (ageDays < 1) return 5 * MINUTE;
  if (ageDays < 2) return 1 * HOUR;
  if (ageDays < 7) return 1 * DAY;
  return 90 * DAY;
}

/** A listing older than a week is immutable, so serving it stale is safe. */
export function listingStaleIfError(dateIso: string, now: number): boolean {
  return listingTtl(dateIso, now) >= 90 * DAY;
}
