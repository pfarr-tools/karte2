# AGENTS.md — Instructions for Codex and coding agents

## Mission

Implement **karte2**, a small Docker-based Node.js application for collecting, parsing and mapping official ELKW parish vacancies. Read `specs.md` before planning or editing code. Treat its non-negotiable invariants as hard requirements.

## Priorities

1. **Never touch production/development data from tests.**
2. **Always preserve explicit provenance for imported data.**
3. **Never destroy existing data because a scrape or PDF parse fails.**
4. Keep the architecture simple, modular, and reproducible through Docker.
5. Preserve feature parity with the predecessor only after inspecting and documenting actual features.

## Stack and conventions

Use Node.js 24 LTS, ES modules, Fastify, `better-sqlite3`, Cheerio, Poppler PDF extraction, Bootstrap 5, Leaflet, vanilla JS and Vitest unless a concrete technical reason requires otherwise. Prefer plain JS with JSDoc over a transpilation pipeline. No Laravel, SPA framework, Redis, MySQL or AI API by default. Use clear English names in code, German labels in the public UI. Favor small modules with explicit dependencies and no hidden global state.

## Mandatory test safety rules

- `./karte test` MUST run in a dedicated Docker test service/container without application database volumes or production secrets mounted.
- Every test run gets its own isolated temporary SQLite database; unit tests may use `:memory:` where appropriate.
- Require `NODE_ENV=test` and validate database path and resolved real path before migrations, resets, truncations or cleanup.
- Reject production/dev database paths even if passed through an environment variable or symlink.
- Do not run tests through `./karte shell` in the production container.
- Mock network access and geocoding in normal tests; never depend on a live source for the core test suite.
- Add negative tests proving that invalid test DB configurations abort safely.
- Never weaken isolation checks just to make tests pass.

## Mandatory provenance rules

- Source definitions must have stable IDs and descriptive names in `config/sources.js` (or a documented equivalent central registry).
- No untracked hard-coded URLs scattered through parser modules.
- Each imported document stores its source ID, original URL, retrieval time and SHA-256.
- Each publication links to the source and, where applicable, the document and source section.
- Preserve source versions and historical publications.
- Distinguish imported values from editorial overrides; never overwrite overrides during sync.
- Surface source name and original document link in the UI.

## Import safety

Use idempotent imports, explicit validation and source-specific status reporting. Never delete/deactivate records following an unsuccessful or suspiciously incomplete crawl. Handle single malformed PDFs independently. Matching ambiguities and uncertain geocoding must be reviewable rather than silently guessed. Keep test fixtures for representative PDF formats and page structures.

## Development workflow

1. Inspect the repository and `specs.md` before changing anything.
2. For the first implementation task, inspect `https://codeberg.org/pfarr.tools/karte` and the current ELKW publication page and PDFs where network access permits. Document verified predecessor features and parser assumptions; if inaccessible, record that limitation instead of inventing details.
3. Propose a short implementation plan for nontrivial changes.
4. Implement one coherent change at a time, with tests and migrations where appropriate.
5. Run lint/checks and the **isolated** test suite before considering work complete.
6. Summarize changes, tests run, remaining risks and any unverified external assumptions.

## Documentation maintenance

- The complete German user and administrator manual is `docs/handbuch.md`.
- Update `docs/handbuch.md` in the same change whenever the CLI, HTTP endpoints,
  data model, import behavior, configuration, scheduler, backups or public UI
  changes.
- Update `docs/operations.md` as well when an operational command, deployment
  procedure, environment variable or recovery procedure changes.
- Do not document behavior that is only planned; verify commands and endpoint
  names against the implementation before committing.
- Treat the optional local `poi/` directory as operational input data: do not
  commit its large generated JSON files unless explicitly requested.

## CLI and operations

Use the root `./karte` script as the single normal operator entry point. Keep host dependencies to Docker + Compose. Provide safe `--help`, `--dry-run` where relevant, and meaningful nonzero exit codes. Never implicitly reset the database. Keep configuration in documented files and secrets out of git. Preserve backups and stored PDFs across rebuilds.

## Definition of done

A change is complete only if it follows `specs.md`, adds/updates relevant automated tests, does not weaken test DB isolation or provenance, documents new configuration, and reports any limitations honestly. If instructions conflict, prioritize data safety and ask before destructive action.
