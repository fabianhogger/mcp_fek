import { fekSubjects } from './fek-subjects.js';
import { fekVocabulary } from './fek-vocabulary.js';
import { findLaw } from './find-law.js';
import { getFek } from './get-fek.js';
import { latestIssues } from './latest-issues.js';
import { lookupKad } from './lookup-kad.js';
import { resolveCitation } from './resolve-citation.js';
import { searchAsep } from './search-asep.js';
import { searchCompany } from './search-company.js';
import { searchFek } from './search-fek.js';
import type { ToolDef } from './types.js';

/**
 * The tool surface.
 *
 * Task-shaped, not one-per-endpoint. The upstream exposes about twenty
 * endpoints; several of them are fragments of one question ("which ΦΕΚ is this
 * law in" needs a legislation search, a document lookup and a PDF path), and
 * one of them answers a question nobody asks. Tools are named for the question.
 *
 * Ordered by how often they are the right starting point: a reference resolves
 * directly, a topic needs a search, and everything else is narrower.
 *
 * Any tool whose result can contain or point at the text of a legal act must
 * set `returnsLaw: true`; src/server.ts then attaches the
 * not-consolidated-law warning to it. See test/tools/policy.test.ts.
 */
export const TOOLS: readonly ToolDef[] = [
  resolveCitation,
  searchFek,
  getFek,
  findLaw,
  latestIssues,
  fekSubjects,
  searchAsep,
  searchCompany,
  lookupKad,
  fekVocabulary,
];
