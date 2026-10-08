import { beforeAll, describe, expect, it } from 'vitest';
import { dehyphenate, squash } from '../../../src/pdf/clean.js';
import { preservesLength, toGreekLookalikes } from '../../../src/pdf/confusables.js';
import { lawName, renderToc, sectionText, type ParsedFek } from '../../../src/pdf/doc.js';
import { isGarbled } from '../../../src/pdf/garbled.js';
import { parseText } from '../../../src/pdf/structure.js';
import { PDF_FIXTURES, readSnapshot } from '../../helpers/pdf-fixtures.js';

/**
 * The structural parser, against four real gazette issues.
 *
 * Ported assertion-for-assertion from the Python implementation's suite, which
 * was tuned against these same four documents in a working deployment. The
 * counts (141 articles, 3 acts) are ground truth about real documents, so when
 * this disagrees the parser is wrong, not the number.
 *
 * Runs off the committed text snapshots rather than the PDFs, which is what
 * the Python version's parse()/parse_text() split was for: no 15 MB of
 * binaries, no pdf.js, and no reason for it ever to skip.
 */

function parse(key: keyof typeof PDF_FIXTURES, issueGroup: number): ParsedFek {
  const text = readSnapshot(PDF_FIXTURES[key]);
  return parseText(text, { pageCount: 0, issueGroup });
}

let law: ParsedFek;
let decree: ParsedFek;
let issueB: ParsedFek;
let cabinetAct: ParsedFek;

beforeAll(() => {
  law = parse('law', 1);
  decree = parse('shortDecree', 1);
  issueB = parse('issueB', 2);
  cabinetAct = parse('cabinetAct', 1);
});

describe('law name', () => {
  it('reads a heading spelled with Latin lookalikes', () => {
    // This issue spells it "NOMOΣ" with a Latin N and O. Matching the Greek
    // spelling alone silently fails on exactly the largest laws.
    expect(law.lawType).toBe('Ν.');
    expect(law.lawNumber).toBe('5324');
    expect(lawName(law, 'Α 121/2026')).toBe('Ν. 5324/2026');
  });

  it('reads a short decree', () => {
    expect(lawName(decree, 'Α 127/2026')).toBe('Π.Δ. 47/2026');
  });

  it('dehyphenates the title', () => {
    // The source reads "Δι -\nαχείρισης" across a line break.
    expect(law.lawTitle).toContain('Διαχείρισης');
    expect(law.lawTitle).not.toContain('Δι αχείρισης');
  });

  it('stops the title at the enacting formula', () => {
    expect(law.lawTitle).not.toContain('ΠΡΟΕΔΡΟΣ');
    expect(law.lawTitle.startsWith('Σύσταση νομικού προσώπου')).toBe(true);
    // The decree is the regression case for the Greek word-boundary bug: with
    // an ASCII \b the formula is never found and the whole preamble lands in
    // the title.
    expect(decree.lawTitle).toBe(
      'Τροποποίηση του π.δ. 174/1983 «Κανονισμός Πυροσβεστικής Σχολής» (Α’ 68).',
    );
  });

  it('gives a Τεύχος Β issue no law type', () => {
    expect(issueB.lawType).toBe('');
    expect(lawName(issueB, 'Β 5013/2026')).toBe('ΦΕΚ Β 5013/2026');
  });
});

describe('table of contents', () => {
  it('parses all 141 entries of the full ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ', () => {
    expect(law.toc).toHaveLength(141);
    expect(law.toc[0]!.number).toBe(1);
    expect(law.toc[0]!.title).toBe('Σκοπός');
  });

  it('carries the enclosing ΜΕΡΟΣ and ΚΕΦΑΛΑΙΟ as context', () => {
    expect(law.toc[0]!.part.startsWith('ΜΕΡΟΣ Α')).toBe(true);
    expect(law.toc[0]!.chapter).toContain('ΓΕΝΙΚΕΣ ΔΙΑΤΑΞΕΙΣ');
  });

  it('is far smaller than the document itself', () => {
    // The whole point of triaging on the table of contents.
    expect(law.fullText.length).toBeGreaterThan(400_000);
    expect(renderToc(law.toc).length).toBeLessThan(30_000);
  });

  it('synthesises a table of contents for a document that has none', () => {
    expect(decree.toc).toHaveLength(3);
    expect(decree.toc[0]!.title).toBe('Σίτιση και διαμονή Δοκίμων -');
  });

  it('parses the numbered ΑΠΟΦΑΣΕΙΣ list of a Τεύχος Β issue', () => {
    // The heading is split by kerning as "ΠΕΡ ΙΕΧΟΜΕΝΑ" in some renderings,
    // so the anchor is matched whitespace-insensitively.
    expect(issueB.toc).toHaveLength(3);
    expect(issueB.toc[0]!.title.startsWith('Κοστολόγηση διαγνωστικής')).toBe(true);
  });

  it('strips the trailing page numbers off Τεύχος Β entries', () => {
    expect(issueB.toc[0]!.title.endsWith('56349')).toBe(false);
    for (const e of issueB.toc) expect(e.title).not.toMatch(/\d{4,6}$/);
  });
});

