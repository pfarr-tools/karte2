CREATE TABLE geocode_cache (
  query TEXT PRIMARY KEY,
  provider_url TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
