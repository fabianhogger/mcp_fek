import { fold } from '../text/normalize.js';

/**
 * Types of legislative act, as the gazette's own `lawTypes` map numbers them.
 *
 * These ids are what `/searchlegislation` wants in its `legislationCatalogues`
 * field, so the mapping is load-bearing rather than cosmetic. The gaps in the
 * numbering (1..3, then 101, 102, 201, …) are the upstream's, not ours.
 */
export interface LawType {
  id: number;
  /** The abbreviation the gazette prints, e.g. "Ν." */
  abbr: string;
  /** What it stands for, in Greek. */
  label: string;
}

const TYPES: readonly LawType[] = [
  { id: 1, abbr: 'Ν.', label: 'Νόμος' },
  { id: 2, abbr: 'ΠΔ.', label: 'Προεδρικό Διάταγμα' },
  { id: 3, abbr: 'ΠΝΠ.', label: 'Πράξη Νομοθετικού Περιεχομένου' },
  { id: 101, abbr: 'ΑΝ.', label: 'Αναγκαστικός Νόμος' },
  { id: 102, abbr: 'ΒΔ.', label: 'Βασιλικό Διάταγμα' },
  { id: 201, abbr: 'ΕΝ.', label: 'Ειδικός Νόμος' },
  { id: 301, abbr: 'ΝΔ.', label: 'Νομοθετικό Διάταγμα' },
  { id: 401, abbr: 'ΝΒΔ.', label: 'Νομοθετικό Βασιλικό Διάταγμα' },
  { id: 501, abbr: 'ΝΠΔ.', label: 'Νομοθετικό Προεδρικό Διάταγμα' },
  { id: 601, abbr: 'Υ.Π.', label: 'Υπουργική Πράξη' },
];

export const LAW_TYPES: readonly LawType[] = TYPES;

export function lawType(id: number): LawType | undefined {
  return TYPES.find((t) => t.id === id);
}

/**
 * Spellings we accept for each type.
 *
 * The full word matters as much as the abbreviation: people write "νόμος
 * 5324/2026" at least as often as "Ν. 5324/2026", and a model relaying a user
 * question will use whichever the user did.
 */
const EXTRA_ALIASES: Readonly<Record<number, readonly string[]>> = {
  1: ['Ν', 'ΝΟΜΟΣ', 'NOMOS', 'LAW', 'L'],
  2: ['ΠΔ', 'Π.Δ.', 'ΠΡΟΕΔΡΙΚΟ ΔΙΑΤΑΓΜΑ', 'PD', 'PRESIDENTIAL DECREE'],
  3: ['ΠΝΠ', 'Π.Ν.Π.', 'ΠΡΑΞΗ ΝΟΜΟΘΕΤΙΚΟΥ ΠΕΡΙΕΧΟΜΕΝΟΥ', 'PNP'],
  101: ['ΑΝ', 'Α.Ν.', 'ΑΝΑΓΚΑΣΤΙΚΟΣ ΝΟΜΟΣ'],
  102: ['ΒΔ', 'Β.Δ.', 'ΒΑΣΙΛΙΚΟ ΔΙΑΤΑΓΜΑ'],
  201: ['ΕΝ', 'Ε.Ν.', 'ΕΙΔΙΚΟΣ ΝΟΜΟΣ'],
  301: ['ΝΔ', 'Ν.Δ.', 'ΝΟΜΟΘΕΤΙΚΟ ΔΙΑΤΑΓΜΑ', 'ND'],
  401: ['ΝΒΔ', 'Ν.Β.Δ.'],
  501: ['ΝΠΔ', 'Ν.Π.Δ.'],
  601: ['ΥΠ', 'Υ.Π.', 'ΥΠΟΥΡΓΙΚΗ ΠΡΑΞΗ'],
};

const ALIAS_INDEX: ReadonlyMap<string, readonly number[]> = (() => {
  const index = new Map<string, number[]>();
  const add = (alias: string, id: number): void => {
    const key = fold(alias);
    if (key === '') return;
    const bucket = index.get(key);
    if (bucket) {
      if (!bucket.includes(id)) bucket.push(id);
    } else {
      index.set(key, [id]);
    }
  };
  for (const t of TYPES) {
    add(String(t.id), t.id);
    add(t.abbr, t.id);
    add(t.label, t.id);
    for (const alias of EXTRA_ALIASES[t.id] ?? []) add(alias, t.id);
  }
  return index;
})();

export type LawTypeResolution =
  | { decision: 'exact'; lawType: LawType }
  | { decision: 'ambiguous'; candidates: readonly LawType[] }
  | { decision: 'none' };

export function resolveLawType(input: string | number): LawTypeResolution {
  const key = fold(String(input));
  if (key === '') return { decision: 'none' };
  const ids = ALIAS_INDEX.get(key);
  if (!ids || ids.length === 0) return { decision: 'none' };
  if (ids.length === 1) return { decision: 'exact', lawType: lawType(ids[0]!)! };
  return { decision: 'ambiguous', candidates: ids.map((id) => lawType(id)!) };
}
