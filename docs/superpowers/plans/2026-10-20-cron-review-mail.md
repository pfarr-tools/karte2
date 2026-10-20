# Cron Review Mail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide a single cron-safe `./karte sync` command that imports and geocodes ELKW data, emails a deduplicated expiring signed review link for unresolved locations, and lets the recipient resolve candidates in a German web page.

**Architecture:** Keep import and batch geocoding as existing services, add a small review persistence/service layer for candidate snapshots, HMAC links and notification fingerprints, and use Fastify server-rendered HTML for the review page. SMTP delivery is isolated behind an injectable mailer. The scheduler and one-shot CLI call the same orchestration function.

**Tech Stack:** Node.js 24 ES modules, Fastify, better-sqlite3, Bootstrap 5, Leaflet, Vitest, Docker Compose, SMTP via Nodemailer.

**Spec:** `docs/superpowers/specs/2026-10-20-cron-review-mail-design.md`

## Global Constraints

- Never expose unresolved locations publicly; only `approximate` and `verified` coordinates are public.
- Review candidates are persisted snapshots; review pages never depend on a fresh geocoder request to render.
- Tokens are HMAC-SHA-256 signed, expiring, compared in constant time, and stored only as hashes.
- Tests use isolated SQLite databases and fake geocoder/SMTP/network dependencies.
- Import failures and mail failures must not delete or alter existing source data.
- All public, review and mail UI text is German.
- `.env` is never modified or committed; document all new variables in `.env.example`, `docs/handbuch.md` and `docs/operations.md`.

## Review Focus

- An expired or tampered review URL must return an error and no candidate data; test in Task 3.
- A candidate from another review run must not be accepted; test in Task 4.
- Repeated cron runs with the same unresolved fingerprint must send no duplicate mail; test in Task 2.
- SMTP failure must preserve import/geocoding results and be visible in the sync result; test in Task 2.
- Empty or markerless datasets must still open on the correct Baden-Württemberg fallback while marker datasets fit their bounds; test in Task 5.

### Task 1: Correct the predecessor-compatible map initialization

**Files:**
- Modify: `src/server.js` map initialization and `render()` fallback
- Test: `test/server.test.js`

**Interfaces:**
- Produces the predecessor initial view `[46.05, 11.05]` at zoom `5`.
- Produces a Baden-Württemberg fallback bounds call when no valid public marker exists.

- [ ] **Step 1: Write failing HTML assertions** for the predecessor `setView` values and the empty-marker Baden-Württemberg fallback.
- [ ] **Step 2: Run the focused server test and verify it fails** on the current `[48.6, 9.0], 8` initialization.
- [ ] **Step 3: Implement the initial view and fallback**, retaining URL map-state precedence and marker `fitBounds` behavior.
- [ ] **Step 4: Run the focused server test and verify it passes.**
- [ ] **Step 5: Commit** with `fix: Kartenstart an Vorgänger angleichen`.

### Task 2: Add review persistence, signed tokens and SMTP notification

**Files:**
- Create: `migrations/008_geocode_reviews.sql`
- Create: `src/review/geocode-review.js`
- Create: `src/mail/mailer.js`
- Create: `src/sync.js`
- Modify: `src/config.js`, `src/cli.js`, `src/scheduler.js`, `package.json`, `package-lock.json`
- Test: `test/geocode-review.test.js`, `test/mailer.test.js`, `test/sync.test.js`

**Interfaces:**
- `createReviewRun(database, { locations, candidates, expiresAt }) -> { reviewId, token }`.
- `verifyReviewToken(database, token, secret, now) -> { reviewId } | null`.
- `loadReview(database, reviewId) -> review data with locations, publications, documents and candidates`.
- `resolveReviewCandidate(database, { reviewId, locationId, candidateId, coordinates }) -> result`.
- `sendUnresolvedReviewMail({ config, review, transport }) -> { sent: true }`.
- `runSync({ database, importImpl, geocodeImpl, reviewImpl, mailImpl }) -> result`, where `geocodeImpl` returns `unresolved: [{ location, query, candidates }]`.

