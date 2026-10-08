import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/tools/index.js';
import { VERSION } from '../../src/version.js';

const root = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  files: string[];
  bin: Record<string, string>;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (entry.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('package hygiene', () => {
  it('keeps VERSION in sync with package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('ships dist and no test paths', () => {
    expect(pkg.files).toContain('dist');
    for (const f of pkg.files) expect(f).not.toMatch(/^test/);
  });

  it('points bin at the built entrypoint', () => {
    expect(pkg.bin['fek-mcp']).toBe('dist/index.js');
  });

  it('pins pdfjs-dist exactly', () => {
    // Line reconstruction is load-bearing: every structural anchor is
    // line-anchored, so a minor bump that changes item grouping breaks the
    // parser. Upgrades go through the snapshot test in pdf/extract.test.ts.
    expect(pkg.dependencies['pdfjs-dist']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('pins zod to v3', () => {
    // Zod 4 silently produces empty JSON Schemas through the SDK's converter,
    // which makes every tool uncallable. See protocol.test.ts.
    expect(pkg.dependencies['zod']).toMatch(/^\^?3\./);
  });

  it('declares a non-empty input schema for every tool', () => {
    for (const t of TOOLS) {
      expect(Object.keys(t.inputSchema).length, t.name).toBeGreaterThan(0);
    }
  });
});

describe('offline test coverage', () => {
  it('commits the extracted-text snapshots the parser tests depend on', () => {
    // These are what let the structural and tool suites run on a fresh
    // checkout. The reference PDFs are gitignored because they are large and
    // derivable; if these snapshots went too, the parser and get_fek would
    // quietly stop being tested in CI while still passing locally — which is
    // exactly what happened once already.
    const ids = ['20260100121', '20260100126', '20260100127', '20260205013', '19850100100'];
    for (const id of ids) {
      const path = join(root, 'test', 'fixtures', 'text', `${id}.txt`);
      expect(existsSync(path), `${id}.txt is missing — run npm run extract:text`).toBe(true);
    }
  });

  it('keeps the scanned issue\u2019s snapshot empty, because that is the fact', () => {
    // A pre-digital issue extracts to nothing at all. A non-empty snapshot
    // here would mean the scan detection no longer has anything to detect.
    const path = join(root, 'test', 'fixtures', 'text', '19850100100.txt');
    expect(readFileSync(path, 'utf8').trim()).toBe('');
  });

  it('gives the large snapshots real content', () => {
    const law = readFileSync(join(root, 'test', 'fixtures', 'text', '20260100121.txt'), 'utf8');
    expect(law.length).toBeGreaterThan(400_000);
    expect(law).toContain('ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ');
  });
});

describe('cross-platform hygiene', () => {
  it('keeps the npm scripts runnable under cmd.exe', () => {
    // CI runs typecheck, test and build on Windows, where npm uses cmd.exe:
    // no `chmod`, no `rm`, and no `VAR=value command` prefix. Both of those
    // shipped once and only failed on the Windows job, so they are checked
    // from here instead — see scripts/make-executable.mjs and run-live.mjs
    // for the portable forms.
    const posixOnly = /(?:^|&&\s*)(?:[A-Z_][A-Z0-9_]*=|chmod\b|rm\b|cp\b|mv\b|export\b)/;
    for (const [name, script] of Object.entries(pkg.scripts)) {
      expect(script, `${name} uses a POSIX-only shell construct`).not.toMatch(posixOnly);
    }
  });

  it('pins the working tree to LF endings', () => {
    // The structural anchors are line-anchored and the snapshot reproduction
    // compares bytes, so a CRLF checkout breaks the parser in a way that
    // looks like a parser bug. .gitattributes is what stops that.
    const attrs = readFileSync(join(root, '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^\*\s+text=auto\s+eol=lf$/m);
  });
});

describe('upstream origin boundary', () => {
  it('names the Azure hostnames only in src/et/origins.ts', () => {
    // Both upstream hostnames are undocumented and renameable. Keeping them in
    // one file is what makes a rename a one-line fix rather than a grep hunt,
    // so the boundary is enforced here rather than merely documented.
    const offenders: string[] = [];
    for (const file of sourceFiles(join(root, 'src'))) {
      if (file.endsWith(join('et', 'origins.ts'))) continue;
      const text = readFileSync(file, 'utf8');
      if (/azurewebsites\.net|blob\.core\.windows\.net/.test(text)) {
        offenders.push(file.slice(root.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('stdout purity', () => {
  it('writes nothing but JSON-RPC to stdout', () => {
    // A stray console.log corrupts the protocol stream and the client simply
    // disconnects, which is miserable to debug from the client side.
    const frame =
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'hygiene', version: '1.0.0' },
        },
      }) + '\n';

    // Spawn node directly against tsx's own CLI rather than going through
    // npx: on Windows the launcher is `npx.cmd`, which execFileSync cannot
    // find without a shell and — since Node 20.12 — refuses to run through
    // one. Resolving the module is both portable and one process shorter.
    const tsx = createRequire(import.meta.url).resolve('tsx/cli');
    const stdout = execFileSync(process.execPath, [tsx, join(root, 'src', 'index.ts')], {
      input: frame,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, FEK_LOG_LEVEL: 'info', FEK_NO_DISK_CACHE: '1' },
    });

    const lines = stdout.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const parsed = JSON.parse(line) as { jsonrpc?: string };
      expect(parsed.jsonrpc).toBe('2.0');
    }
  }, 70_000);
});
