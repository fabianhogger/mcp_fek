import { describe, expect, it } from 'vitest';
import { CAP_WITH_TEXT, CAP_WITHOUT_TEXT, capFor, capNote, textIndexWarning } from '../../src/fek/limits.js';

describe('result caps', () => {
  it('uses the smaller cap when the query carried text', () => {
    expect(capFor(true)).toBe(CAP_WITH_TEXT);
    expect(capFor(false)).toBe(CAP_WITHOUT_TEXT);
  });

  it('says so when a result set is capped, so the model narrows', () => {
    // Silently truncated results are worse than none: a model reasons as
    // though it saw everything.
    expect(capNote(CAP_WITH_TEXT, true)).toMatch(/1500/);
    expect(capNote(CAP_WITH_TEXT, true)).toMatch(/narrow/);
    expect(capNote(CAP_WITH_TEXT - 1, true)).toBeNull();
  });

  it('does not mistake 1500 metadata-only results for the cap', () => {
    expect(capNote(CAP_WITH_TEXT, false)).toBeNull();
    expect(capNote(CAP_WITHOUT_TEXT, false)).toMatch(/12000/);
  });
});

describe('textIndexWarning', () => {
  it('warns when every requested year predates the index', () => {
    const w = textIndexWarning(true, [1970], '');
    expect(w).toMatch(/1992/);
  });

  it('stays silent when any requested year is covered', () => {
    // A 1970-2000 span does reach indexed years, so a warning would be wrong.
    expect(textIndexWarning(true, [1970, 1995], '')).toBeNull();
    expect(textIndexWarning(true, [], '1970-01-01 2000-01-01')).toBeNull();
  });

  it('reads the years out of a date range too', () => {
    expect(textIndexWarning(true, [], '1970-01-01 1980-12-31')).toMatch(/1992/);
  });

  it('stays silent without a text query, and when unbounded', () => {
    expect(textIndexWarning(false, [1970], '')).toBeNull();
    expect(textIndexWarning(true, [], '')).toBeNull();
  });
});
