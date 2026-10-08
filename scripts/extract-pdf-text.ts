/**
 * Refresh the committed extracted-text snapshots.
 *
 * These snapshots are what let the structural tests run offline, without the
 * 15 MB of PDFs. They are also a regression anchor in their own right: if a
 * pdf.js upgrade changes line reconstruction, the diff here is the warning.
 *
 *   npm run fetch:pdfs && npm run extract:text
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extractText } from '../src/pdf/extract.js';
import {
  hasPdf,
  PDF_FIXTURES,
  pdfPath,
  TEXT_FIXTURE_DIR,
  textPath,
} from '../test/helpers/pdf-fixtures.js';

async function main(): Promise<void> {
  await mkdir(TEXT_FIXTURE_DIR, { recursive: true });

  for (const id of Object.values(PDF_FIXTURES)) {
    if (!hasPdf(id)) {
      process.stderr.write(`${id}: PDF missing, run npm run fetch:pdfs\n`);
      continue;
    }
    const bytes = new Uint8Array(await readFile(pdfPath(id)));
    const result = await extractText(bytes);
    await writeFile(textPath(id), result.text, 'utf8');
    process.stderr.write(
      `${id}: ${result.pageCount} pages, ${result.text.length} chars` +
        `${result.emptyPages > 0 ? `, ${result.emptyPages} empty pages` : ''}\n`,
    );
  }
}

await main();
