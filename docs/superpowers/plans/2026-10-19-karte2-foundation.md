# karte2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a Docker-first Node.js foundation for karte2 with fail-closed test isolation, versioned SQLite migrations, and a central ELKW source registry.

**Architecture:** A small ES-module application separates configuration, database safety, migrations, and source definitions. The root `./karte` script is the only normal host entry point and delegates to Docker Compose; the first implementation slice runs entirely offline except for future importer work. SQLite data and downloaded source artifacts are persistent runtime state, while test runs use a dedicated temporary directory with no production mounts.

**Tech Stack:** Node.js 24, Fastify, better-sqlite3, Vitest, Docker Compose, plain JavaScript ES modules with JSDoc.

**Spec:** `docs/specs.md`

## Global Constraints

- Tests MUST use dedicated SQLite databases, never development or production databases.
- A test container MUST NOT mount the production database volume or secrets.
- Every test run gets its own isolated temporary SQLite database.
- Require `NODE_ENV=test` and validate database path and resolved real path before migrations or cleanup.
- Reject production/dev database paths even if passed through an environment variable or symlink.
- Source definitions must have stable IDs and descriptive names in `config/sources.js`.
- No obsolete `a&b` source is implemented.
- An ELKW-address access restriction is future work and is not required by this slice.

## Review Focus

- A test database path that equals or is nested under runtime storage must abort before opening SQLite — covered by Task 1 isolation tests.
- A symlinked test path resolving into runtime storage must abort — covered by Task 1 path-resolution tests.
- A non-test `NODE_ENV` must abort even when the path looks temporary — covered by Task 1 environment tests.
- Re-running migrations must be harmless and preserve foreign-key enforcement — covered by Task 2 migration tests.
- Source registry IDs and URLs must be explicit and free of parser-local hard-coded URLs — covered by Task 3 registry tests.

### Task 1: Isolated test database safety

**Files:**
- Create: `package.json`
- Create: `src/db/safety.js`
- Test: `test/db-safety.test.js`

**Interfaces:**
- Produces `assertSafeDatabasePath({ nodeEnv, databasePath, testRoot, runtimeRoot })` and `createTestDatabasePath(testRoot)` for later database and test-container code.

- [ ] **Step 1: Write failing tests** for rejecting non-test environments, runtime paths, parent paths, and symlink escapes, plus accepting a unique path under the dedicated test root.
- [ ] **Step 2: Run `npm test -- test/db-safety.test.js` and verify the failure is caused by missing safety functions.**
- [ ] **Step 3: Implement the minimal path validation and unique test-path creation in `src/db/safety.js`.** Resolve existing ancestors with `realpath`, reject runtime-root containment, require `NODE_ENV=test`, and do not delete anything.
- [ ] **Step 4: Run the focused test and then `npm test` to verify the safety suite passes.**

### Task 2: Docker wrapper and migration-capable SQLite connection

**Files:**
- Create: `Dockerfile`
- Create: `compose.yaml`
- Create: `compose.test.yaml`
- Create: `karte`
- Create: `src/config.js`
- Create: `src/db/connection.js`
- Create: `src/db/migrate.js`
- Create: `migrations/001_initial.sql`
- Test: `test/db-migrations.test.js`
- Modify: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Consumes `assertSafeDatabasePath` from Task 1.
- Produces `openDatabase({ filename, nodeEnv, testRoot, runtimeRoot })` and `migrateDatabase(database)`.

- [ ] **Step 1: Write failing migration tests** asserting required SQLite pragmas, core tables, foreign keys, and idempotent repeated migration.
- [ ] **Step 2: Run `npm test -- test/db-migrations.test.js` and verify the expected missing-module failure.**
- [ ] **Step 3: Implement the SQLite connection, migration runner, initial provenance schema, Docker services, environment example, and safe `./karte test` dispatch.** The test service must have no runtime volume or secrets mount and must set `NODE_ENV=test`.
- [ ] **Step 4: Run the focused migration test and the isolated wrapper command `./karte test`; record any Docker-environment blocker without weakening safety checks.**

### Task 3: Central source registry

**Files:**
- Create: `config/sources.js`
- Create: `src/db/source-registry.js`
- Test: `test/source-registry.test.js`
- Create: `migrations/002_sources.sql`

**Interfaces:**
- Produces `sourceDefinitions` and `syncSourceDefinitions(database, definitions)`.
- Registers the ELKW listing page as one stable source with parser key `elkw-publication-page`; publication categories remain section data, not separate hidden URLs.

- [ ] **Step 1: Write failing tests** for stable source identity, descriptive provider/source names, canonical URL, parser key, and idempotent synchronization.
- [ ] **Step 2: Run `npm test -- test/source-registry.test.js` and verify it fails because the registry is absent.**
- [ ] **Step 3: Implement the registry, source-table migration, and synchronization without embedding URLs in parser modules.**
- [ ] **Step 4: Run `npm test` and `git diff --check`; inspect the resulting schema and registry files.**

## Coverage Gaps for Later Plans

This foundation plan does not yet implement PDF downloading/extraction, source-page parsing, position matching, import anomaly handling, geocoding, public UI, administration, scheduler, or backup/restore. Those belong to separate plans after representative current ELKW PDF fixtures are checked in.
