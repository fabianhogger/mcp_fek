/**
 * Offline guard for the unit suite.
 *
 * Any accidental real network call must fail loudly rather than quietly
 * depending on an undocumented API that nobody promised to keep running.
 */
import { beforeAll, vi } from 'vitest';

beforeAll(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network access is disabled in the unit suite — use a fixture');
  });
});
