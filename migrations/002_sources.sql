CREATE UNIQUE INDEX sources_provider_url_unique
  ON sources (provider_id, url);
