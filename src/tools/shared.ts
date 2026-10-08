import { z } from 'zod';
import { SCOPE } from '../fek/disclaimer.js';
import { MIN_YEAR } from '../fek/limits.js';

export { SCOPE };

/** A result cap. Small by default: gazette result sets run to thousands. */
export function limitSchema(max: number, dflt: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .optional()
    .describe(`Maximum rows to return (1-${max}, default ${dflt}).`);
}

export const yearSchema = z
  .number()
  .int()
  .min(MIN_YEAR)
  .max(2100)
  .describe(`Four-digit year, ${MIN_YEAR} or later.`);

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD')
  .describe('Date as YYYY-MM-DD.');

export const seriesSchema = z
  .string()
  .describe(
    'Issue series (τεύχος). Accepts the printed letter or abbreviation ("Α", "Β", ' +
      '"Α.Σ.Ε.Π.", "Υ.Ο.Δ.Δ."), the ordinal word ("ΠΡΩΤΟ", "ΔΕΥΤΕΡΟ"), the undotted ' +
      'form ("ΑΣΕΠ"), a Latin transliteration ("ASEP"), or the numeric id.',
  );

/** A not-found result that tells the caller what to try instead. */
export function notFound(what: string, hint?: string): { text: string; structured: Record<string, unknown> } {
  return {
    text: hint ? `${what}\n\n${hint}` : what,
    structured: { status: 'not_found' },
  };
}

/** Invalid input is a normal result with isError, not a thrown exception. */
export function invalidInput(message: string): {
  text: string;
  structured: Record<string, unknown>;
  isError: true;
} {
  return { text: message, structured: { status: 'invalid_input' }, isError: true };
}
