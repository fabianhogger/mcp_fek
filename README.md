# mcp-fek

An MCP server for the **Greek Government Gazette** (ΦΕΚ, Εφημερίδα της
Κυβερνήσεως), published by the Εθνικό Τυπογραφείο. Resolve a citation like
«ΦΕΚ Β' 1234/2024» to a document, search the full text of published acts, find
which issue a numbered law appeared in, and pull individual articles out of a
112-page law.

> Not affiliated with the Εθνικό Τυπογραφείο. It reads the same public backend
> that [search.et.gr](https://search.et.gr) reads, which is undocumented — see
> [Notes on the upstream API](#notes-on-the-upstream-api). Greek law excludes
> official texts from copyright (Ν. 2121/1993 άρθρο 2 παρ. 5), so gazette
> content is free to republish; that is an observation, not legal advice.

```
resolve_citation  citation: "ΦΕΚ Β' 6047/2026"

Β 6047/2026

read as    Τεύχος Β (series 2), issue 6047, year 2026
fek_id     20260206047
pages      4
published  2026-10-07
signed     2026-10-06
pdf        https://ia37rg02wpsa01.blob.core.windows.net/fek/02/2026/20260206047.pdf
```

```
find_law  number: "5324"

Νόμος 5324 (2 matches)

act           published in  date        pages  fek_id       title
Ν. 5324/2026  Α 121/2026    2026-07-31    112  20260100121  Σύσταση νομικού προσώπου ιδιωτικού δικαίου, με την επωνυμία «Οργαν…
Ν. 5324/1932  Α 63/1932     1932-03-08      8  19320100063  ΠΕΡΙ ΚΥΡΩΣΕΩΝ ΤΟΥ ΑΠΟ 16)17 ΟΚΤΩΒΡΙΟΥ 1931 ΑΝΑΓΚΑΣΤΙΚΟΥ ΔΙΑΤΑΓΜΑ…

Act number 5324 has been used in more than one era, so these are different acts
that merely share a number — not one act published twice. Pass `year` to pick
the one you mean; do not assume the most recent.
```

## Install

```json
{
  "mcpServers": {
    "fek": { "command": "npx", "args": ["-y", "mcp-fek"] }
  }
}
```

Or with Claude Code:

```bash
claude mcp add fek -- npx -y mcp-fek
```

Check it works, including both upstream origins:

```bash
npx -y mcp-fek --self-test
```

Needs Node 20.19 or later. **No API key** — the gazette search backend is
public.

## Tools

| Tool | Answers |
|---|---|
| `resolve_citation` | *What is «ΦΕΚ Β' 1234/2024»?* Also «Ν. 5324/2026», «Π.Δ. 47/2026», «Α.Σ.Ε.Π. 1/2026». |
| `search_fek` | *Which issues mention τηλεργασία?* Full text over the body of the acts. |
| `get_fek` | *Give me that issue* — contents, a specific article, a PDF link. |
| `find_law` | *Which ΦΕΚ is law 5324/2026 in, and what is it called?* |
| `latest_issues` | *What was published today, or this week?* |
| `fek_subjects` | *What is this issue about,* without downloading it. |
| `search_asep` | *Find ΑΣΕΠ recruitment announcement 1/2026.* |
| `search_company` | *Which ΦΕΚ did this company's filings appear in?* |
| `lookup_kad` | *My filing has publication code 8290 from 2003 — where did it come out?* |
| `fek_vocabulary` | *What can I filter by?* Series, act types, subjects, years. |

### ΦΕΚ is not consolidated law, and the server never lets that slide

The gazette publishes acts exactly as enacted. It does not publish
consolidated current law — there is no official "law as currently in force"
text in it at all. An amendment appears as a separate issue years later, and
the consolidated versions people are used to on kodiko.gr or lawspot are those
companies' own editorial work.

A model handed a 2014 issue will present it as current law unless told
otherwise, so the warning is not left to individual tools. Any tool that can
return an act sets one flag, and `src/server.ts` then attaches the warning to
its description, its rendered output *and* its structured payload. A policy
test holds the list of flagged tools and fails the build if an unflagged tool
starts returning acts.

### Search finds issues, not acts

A hit identifies a **φύλλο**, never an individual act. One Τεύχος Β issue
routinely carries a dozen unrelated ministerial decisions, so `search_fek`
says which issue matched and `get_fek` then splits that issue into its
component acts and says which one it was. That composition is deliberate:
there is no upstream query that returns an act.

### Why `find_law` refuses to guess

Act numbering restarts between eras. Asking the live index for law 5324 with
no year returns Α 63/1932 *and* Α 121/2026. Preferring the modern one would be
right most of the time, which is exactly what makes it dangerous, so both come
back and the collision is named.

## Scope and limits

- **Full-text search starts around 1992.** search.et.gr disables its own text
  input before then; the earliest hits seen in practice are 1998. A keyword
  search restricted to earlier years returns nothing regardless of what was
  published, and `search_fek` says so rather than letting it read as "no such
  law".
- **Older issues are scanned images.** The 1985 Α' 100 PDF renders perfectly
  and contains exactly zero extractable characters. `get_fek` reports
  `text_source: "none"` and hands back the metadata and the link, which is the
  whole answer — no OCR is attempted, because for these documents there is
  nothing to OCR cheaply and nothing to be gained by pretending otherwise.
- **Extracts are not quotable.** The search index stores text accent-stripped
  and lower-cased, so a match extract locates and summarises but is not the
  published wording. Every tool that shows one says this.
- **Results are capped upstream** at 1500 for a text search and 12000
  otherwise. When a result set hits the cap, the tool says so, because a model
  that does not know will reason as though it saw everything.
- **Today's listing is incomplete.** Issues appear through the working day: one
  weekday the listing held 4 rows at 13:00 and 90 by evening. `latest_issues`
  stamps same-day results with the time they were taken.
- **Empty is normal.** No issues are published at weekends or on public
  holidays, and that is a success, not a fault.
- **Diavgeia is out of scope.** Many gazette-published decisions also appear on
  Diavgeia, but linking them is a separate job for a separate server.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `FEK_API_BASE_URL` | `https://searchetv99.azurewebsites.net` | Override the search backend origin |
| `FEK_BLOB_BASE_URL` | `https://ia37rg02wpsa01.blob.core.windows.net` | Override the PDF storage origin |
| `FEK_TIMEOUT_MS` | `15000` | Per-request timeout |
| `FEK_PDF_TIMEOUT_MS` | `120000` | Per-PDF-download timeout |
| `FEK_MAX_CONCURRENCY` | `2` | In-flight API requests |
| `FEK_MIN_SPACING_MS` | `250` | Minimum gap between API requests |
| `FEK_PDF_MAX_BYTES` | `120000000` | Refuse larger PDFs |
| `FEK_PDF_TEXT` | `1` | `0` disables PDF handling entirely |
| `FEK_PDF_CACHE_MB` | `256` | Budget for cached extracted text |
| `FEK_MAX_ENRICH` | `10` | Per-call cap on title lookups |
| `FEK_NO_DISK_CACHE` | off | Keep the cache in memory only |
| `FEK_CACHE_DIR` | `$XDG_CACHE_HOME/mcp-fek` | Where to persist the cache |
| `FEK_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |

The two origin overrides matter more than the rest: both hostnames are
undocumented Azure resources that can be renamed without notice, and if that
happens, setting the variable is the entire fix. `--self-test` probes each one
separately and names which failed.

## Notes on the upstream API

Everything below was read out of the search.et.gr React bundle and then
verified against the live service. None of it is documented, and it is recorded
here in case it saves someone else the work.

- **Two undocumented Azure hostnames** carry the whole thing: an App Service
  for the API and a blob container for the PDFs. They are confined to
  `src/et/origins.ts`, and a hygiene test fails the build if either string
  appears anywhere else in `src/`.
- **Every response is double-encoded.** The body is
  `{"status":"ok","data":"[{…}]"}` where `data` is a JSON *string* that needs
  parsing a second time. Miss it and every field reads as `undefined` with no
  error raised anywhere.
- **Row keys are prefixed per endpoint**: `search_PrimaryLabel`,
  `documententitybyid_Pages`, `issuegroupidsbyyear_IssueGroupID`.
- **Dates come back US-format**, `"10/07/2026 00:00:00"`. Verified rather than
  assumed: a request for `2026-10-07` returns exactly that string.
- **The last row of a text search is not a result.** It is
  `{"search_stemmedQuery":"τηλεργασ"}`. Counting it inflates every total by one
  and renders a blank row. It is also worth surfacing — the index searches a
  stem, which is why hits show other inflections.
- **`search_MatchedText` is base64; `search_HighlightedText` is not.** Despite
  the parallel naming, the first is base64-encoded UTF-8 and the second is a
  plain JSON array of the matched surface forms.
- **`search_Score` is not a relevance score.** Across one result set it runs
  1478, 1479, 1480, 1461, and it is `0` for by-date and by-number queries. It
  is an ordinal, and this server never surfaces it as ranking.
- **PDF URLs are derivable.** `{blob}/fek/{series:02d}/{year}/{year}{series:02d}{number:05d}.pdf`,
  so a citation resolves to a working link with no network call at all.
- **`/years` is dead.** It is in the bundle's endpoint table but answers 400 in
  every form; the site generates its year dropdown client-side from 1833. So
  does this server.
- **`/tagsbyissue` answers 400** to every payload tried, including the
  `?ui=true` form the bundle itself sends. Tag browsing is unimplemented for
  that reason.
- **`/searchkad` is misnamed twice over.** Its `protocolNumber` field wants the
  publication code (ΚΑΔ, Κωδικός Αριθμός Δημοσίευσης), it returns the real
  protocol number separately, and "ΚΑΔ" is not the business activity code that
  shares the abbreviation. Its rows are shaped unlike every other search
  result: `search_DocumentEntityID` instead of `search_ID`, and an explicit
  `search_Year`.
- **`/searchasep` takes scalars** where every sibling endpoint takes arrays.
- **`/searchcompany` keys on an internal company id**, not a name; a name
  returns nothing rather than erroring. `/companies` resolves names and takes
  `{partialName}`, not the `companies_Name` its own rows use.
- **`/searchlegislation` and `/searchasep` are the only endpoints that return a
  title** (`search_Description`). Everywhere else, titles exist only inside the
  PDFs — the daily listing has none at all.
- **Series 11 renamed itself.** It was ΑΕ-ΕΠΕ and became ΠΡΑ.Δ.Ι.Τ. from 2015,
  and the site resolves the name from the document's year, so the same id
  prints differently for 2014 and 2016.
- **Several series are closed**: Ν.Π.Δ.Δ., Α.Π.Σ. and ΠΑΡΑΡΤΗΜΑ all ended in
  2006, and Τεύχος Γ only begins in 1984. Searching outside a series' range
  returns zero rows with no explanation, so this server validates locally and
  gives the reason.
- **`/timeline` exists and would be the best thing here.** The bundle carries
  an edge-type map for it — modification, expansion, reference, invalidation,
  identity, replacement, reinstatement — which is a citation graph between
  acts. But `/timeline/{search_ID}` returns 404: it wants some other id, and
  the scheme is not known. Unimplemented, and documented in
  `src/et/endpoints.ts` so the next person does not have to re-read the bundle.

### Notes on the PDFs

- **Laws spell their own heading with Latin letters.** The largest ones render
  `NOMOΣ` with a Latin N and O, so a Greek anchor pattern misses exactly the
  documents it was written for. Anchors are matched against a
  character-for-character normalised shadow copy, which keeps byte offsets
  valid.
- **Kerning inserts spaces inside words**: `ΟΡΓ ΑΝΙΣΜΟΣ`, `ΠΕΡ ΙΕΧΟΜΕΝΑ`. Not
  repaired — that needs a lexicon and risks merging real words — so anchors are
  matched whitespace-insensitively instead.
- **Some annexes are unrecoverable.** They embed subset fonts with no ToUnicode
  map and extract as `D\}ZR^l}N]\aRXRg}` under pdf.js, pypdf and poppler alike.
  They are detected and dropped, because handed to a model that string yields a
  confident summary of nothing.
- **Table-of-contents entries and body headings are indistinguishable** by
  shape — both are `Άρθρο N`. The body restarts the numbering, so the split is
  the first point where the article number stops increasing.

## Development

```bash
npm install
npm run typecheck        # tsc --noEmit; this plus the tests are the only gates
npm test                 # offline unit suite; network is stubbed to throw
npm run test:live        # invariants against the real API (FEK_LIVE=1)

