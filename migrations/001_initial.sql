CREATE TABLE providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  homepage TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  parser_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE source_sections (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  round TEXT,
  deadline TEXT,
  observed_at TEXT NOT NULL
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  original_url TEXT NOT NULL,
  local_path TEXT,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  fetched_at TEXT NOT NULL,
  extracted_text_path TEXT,
  extraction_status TEXT NOT NULL DEFAULT 'pending',
  metadata_json TEXT
);

CREATE TABLE positions (
  id INTEGER PRIMARY KEY,
  stable_slug TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  type TEXT,
  deanery TEXT,
  employment_percentage REAL,
  employment_description TEXT,
  description TEXT,
  primary_location_id INTEGER REFERENCES locations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  latitude REAL,
  longitude REAL,
  geocoding_provider TEXT,
  geocoding_confidence TEXT,
  verified_at TEXT
);

CREATE TABLE publications (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES positions(id),
  source_id TEXT NOT NULL REFERENCES sources(id),
  section_id INTEGER REFERENCES source_sections(id),
  document_id INTEGER REFERENCES documents(id),
  category TEXT NOT NULL,
  published_at TEXT,
  application_deadline TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  current_state TEXT NOT NULL,
  extraction_confidence TEXT
);

CREATE TABLE position_locations (
  position_id INTEGER NOT NULL REFERENCES positions(id),
  location_id INTEGER NOT NULL REFERENCES locations(id),
  role TEXT NOT NULL,
  PRIMARY KEY (position_id, location_id, role)
);

CREATE TABLE extracted_fields (
  id INTEGER PRIMARY KEY,
  publication_id INTEGER NOT NULL REFERENCES publications(id),
  field_name TEXT NOT NULL,
  raw_value TEXT,
  normalized_value TEXT,
  document_page INTEGER,
  evidence_excerpt TEXT,
  confidence TEXT
);

CREATE TABLE position_overrides (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES positions(id),
  field_name TEXT NOT NULL,
  override_value TEXT NOT NULL,
  editor TEXT NOT NULL,
  reason TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (position_id, field_name)
);

CREATE TABLE position_history (
  id INTEGER PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES positions(id),
  event_type TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  occurred_at TEXT NOT NULL
);

CREATE TABLE import_runs (
  id INTEGER PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,
  counts_json TEXT,
  error_summary TEXT
);

CREATE TABLE import_issues (
  id INTEGER PRIMARY KEY,
  import_run_id INTEGER NOT NULL REFERENCES import_runs(id),
  document_id INTEGER REFERENCES documents(id),
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  context_json TEXT,
  resolved_at TEXT
);