describe('sections', () => {
  it('segments all 141 articles', () => {
    expect(law.sections).toHaveLength(141);
    expect(law.sections[0]!.number).toBe(1);
    expect(law.sections[0]!.title).toBe('Σκοπός');
    expect(law.sections[0]!.text).toContain('εκσυγχρονισμός');
  });

  it('numbers them uniquely and in order', () => {
    const numbers = law.sections.map((s) => s.number);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it('does not leak the table of contents into the first article', () => {
    // If the TOC/body split point were wrong, article 1's text would be the
    // contents listing — which reads plausibly and is completely wrong.
    expect(law.sections[0]!.text).not.toContain('ΠΙΝΑΚΑΣ ΠΕΡΙΕΧΟΜΕΝΩΝ');
    expect(law.sections[0]!.text.length).toBeLessThan(3000);
  });

  it('splits Τεύχος Β acts on bare (n) markers', () => {
    // Acts 2 and 3 have no "Αριθμ." line at all — only a "(2)" / "(3)" marker
    // alone on its own line.
    expect(issueB.sections.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(issueB.sections[1]!.text).toContain('λαθρεμπορίας');
  });
});

describe('section text budget', () => {
  it('respects the character budget', () => {
    const result = sectionText(law.sections, {
      numbers: [1, 2, 3],
      maxChars: 500,
      label: (s) => `Άρθρο ${s.number} ${s.title}`,
    });
    expect(result.text.length).toBeLessThanOrEqual(520);
    expect(result.truncated).toBe(true);
  });

  it('returns whole sections when they fit, and says nothing was cut', () => {
    const result = sectionText(law.sections, {
      numbers: [1],
      maxChars: 50_000,
      label: (s) => `Άρθρο ${s.number} ${s.title}`,
    });
    expect(result.truncated).toBe(false);
    expect(result.included).toEqual([1]);
    expect(result.text).toContain('Άρθρο 1 Σκοπός');
  });
});

describe('cabinet act', () => {
  it('recognises the Πράξη heading and its title', () => {
    // Cabinet acts head as "Πράξη 22 της 30-7-2026" under a banner that
    // kerning may split, so the banner cannot be the anchor.
    expect(lawName(cabinetAct, 'Α 126/2026')).toBe('Π.Υ.Σ. 22/2026');
    expect(cabinetAct.lawTitle).toBe('Έγκριση της Εθνικής Στρατηγικής για τα Ύδατα.');
  });

  it('chunks an unstructured body instead of leaving one giant blob', () => {
    // Without chunking this parses as a single 190,000-character section,
    // which is the same as not being addressable at all.
    expect(cabinetAct.sections.length).toBeGreaterThan(1);
    for (const s of cabinetAct.sections) {
      expect(s.text.length).toBeLessThan(20_000);
    }
  });

  it('keeps readable text that abuts the annex', () => {
    // The operative text runs straight into the undecodable annex, so the
    // boundary falls inside a chunk. Dropping whole chunks afterwards loses
    // the publication clause with the garbage; filtering paragraphs before
    // chunking keeps it. This is the regression test for that ordering.
    const combined = cabinetAct.sections.map((s) => s.text).join(' ');
    expect(combined).toContain('στην Εφημερίδα της Κυβερνήσεως');
  });

  it('drops the undecodable annex rather than summarising it', () => {
    for (const section of cabinetAct.sections) {
      expect(isGarbled(section.text)).toBe(false);
    }
  });

  it('keeps the readable operative text', () => {
    const combined = cabinetAct.sections.map((s) => s.text).join(' ');
    expect(combined).toContain('Εφημερίδα');
  });
});

describe('garbled detection', () => {
  it('flags a broken encoding', () => {
    const sample =
      'D\\}ZR^l}N]\\aRXRg}a\\Z}]\\XbaVYlaR^\\}cb`VWl}]l^\\}WNV}a\\}URYoXV\\}' +
      'WnUR}Y\\^cp_}Sfp_}W\\VZfZVWp_}\\^PnZf`T_}WNV}\\VW\\Z\\YVWp_}Q^N`aT^VlaTaN_~}';
    expect(isGarbled(sample.repeat(3))).toBe(true);
  });

  it('accepts normal Greek', () => {
    expect(isGarbled(law.sections[5]!.text)).toBe(false);
  });

  it('accepts Greek interleaved with English terms', () => {
    // This act is full of "Prosigna Breast Cancer Prognostic Gene Signature",
    // which drags the Greek-letter ratio down without being broken at all.
    expect(isGarbled(issueB.sections[0]!.text)).toBe(false);
  });

  it('ignores strings too short to judge', () => {
    expect(isGarbled('}~\\}~\\')).toBe(false);
  });
});

describe('text cleaning', () => {
  it('removes page furniture from article text', () => {
    expect(law.sections[10]!.text).not.toContain('ΕΦΗΜΕΡΙΔΑ ΤΗΣ ΚΥΒΕΡΝΗΣΕΩΣ');
  });

  it('dehyphenates without eating real dashes', () => {
    const cleaned = dehyphenate('Κληρονομιάς - Στρατη-\nγική και δια-\nνομή');
    expect(cleaned).toContain('Στρατηγική');
    expect(cleaned).toContain('διανομή');
    expect(cleaned).toContain('Κληρονομιάς - ');
  });

  it('squashes kerning artefacts for anchor matching', () => {
    expect(squash('ΠΕΡ ΙΕΧΟΜΕΝΑ')).toBe('ΠΕΡΙΕΧΟΜΕΝΑ');
    expect(squash('ΟΡΓ ΑΝΙΣΜΟΣ')).toBe('ΟΡΓΑΝΙΣΜΟΣ');
  });

  it('normalises confusables without changing length', () => {
    // The parser matches anchors on a normalised shadow copy and then slices
    // the original at those offsets, so a length change would shift every
    // slice silently.
    const source = 'NOMOΣ ΥΠ’ ΑΡΙΘΜ 5324';
    expect(toGreekLookalikes(source)).toHaveLength(source.length);
    expect(toGreekLookalikes(source).startsWith('ΝΟΜΟΣ')).toBe(true);
    expect(preservesLength(law.fullText.slice(0, 20_000))).toBe(true);
  });
});
