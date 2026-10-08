/**
 * Download the reference PDFs the parser is tested against.
 *
 * They are not committed: together they are ~15 MB, and they are perfectly
 * derivable because the blob path is arithmetic on (series, year, number) and
 * a published issue never changes. The extracted-text snapshots in
 * test/fixtures/text ARE committed, so the structural tests run offline
 * without them.
 *
 *   npm run fetch:pdfs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { httpFetch } from '../src/et/http.js';
import { pdfUrl, resolveOrigins } from '../src/et/origins.js';
import { fekId, type FekRef } from '../src/fek/ids.js';
import { PDF_FIXTURE_DIR } from '../test/helpers/pdf-fixtures.js';

interface Target {
  ref: FekRef;
  why: string;
}

/**
 * Four issues chosen to cover the shapes the parser has to survive. The same
 * four the Python implementation uses, so its assertions port across.
 */
const TARGETS: readonly Target[] = [
  {
    ref: { year: 2026, issueGroup: 1, number: 121 },
    why: 'Ν. 5324/2026: 112 pages, 141 articles, full ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ, and it spells its own heading NOMOΣ with a Latin N and O.',
  },
  {
    ref: { year: 2026, issueGroup: 1, number: 126 },
    why: 'Π.Υ.Σ. 22/2026: a cabinet act with no articles at all, plus a 76-page annex in an undecodable font encoding.',
  },
  {
    ref: { year: 2026, issueGroup: 1, number: 127 },
    why: 'Π.Δ. 47/2026: two pages, no table of contents, so the TOC has to be synthesised.',
  },
  {
    ref: { year: 2026, issueGroup: 2, number: 5013 },
    why: 'ΦΕΚ Β 5013/2026: several acts delimited by bare (n) markers — the Τεύχος Β shape, which is 90% of all volume.',
  },
  {
    ref: { year: 1985, issueGroup: 1, number: 100 },
    why: 'Α 100/1985: pre-digital. The PDF exists and renders, but holds no text layer at all, so extraction must degrade to a link rather than fail.',
  },
];

async function main(): Promise<void> {
  const origins = resolveOrigins(loadConfig());
  await mkdir(PDF_FIXTURE_DIR, { recursive: true });

  for (const t of TARGETS) {
    const url = pdfUrl(origins, t.ref);
    const name = `${fekId(t.ref)}.pdf`;
    process.stderr.write(`GET ${url}\n`);
    const res = await httpFetch({
      url,
      method: 'GET',
      timeoutMs: 180_000,
      maxBytes: 120_000_000,
      binary: true,
    });
    if (res.status !== 200 || !res.bytes) {
      process.stderr.write(`  ! HTTP ${res.status}, skipping\n`);
      continue;
    }
    await writeFile(join(PDF_FIXTURE_DIR, name), res.bytes);
    process.stderr.write(`  -> ${name} (${res.bytes.byteLength} bytes)\n`);
  }
}

await main();
