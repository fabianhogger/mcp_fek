import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOLS } from '../../src/tools/index.js';
import { VERSION } from '../../src/version.js';

const root = join(import.meta.dirname, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  version: string;
  files: string[];
  bin: Record<string, string>;
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

    const stdout = execFileSync('npx', ['tsx', join(root, 'src', 'index.ts')], {
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
