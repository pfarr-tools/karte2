# karte2 — Product and Technical Specification

Version: 0.1 · 2026-10-19

## 1. Goal

Build a small, Docker-based web application displaying parish ministry vacancies of the Evangelische Landeskirche in Württemberg (ELKW) on an OpenStreetMap-based map. It discovers official listings, downloads linked PDFs, extracts structured vacancy information, stores it locally, and presents searchable, filterable results with explicit provenance.

The predecessor is https://codeberg.org/pfarr.tools/karte . **Before claiming feature parity, inspect the predecessor repository and document its actual functionality.** The old UI and source ingestion must be replaced. Do not invent predecessor features or claim they have been verified.

The predecessor inspection confirmed that its additional `a&b` publication feed is
obsolete and is not part of karte2. karte2 uses the current ELKW publication
page and the official PDFs linked from that page as its source boundary.

## 2. Non-negotiable invariants

1. **Test isolation:** Tests MUST use dedicated SQLite databases, never development or production databases. A test container MUST NOT mount the production database volume or secrets. Tests fail closed if isolation cannot be established. Never execute destructive operations against a non-test DB.
2. **Explicit data sources:** Every provider, source page/section, source document and imported publication MUST be clearly identified and traceable. No hidden hard-coded source URLs inside parser logic. Preserve original URLs, retrieval times and document hashes.
3. **Import safety:** A failed, incomplete or anomalously empty scrape MUST NOT delete or deactivate existing records. No destructive synchronization on a single missing source result.
4. **Manual corrections persist:** Automated imports MUST NOT overwrite explicitly stored editorial overrides.
5. **Original source authoritative:** Extracted fields are aids to discovery; link to the original official publication and distinguish announced positions from positions actually open for application.

## 3. Stack

- Node.js 24 LTS, modern JavaScript ES modules, optional JSDoc typing; avoid TypeScript compilation unless justified.
- Fastify HTTP server; Eta or Nunjucks server-side templates.
- SQLite via `better-sqlite3`; versioned SQL migrations; foreign keys enabled, WAL mode, busy timeout.
- Cheerio for source-page HTML parsing; Poppler `pdftotext -layout` and `pdfinfo` for PDF extraction; optionally pdfjs-dist where helpful.
- Bootstrap 5, Leaflet, OpenStreetMap tiles, marker clustering; vanilla browser JavaScript. No SPA framework required.
- Vitest for tests; Docker Compose for deployment.
- One app service plus an optional scheduler service using the same image; use existing host reverse proxy. No mandatory Redis, MySQL, Laravel, queues or cloud AI service.

## 4. Official source and source registry

Primary official listing page:

https://www.elk-wue.de/wir/oberkirchenrat/dezernat-3-ausbildung-und-pfarrdienst/referat-31-planung-einsatz-verwaltung-pfarrdienst/ausschreibungen-und-liste-zu-besetzender-pfarrstellen

The importer must discover categories from the **current** page structure, rather than assuming stable CSS selectors or file names. Expected semantic categories (verify against current page):

- `advertised`: current formal vacancy announcements, possibly grouped into rounds with application deadlines;
- `available`: available positions for which interest can be registered;
- `upcoming`: list of positions to be filled / advance information, **not** itself an invitation to apply.

Model these as separate publications, not mutually exclusive properties of a position. Categories and documents may change over time. Source definitions live centrally in `config/sources.js` with stable IDs, provider names, source names, URLs, enabled status and parser identifiers. Store the source registry in the database or synchronize it by ID.

Data provenance hierarchy: provider -> source -> source section/round -> document -> publication -> extracted field. For manually edited fields, also record override provenance.

## 5. Data model

Use versioned migrations and enforce foreign keys. Suggested entities:

