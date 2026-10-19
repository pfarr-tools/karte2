# Import Run Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist parsed ELKW page observations and downloaded document versions in an idempotent, non-destructive import run.

**Architecture:** The import runner coordinates the existing pure page parser and injected document downloader, records one `import_runs` row, upserts source sections, inserts unseen document hashes, and records per-document issues without aborting successful siblings. It performs no deletion or deactivation.

**Spec:** `docs/specs.md`

## Task 1: Safe import-run persistence

**Files:**
- Create: `src/import/import-run.js`
- Create: `migrations/003_import_indexes.sql`
- Test: `test/import-run.test.js`

**Interfaces:**
- Produces `runPageImport({ database, html, sourceId, pageUrl, observedAt, downloadDocumentImpl })` returning `{ importRunId, status, counts, issues }`.

- [ ] **Step 1: Write failing tests** for idempotent repeated documents, changed-document version retention, per-document failure isolation, section provenance, and no deletion on empty/partial results.
- [ ] **Step 2: Run `npm test -- test/import-run.test.js` and verify the missing-module failure.**
- [ ] **Step 3: Implement the runner and uniqueness indexes without destructive synchronization.**
- [ ] **Step 4: Run the focused test and then `npm test`.**
- [ ] **Step 5: Commit with `feat: sichere Importläufe persistieren`.**
