/**
 * Mark the built entrypoint executable.
 *
 * This replaces `chmod +x dist/index.js` in the build script. `chmod` is not
 * a command cmd.exe has, so the npm script failed outright on Windows — and
 * the Windows CI job exists precisely to catch bin problems like that one.
 * Node's own chmod cannot set the execute bit on Windows, but nothing there
 * needs it: npm writes its own launcher shims.
 */
import { chmod } from 'node:fs/promises';

const target = new URL('../dist/index.js', import.meta.url);
await chmod(target, 0o755);