- `providers`: id, name, homepage.
- `sources`: id, provider_id, name, url, kind, enabled, parser_key.
- `source_sections`: id, source_id, label, category, round, deadline, observed_at.
- `documents`: id, source_id, original_url, local_path, sha256, mime_type, fetched_at, extracted_text_path, extraction_status, metadata. Preserve versions rather than silently replacing changed PDFs.
- `positions`: id, stable_slug, normalized_name, type, deanery, employment_percentage nullable, employment_description, description, primary_location_id nullable, timestamps.
- `publications`: id, position_id, source_id, section_id nullable, document_id nullable, category, published_at nullable, application_deadline nullable, first_seen_at, last_seen_at, current_state, extraction_confidence.
- `locations`: id, name, address nullable, latitude nullable, longitude nullable, geocoding_provider, geocoding_confidence, verified_at.
- `position_locations`: position_id, location_id, role.
- `extracted_fields`: publication_id, field_name, raw_value, normalized_value, document_page nullable, evidence_excerpt nullable, confidence.
- `position_overrides`: position_id, field_name, override_value, editor, reason, updated_at.
- `position_history`: position_id, event_type, before_json, after_json, occurred_at.
- `import_runs`: id, source_id, started_at, completed_at, status, counts_json, error_summary.
- `import_issues`: import_run_id, document_id nullable, severity, code, message, context_json, resolved_at.

Names and exact columns may evolve, but identity, provenance, document versioning and override semantics are required. A position may have several publications and locations. Missing/ambiguous values must remain null or be flagged, not guessed.

## 6. Ingestion pipeline

1. Fetch official HTML with timeouts, user agent, retry/backoff and rate limiting.
2. Identify sections, rounds, deadlines and links, recording the parent source and context.
3. Download changed/new PDFs with size limits, MIME checks, safe file paths and SHA-256 hashes.
4. Extract text, keeping original PDFs and extraction artifacts for debugging.
5. Parse known structured patterns (names, locations, deaneries, percentages, vacancy types, procedures, dates); use modular strategies for single vacancy PDFs, multi-column layouts, special posts and tabular vacancy lists.
6. Resolve position identity across documents and publication categories with deterministic matching and explicit review flags for ambiguity.
7. Geocode missing/changed locations, cache results, and avoid repeated external calls.
8. Validate anomalies and commit safely. An individual malformed PDF is recorded as an issue without invalidating successful items.

Repeated imports must be idempotent. Do not infer that a position is filled solely from an expired deadline or a missing link. Mark publications missing only after a configurable number of **successful and complete** source observations; retain historical records. A large unexpected drop in source entries requires review and must not automatically deactivate records.

Parsing must be testable offline against checked-in non-sensitive fixture samples. An external LLM extractor is optional, never required for core functionality.

## 7. Geocoding

All positions are in Baden-Württemberg, but not every post maps cleanly to a single address. Prefer explicitly published duty addresses, then reliably identified municipalities. Support multiple work locations, regional posts and representative points flagged as approximate. Never silently assign uncertain coordinates. Provide manual marker adjustment. Use a configurable Nominatim-compatible provider with caching and respect its usage policy. Do not geocode on every page view.

## 8. Public interface

German UI, shared pfarr.tools visual language with Bootstrap 5.

- Default Leaflet map framed to Baden-Württemberg, marker clusters, visually distinct publication categories and overlapping-location handling.
- Search by position name, place and description; filters for category, position type, employment percentage, deanery, application deadline and appointment procedure where data is available.
- Synchronized map/list results; responsive mobile map/list switch; shareable URL with filter and map state.
- Position details with name, category, duty scope, deanery, location(s), relevant deadlines, source and retrieval date, extracted description and **original PDF link**.
- Historical publications where available, with clear distinction between current and archived information.
- Accessible sortable table/list alternative; CSV export of filtered results.
- Visible disclaimer that karte2 is unofficial and original ELKW documents govern.

Avoid implying a vacancy is open for application when its publication category is `upcoming` or when the deadline is unknown/expired.

## 9. Administration

Public browsing requires no account. Protect admin endpoints (e.g. single admin login or reverse-proxy authentication). Provide import status/history, manual import trigger, parsing/geocoding issues, document reprocessing, matching corrections and location edits. Store editorial overrides separately from imported values. Restrict state-changing endpoints and protect against CSRF if using cookie sessions.

