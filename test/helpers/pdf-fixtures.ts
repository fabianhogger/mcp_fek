import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const PDF_FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'pdf');
export const TEXT_FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'text');

/** The reference issues, by ΦΕΚ id. */
export const PDF_FIXTURES = {
  law: '20260100121',
  cabinetAct: '20260100126',
  shortDecree: '20260100127',
  issueB: '20260205013',
  /** Pre-digital: a scanned image whose PDF holds no text at all. */
  scan: '19850100100',
} as const;

export function pdfPath(id: string): string {
  return join(PDF_FIXTURE_DIR, `${id}.pdf`);
}

export function textPath(id: string): string {
  return join(TEXT_FIXTURE_DIR, `${id}.txt`);
}

/**
 * Whether the binaries are present.
 *
 * The PDFs are gitignored, so extraction tests skip rather than fail when they
 * have not been fetched — the same shape as the Python suite's conftest. The
 * structural tests run off the committed text snapshots and never skip.
 */
export function hasPdf(id: string): boolean {
  return existsSync(pdfPath(id));
}
