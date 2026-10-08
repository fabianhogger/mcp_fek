# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Tool names and their required argument names are this package's public API.
While on 0.x they may still change.

## [Unreleased]

## [0.1.0] — 2026-10-08

First release.

### Added

- Ten tools over the Greek Government Gazette: `resolve_citation`, `search_fek`,
  `get_fek`, `find_law`, `latest_issues`, `fek_subjects`, `search_asep`,
  `search_company`, `lookup_kad`, `fek_vocabulary`.
- Full-text search across the body of published acts, with decoded match
  extracts and the stemmed query the index actually used.
- Citation parsing for the issue, law, special-series and internal-id forms,
  including Greek typed on a Latin keyboard and the three interchangeable
  apostrophes after a series letter.
- PDF text extraction for born-digital issues: table of contents, per-article
  addressing for Τεύχος Α, per-act splitting for Τεύχος Β, and detection of
  the undecodable font encodings some annexes use.
- The not-consolidated-law warning, injected centrally into every tool that
  can return an act and enforced by a policy test.
- Both upstream origins overridable by environment variable, with a
  `--self-test` that reports which one is broken.