An optional restriction of public or administrative access to verified
`@elkw.de`/`@elk-wue.de` addresses is a future extension. It is intentionally
not required for the current implementation and must not block public browsing
or the initial administration design.

## 10. CLI and Docker

An executable root script `./karte` wraps Docker Compose and CLI commands. Minimum intended commands:

```bash
./karte up
./karte down
./karte restart
./karte build
./karte logs
./karte shell
./karte install
./karte migrate
./karte import
./karte import --dry-run
./karte import --force
./karte import --file path/to/file.pdf
./karte geocode
./karte status
./karte backup create
./karte backup restore
./karte test
```

Commands must have useful help text and safe defaults. Host requirements: Docker and Docker Compose only. Run Node, Poppler and SQLite tooling in containers. Expose a configurable internal port for an existing reverse proxy. Keep database, PDFs and logs on persistent volumes. Scheduler can be a second service sharing the app image, with a daily import and non-overlapping job lock.

### Test environment isolation (mandatory implementation detail)

- Separate `compose.test.yaml` or equivalent isolated test service with **no production storage or secret mounts**; mount fixtures and a dedicated temporary test directory only.
- `./karte test` always invokes the isolated service and never uses the running app container's SQLite path.
- Create a unique temporary SQLite file per test run (and per worker if parallel); in-memory DB is allowed for isolated unit tests, but migration/integration tests use real dedicated files.
- Set `NODE_ENV=test` explicitly and require a test-specific database path within the dedicated test directory. Reject any path equal to, nested in, or resolving via symlinks to a non-test storage path.
- Disable real external HTTP, geocoding and scheduled imports during tests by default; mock with fixtures. Tests must never fetch the live ELKW page unless explicitly designated as separate, read-only integration checks.
- Test setup and cleanup must fail closed if any safety guard fails. Never execute a generic `rm -rf` against user-provided or application storage paths.

## 11. Configuration and backups

Use `.env.example` with non-secret defaults, actual `.env` ignored by git. Configure source registry in `config/sources.js`, source-specific parsing independently, geocoder URL, import interval, database path, admin access and server port. Do not embed secrets in committed config.

Backup includes a consistent SQLite snapshot via SQLite backup API, PDF archive, editorial overrides and required deployment configuration/secrets handled securely. Provide restore validation; never overwrite a running database without explicit confirmation. External backup destinations may be added later via provider-neutral configuration.

## 12. Security, accessibility and observability

Validate and escape all extracted content before HTML rendering. Do not execute PDFs. Restrict downloads to trusted source domains and safe redirect destinations; cap size and timeouts. Use parameterized SQL. Health endpoint and structured logs should report service state, last successful import, source-specific errors and suspicious source changes. Support keyboard navigation and an accessible list alternative to map controls.

## 13. Acceptance criteria

- All currently recognized ELKW publication categories and their source sections can be ingested with explicit provenance.
- Same document imported twice creates no duplicate; changed document creates a traceable version.
- A position can appear in several categories/rounds without accidental duplication.
- Parser errors and a failed/empty source fetch cannot wipe the database.
- Source URLs and documents are traceable from every public publication.
- Manual corrections survive imports.
- Uncertain locations are identified and reviewable.
- Map/list filters agree; public pages are responsive and usable without a map.
- `./karte test` uses an isolated DB and isolated Docker mounts, with automated negative tests for misconfiguration.
- A clean Docker deployment can restore persistent state from backup.

## 14. Delivery phases

**Phase 0 — Discovery:** inspect predecessor repository, inspect current ELKW page and representative PDFs, record verified features and source formats, create fixture set and revise this spec based on findings. The obsolete predecessor `a&b` feed is explicitly excluded; an ELKW-address access restriction remains future work.

**Phase 1 — Core:** Docker, CLI, schema, source registry, downloads, PDF extraction, parser, matching, tests.

**Phase 2 — UI:** geocoding, map, list, filters, details, Bootstrap layout.

**Phase 3 — Operations:** admin, scheduler, backup/restore, monitoring, hardening, comprehensive integration tests.

Do not claim predecessor parity or reliable parsing of all official formats until verified by fixtures and tests.