- [ ] **Step 1: Write migration and service tests first** for schema creation, token expiry/tampering, candidate snapshots, deterministic fingerprints, mail deduplication, SMTP failure reporting, and sync ordering.
- [ ] **Step 2: Run the new tests to verify the expected failures.**
- [ ] **Step 3: Add migration 008** with `geocode_review_runs` and `geocode_review_candidates`, foreign keys, timestamps, fingerprint and sent/completed state.
- [ ] **Step 4: Implement `src/review/geocode-review.js`** with HMAC signing, token hashing, constant-time verification, review loading, candidate validation and verified location updates.
- [ ] **Step 5: Add Nodemailer and implement `src/mail/mailer.js`** with an injectable transport and no credential logging.
- [ ] **Step 6: Implement `runSync`** to call import, batch geocode, persist ambiguous candidate snapshots, create/deduplicate review notifications and aggregate non-destructive errors.
- [ ] **Step 7: Wire `sync` into CLI and scheduler**, keeping `import` and `geocode` available independently. Add config values `APP_URL`, `REVIEW_LINK_SECRET`, `REVIEW_LINK_TTL_SECONDS`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, and `UNRESOLVED_MAIL_TO`.
- [ ] **Step 8: Run the task tests and the stable isolated test command; verify all pass or record the existing Node/better-sqlite3 cleanup limitation separately.**
- [ ] **Step 9: Commit** with `feat: Sync und Review-Benachrichtigungen einführen`.

### Task 3: Add the signed German review page and actions

**Files:**
- Modify: `src/server.js`
- Test: `test/review-server.test.js`

**Interfaces:**
- `GET /review/geocoding/:token` renders the review page after token verification.
- `POST /review/geocoding/:token/locations/:locationId` accepts only a candidate belonging to that review and validates coordinates.

- [ ] **Step 1: Write failing Fastify tests** for valid rendering, expired/tampered token rejection, original-document links, escaped candidate text, candidate selection and skip behavior.
- [ ] **Step 2: Run the focused server tests and verify they fail.**
- [ ] **Step 3: Implement the signed GET/POST routes** using the review service; keep them separate from bearer-protected `/admin/*` routes.
- [ ] **Step 4: Implement the new-search action** by accepting a query, fetching candidates through the injectable geocoder service, and replacing only that location's candidate snapshot in the active review run.
- [ ] **Step 5: Render German Bootstrap HTML** showing position, location, Kirchenbezirk, original PDF/source links, query, candidates, new-search form and skip action.
- [ ] **Step 6: Run focused review-server tests and verify they pass.**
- [ ] **Step 7: Commit** with `feat: signierte Geocoding-Reviewseite bereitstellen`.

### Task 4: Make geocoder output persist review candidates

**Files:**
- Modify: `src/import/geocoder.js`, `src/sync.js`
- Test: `test/geocoder.test.js`, `test/sync.test.js`

**Interfaces:**
- Batch geocoding returns unresolved locations with the query and candidate payload needed by `createReviewRun` without changing the safe no-marker rule.

- [ ] **Step 1: Write failing tests** asserting ambiguous candidates are returned/persisted while `locations.latitude` and `longitude` remain null.
- [ ] **Step 2: Run the focused tests and verify failure.**
- [ ] **Step 3: Extend the geocoder result contract** with serializable unresolved candidate records and preserve cache/rate-limit behavior.
- [ ] **Step 4: Connect those records to review-run persistence and verify resolved locations are excluded from later runs.**
- [ ] **Step 5: Run geocoder and sync tests and verify they pass.**
- [ ] **Step 6: Commit** with `feat: Geocoding-Kandidaten für Reviews speichern`.

### Task 5: Document operations and verify the Docker cron path

**Files:**
- Modify: `karte`, `compose.yaml`, `.env.example`, `AGENTS.md`, `docs/handbuch.md`, `docs/operations.md`
- Test: `test/docker-build.test.js`, `test/cli.test.js`

**Interfaces:**
- `./karte sync` runs `node src/cli.js sync` through Compose without an implicit image rebuild.
- The scheduler calls `runSync` and shares the same environment variables.

- [ ] **Step 1: Write failing wrapper/config tests** for the `sync` command, scheduler environment and documented mail variables.
- [ ] **Step 2: Run the focused tests and verify failure.**
- [ ] **Step 3: Wire the root wrapper and Compose service** without changing the test isolation service or mounting production data into tests.
- [ ] **Step 4: Update the complete German manual, operations guide and AGENTS documentation** with cron, SMTP, token expiry, review workflow and recovery behavior.
- [ ] **Step 5: Run `./karte --help`, `docker compose config`, focused tests and the isolated suite.**
- [ ] **Step 6: Commit** with `docs: Cron-Review-Betrieb dokumentieren`.

### Task 6: Final verification and branch handoff

**Files:**
- No product files unless verification exposes a required defect.

- [ ] **Step 1: Run the full stable isolated test sequence** and `git diff --check`.
- [ ] **Step 2: Run a local fake-SMTP sync integration test** proving no duplicate notification for an unchanged unresolved fingerprint.
- [ ] **Step 3: Inspect `git status`, migration ordering, `.env` preservation and Compose mounts.**
- [ ] **Step 4: Commit any narrowly scoped verification fix separately.**
- [ ] **Step 5: Report exact test evidence, known native test-runner limitation, configuration requirements and cron invocation.**
