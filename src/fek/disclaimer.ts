/**
 * The one thing this server must never let a model get wrong.
 *
 * ΦΕΚ publishes legal acts as enacted. It does not publish consolidated law:
 * there is no official "law as currently in force" text in the gazette at all.
 * An amendment is a separate issue published years later, and the consolidated
 * versions people are used to seeing on kodiko.gr or lawspot are those
 * companies' own editorial work, not official text.
 *
 * So a model handed a 2014 ΦΕΚ will happily present it as current law unless
 * told otherwise. This constant is the single source of that warning, and
 * src/server.ts injects it mechanically into every tool flagged `returnsLaw`
 * — into the description, the rendered text and the structured payload — so no
 * individual tool can forget it. test/tools/policy.test.ts holds the list of
 * tools that must carry the flag.
 */
export const NOT_CONSOLIDATED_LAW =
  'ΦΕΚ publishes acts exactly as enacted, never consolidated current law. ' +
  'This act may since have been amended or repealed, and any amending act is a ' +
  'separate issue. Treat it as the original publication rather than the law in ' +
  'force, and say so when reporting it.';

/** Appended to every tool description, the way oasa-mcp appends its SCOPE. */
export const SCOPE =
  'Covers the Greek Government Gazette (ΦΕΚ) published by the Εθνικό Τυπογραφείο, ' +
  'all issue series from 1833 onward.';
