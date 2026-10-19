function queryForLocation(location) {
  return [location.name, location.address].filter(Boolean).join(', ');
}

/**
 * Geocode unresolved locations through a Nominatim-compatible endpoint.
 * Results are cached and ambiguous responses are deliberately not placed on the map.
 */
export async function geocodeLocations({ database, providerUrl, fetchImpl = fetch, userAgent = 'karte2/0.1', dryRun = false }) {
  if (!providerUrl) throw new Error('A geocoder URL is required');
  const locations = database.prepare(`
    SELECT id, name, address FROM locations
    WHERE latitude IS NULL OR longitude IS NULL
    ORDER BY id
  `).all();
  const update = database.prepare('UPDATE locations SET latitude = ?, longitude = ?, geocoding_provider = ?, geocoding_confidence = ?, verified_at = ? WHERE id = ?');
  const insertCache = database.prepare('INSERT OR REPLACE INTO geocode_cache (query, provider_url, response_json, fetched_at) VALUES (?, ?, ?, ?)');
  const result = { inspected: locations.length, updated: 0, ambiguous: 0, cached: 0, failed: 0 };

  for (const location of locations) {
    const query = queryForLocation(location);
    const cacheKey = `${providerUrl}|${query}`;
    const cached = database.prepare('SELECT response_json FROM geocode_cache WHERE query = ? AND provider_url = ?').get(cacheKey, providerUrl);
    let candidates;
    if (cached) {
      candidates = JSON.parse(cached.response_json);
      result.cached += 1;
    } else {
      try {
        const url = new URL(providerUrl);
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('limit', '5');
        url.searchParams.set('q', query);
        const response = await fetchImpl(url, { headers: { 'accept': 'application/json', 'user-agent': userAgent } });
        if (!response.ok) throw new Error(`Geocoder request failed with HTTP ${response.status}`);
        candidates = await response.json();
        if (!Array.isArray(candidates)) throw new Error('Geocoder response was not an array');
        if (!dryRun) insertCache.run(cacheKey, providerUrl, JSON.stringify(candidates), new Date().toISOString());
      } catch {
        result.failed += 1;
        continue;
      }
    }
    if (candidates.length !== 1) {
      result.ambiguous += 1;
      if (!dryRun) update.run(null, null, providerUrl, candidates.length ? 'ambiguous' : 'not-found', new Date().toISOString(), location.id);
      continue;
    }
    const candidate = candidates[0];
    const latitude = Number(candidate.lat);
    const longitude = Number(candidate.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      result.failed += 1;
      continue;
    }
    result.updated += 1;
    if (!dryRun) update.run(latitude, longitude, providerUrl, 'approximate', new Date().toISOString(), location.id);
  }
  return result;
}