npm run record           # re-record API fixtures from the live service
npm run fetch:pdfs       # download the reference PDFs (gitignored, ~15 MB)
npm run extract:text     # refresh the committed text snapshots

npx tsx src/index.ts --self-test
npx @modelcontextprotocol/inspector npx tsx src/index.ts
```

Fixtures come from the real service, never from hand-written JSON: the point is
to pin down what an undocumented API actually does, and a hand-built fixture
only pins down what we assumed.

The reference PDFs are gitignored — large, and derivable from a deterministic
URL — so the committed text snapshots in `test/fixtures/text/` are what let the
suite run on a fresh checkout. The structural parser and every `get_fek` test
run off those snapshots and never skip; only the download, the byte caps and
pdf.js itself need the binaries, and those eight tests skip without them,
saying so. The daily `live-smoke` job fetches the PDFs and runs the full suite,
which is where `test/unit/pdf/extract.test.ts` checks that re-extracting
reproduces the snapshots byte for byte — the thing that catches a pdf.js
upgrade quietly changing line reconstruction. `pdfjs-dist` is pinned exactly
for the same reason.

## Provenance

The ΦΕΚ structural parser is a TypeScript port of the Python one in
`fek-daily-tweet`, which was tuned against real issues over a working
deployment; its test suite ported across assertion-for-assertion. The Greek
text folding, transliteration and ranked matching in `src/text/` come from
`oasa-mcp`, as do this project's overall conventions.

## Licence

MIT. Gazette content itself is excluded from copyright under Greek law
(Ν. 2121/1993 άρθρο 2 παρ. 5).
