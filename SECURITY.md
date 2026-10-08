# Security

## Reporting

Report vulnerabilities privately through GitHub's security advisories rather
than a public issue.

## What this server does

- **Read-only.** Every tool is a GET or a search POST. Nothing here writes to,
  authenticates against, or modifies anything upstream, and every tool is
  annotated `readOnlyHint: true`.
- **No credentials.** The gazette search backend is public: no API key, no
  cookie, no nonce. There is nothing to leak. Requests are sent with
  `credentials: "omit"` so no ambient credential can be attached to a
  third-party origin.
- **TLS always.** Both origins are https, and the configuration refuses a
  non-https override rather than silently downgrading.

## Parsing untrusted input

The server downloads PDFs from a third-party origin and parses them. pdf.js is
configured with `isEvalSupported: false`, `disableFontFace: true` and
`useSystemFonts: false`, so a hostile file cannot reach a JavaScript
evaluator, a system font path, or the network. Downloads are capped
(`FEK_PDF_MAX_BYTES`, default 120 MB) with the limit enforced mid-stream, and
a response that does not begin `%PDF-` is rejected before the parser sees it.

## The two upstream origins

`FEK_API_BASE_URL` and `FEK_BLOB_BASE_URL` are trusted configuration. Pointing
them at a host you do not control means that host chooses what this server
parses and returns. Both are validated as https origins; nothing else about
them is checked.

## What is cached, and where

Under `$XDG_CACHE_HOME/mcp-fek` (override with `FEK_CACHE_DIR`):

- JSON search results and reference vocabulary, as plain files.
- Extracted text from issue PDFs, gzipped, under a byte budget
  (`FEK_PDF_CACHE_MB`).

All of it is public gazette content. `FEK_NO_DISK_CACHE=1` keeps everything in
memory, and `FEK_PDF_TEXT=0` disables PDF handling entirely.

## Personal data

Gazette issues routinely name private individuals — appointments, citizenship
grants, disciplinary decisions. That content is published by the Greek state
and this server only relays it, but a tool result can contain personal data,
and anything built on top should treat it accordingly.
