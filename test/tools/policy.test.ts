import { afterEach, describe, expect, it } from 'vitest';
import { NOT_CONSOLIDATED_LAW } from '../../src/fek/disclaimer.js';
import { TOOLS } from '../../src/tools/index.js';
import { callTool, makeTestServer, type TestServer } from '../helpers/make-server.js';

let srv: TestServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

/**
 * Every tool whose result can contain or point at the text of a legal act.
 *
 * This list is the point of the test. ΦΕΚ publishes acts as enacted and never
 * consolidated law, so a model handed a 2014 issue will present it as current
 * law unless told otherwise — and that is the single worst failure this server
 * could have. Adding an eighth law-returning tool must therefore fail the
 * build until it is listed here and flagged.
 */
const LAW_RETURNING = [
  'resolve_citation',
  'search_fek',
  'get_fek',
  'find_law',
  'latest_issues',
  'fek_subjects',
  'search_asep',
  'search_company',
  'lookup_kad',
] as const;

describe('law-currency warning', () => {
  it('flags exactly the tools that can return a law', () => {
    const flagged = TOOLS.filter((t) => t.returnsLaw === true)
      .map((t) => t.name)
      .sort();
    expect(flagged).toEqual([...LAW_RETURNING].sort());
  });

  it('puts the warning in every flagged tool description, via tools/list', async () => {
    // Injected centrally in server.ts rather than written into each tool, so
    // that an author physically cannot omit it.
    srv = await makeTestServer();
    const { tools } = await srv.client.listTools();
    for (const t of tools) {
      const expected = LAW_RETURNING.includes(t.name as (typeof LAW_RETURNING)[number]);
      expect(t.description!.includes(NOT_CONSOLIDATED_LAW), `${t.name} description`).toBe(expected);
    }
  });

  it('keeps it out of the descriptions of tools that cannot return a law', async () => {
    srv = await makeTestServer();
    const { tools } = await srv.client.listTools();
    const vocab = tools.find((t) => t.name === 'fek_vocabulary')!;
    expect(vocab.description).not.toContain(NOT_CONSOLIDATED_LAW);
  });

  it('attaches it to a successful result in both channels', async () => {
    srv = await makeTestServer();
    for (const [name, args] of [
      ['resolve_citation', { citation: "ΦΕΚ Β' 6047/2026" }],
      ['get_fek', { fek_id: '20260100121' }],
      ['find_law', { number: '5324', year: 2026 }],
      ['search_fek', { series: ['Α'], year: [2026], document_number: '121' }],
      ['latest_issues', { date: '2026-10-07', enrich: false }],
      ['fek_subjects', { fek_id: '20260100121' }],
      ['search_asep', { year: 2026, document_number: '1' }],
      ['search_company', { company_id: '3135' }],
      ['lookup_kad', { code: '8290', year: 2003 }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(srv, name, args);
      expect(res.isError, `${name} should have succeeded`).toBe(false);
      expect(res.text, `${name} text`).toContain('never consolidated current law');
      expect(res.structured['law_currency_warning'], `${name} structured`).toBe(
        NOT_CONSOLIDATED_LAW,
      );
    }
  });

  it('does not bury an error message under the warning', async () => {
    // An error result is not an answer about a law, so appending the warning
    // would only push the actionable sentence out of view.
    srv = await makeTestServer();
    const res = await callTool(srv, 'resolve_citation', { citation: 'not a citation at all' });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain(NOT_CONSOLIDATED_LAW);
    expect(res.structured['law_currency_warning']).toBeUndefined();
  });

  it('states it in the server instructions, before any tool is called', async () => {
    srv = await makeTestServer();
    expect(srv.client.getInstructions()).toContain(NOT_CONSOLIDATED_LAW);
  });
});
