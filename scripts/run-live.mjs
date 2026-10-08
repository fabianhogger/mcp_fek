/**
 * Run the live suite with FEK_LIVE=1.
 *
 * `FEK_LIVE=1 vitest ...` is a POSIX shell construct that cmd.exe reads as a
 * command name, so setting the variable here keeps `npm run test:live`
 * working on every platform. The variable stays a required opt-in: the live
 * tests skip without it, so a plain `vitest run` can never reach the network.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

const result = spawnSync(
  process.execPath,
  [vitest, 'run', '--project', 'live', ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, FEK_LIVE: '1' } },
);

process.exit(result.status ?? 1);
