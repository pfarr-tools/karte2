# Document Artifact Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download official PDF artifacts safely and retain immutable, hash-addressed local versions for later extraction and provenance.

**Architecture:** A small dependency-injected downloader validates the URL and response before writing. It writes to a temporary file in the document store, computes SHA-256 while streaming, and atomically renames to a hash-based path; repeated content therefore reuses the same artifact while changed content creates a new version.

**Spec:** `docs/specs.md`

## Global Constraints

- Only trusted configured source hosts may be downloaded.
- PDFs are stored, never silently replaced.
- Size and response-status limits fail before an artifact is accepted.
- Tests use an injected fetch implementation and never contact the live ELKW source.

## Task 1: Safe document downloader

**Files:**
- Create: `src/import/document-fetcher.js`
- Test: `test/document-fetcher.test.js`
- Create: `docs/superpowers/plans/2026-10-19-document-artifacts.md`

**Interfaces:**
- Produces `downloadDocument({ url, storageRoot, allowedHosts, fetchImpl, maxBytes })` returning `{ originalUrl, localPath, sha256, mimeType, size, fetchedAt }`.

- [ ] **Step 1: Write failing tests** for allowed-host validation, rejected responses, size limits, hash-based storage, changed-content versioning, and same-content idempotence.
- [ ] **Step 2: Run `npm test -- test/document-fetcher.test.js` and verify the missing-module failure.**
- [ ] **Step 3: Implement the downloader with temporary-file cleanup and atomic rename.**
- [ ] **Step 4: Run the focused test and then `npm test`.**
- [ ] **Step 5: Commit with `feat: sichere ELKW-Dokumentablage ergänzen`.**
