CREATE UNIQUE INDEX documents_source_url_hash_unique
  ON documents (source_id, original_url, sha256);

CREATE INDEX source_sections_lookup
  ON source_sections (source_id, category, round);
