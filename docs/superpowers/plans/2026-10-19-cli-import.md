# CLI Import Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose safe migration, status, and explicit ELKW import operations through the root `./karte` wrapper.

**Architecture:** `src/cli.js` owns command parsing and runtime wiring. It opens the configured database, applies migrations, synchronizes the source registry, and invokes the existing page importer. Live HTTP is only performed for an explicit `import`; `--dry-run` parses the fetched page without writing SQLite.

**Spec:** `docs/specs.md`

## Task 1: Runtime CLI wiring

**Files:**
- Create: `src/cli.js`
- Test: `test/cli.test.js`
- Modify: `karte`

**Interfaces:**
- Produces `parseCliArgs(argv)` and `runCli(argv, dependencies)`.

- [ ] **Step 1: Write failing tests** for command parsing, dry-run behavior, and safe help output.
- [ ] **Step 2: Run `npm test -- test/cli.test.js` and verify the missing-module failure.**
- [ ] **Step 3: Implement CLI commands `migrate`, `status`, `import`, and `import --dry-run`; wire the root wrapper without implicit destructive operations.**
- [ ] **Step 4: Run focused/full tests and `./karte --help`.**
- [ ] **Step 5: Commit with `feat: Import-CLI anbinden`.**
