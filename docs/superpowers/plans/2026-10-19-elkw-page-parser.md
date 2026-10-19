# ELKW Page Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the current official ELKW listing page into explicit source sections and PDF document candidates without relying on brittle filenames or hidden URLs.

**Architecture:** A pure Cheerio parser receives HTML and a source ID, discovers semantic headings and links, and returns normalized sections plus document candidates. Category inference is limited to the three documented semantic headings; unknown headings and malformed links become reviewable issues instead of guessed publications.

**Tech Stack:** Node.js 24, ES modules, Cheerio, Vitest.

**Spec:** `docs/specs.md`

## Global Constraints

- Source URLs live in `config/sources.js`, not parser logic.
- Preserve source section/round/deadline context for every document candidate.
- Do not fetch live sources from the core test suite.
- Unknown or incomplete structures must be reported, not silently guessed.
- The obsolete `a&b` feed is not parsed.

## Task 1: Offline ELKW page parser

**Files:**
- Create: `src/import/elkw-page-parser.js`
- Create: `test/fixtures/elkw-listing-page.html`
- Test: `test/elkw-page-parser.test.js`

**Interfaces:**
- Produces `parseElkwListingPage(html, { sourceId, pageUrl, observedAt })` returning `{ sections, documents, issues }`.
- Each section has `{ key, sourceId, label, category, round, deadline }`.
- Each document has `{ sourceId, sectionKey, title, originalUrl }`.

- [ ] **Step 1: Write the failing fixture-based tests** for advertised, available, and upcoming categories; round/deadline extraction; relative URL resolution; and an issue for a PDF link outside a recognized category.
- [ ] **Step 2: Run `npm test -- test/elkw-page-parser.test.js` and verify the missing-parser failure.**
- [ ] **Step 3: Implement the pure parser with semantic heading context and deterministic section keys.** Only links whose resolved URL has a `.pdf` pathname become documents.
- [ ] **Step 4: Run the focused test and then `npm test`.**
- [ ] **Step 5: Run `git diff --check` and commit with `feat: ELKW-Seitenparser ergänzen`.**

## Review Focus

- A document in a recognized category but under a round heading keeps both category and round context — covered by the round test.
- Relative and absolute PDF links resolve against the supplied page URL without a parser-local canonical URL — covered by URL tests.
- A PDF before any recognized category is reported as an issue and not imported — covered by the unknown-context test.
- A non-PDF application form is ignored — covered by the link-filter test.
