# PDF Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract layout-preserving text and page metadata from stored PDFs through Poppler while keeping each document failure isolated.

**Architecture:** A small module validates the stored PDF path, invokes `pdfinfo` and `pdftotext -layout` through an injectable command runner, and writes a sibling text artifact atomically. It returns structured metadata; callers can catch one-document errors and record an import issue.

**Spec:** `docs/specs.md`

## Task 1: Poppler extraction adapter

**Files:**
- Create: `src/import/pdf-extractor.js`
- Test: `test/pdf-extractor.test.js`

**Interfaces:**
- Produces `extractPdfText({ pdfPath, textPath, runCommand })` returning `{ textPath, pageCount, text, extractionStatus }`.

- [ ] **Step 1: Write failing tests** for `pdfinfo` page parsing, `pdftotext -layout` invocation, atomic text output, and command failure propagation.
- [ ] **Step 2: Run `npm test -- test/pdf-extractor.test.js` and verify the missing-module failure.**
- [ ] **Step 3: Implement the adapter with no shell interpolation and a temporary output file.**
- [ ] **Step 4: Run the focused test and then `npm test`.**
- [ ] **Step 5: Commit with `feat: PDF-Text-Extraktion ergänzen`.**
