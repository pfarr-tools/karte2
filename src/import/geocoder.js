import fs from 'node:fs';

export function normalizePoiLookup(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#13;|&#10;|\r|\n/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('de');
}

export function loadPoiReplacements(filePath) {
  if (!filePath) return new Map();
  try {
    const values = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return new Map(Object.entries(values).map(([key, value]) => [normalizePoiLookup(key), String(value).trim()]).filter(([, value]) => value));
  } catch {
    return new Map();
  }
}

function sanitizePlaceName(value) {
  let place = String(value ?? '').replace(/\s+/g, ' ').trim();
  place = place.replace(/\s+(?:Nord|Süd|Ost|West|Mitte)\b/gi, '');
  place = place.split(' ').filter((part, index) => index === 0 || !/kirche/i.test(part)).filter((part) => !/^(?:I|II|III|IV|V|VI|VII|VIII)$/i.test(part)).join(' ');
  if (place.includes('-')) place = place.split('-')[0];
  return place.trim();
}

export function buildGeocoderQueries(location, { replacements = new Map() } = {}) {
  const place = sanitizePlaceName(location.name);
  const queries = [];
  const add = (query) => {
    if (query && !queries.includes(query)) queries.push(query);
  };
  const replacement = replacements.get(normalizePoiLookup(location.name));
  add(replacement);
  if (location.address) add(`${location.address}, ${place}, Württemberg`);
  add(`Evangelisches Pfarramt ${place}, Württemberg`);
  add(`${place}, Württemberg`);
  return queries;
}

export async function fetchGeocodeCandidates({ query, providerUrl, fetchImpl = fetch }) {
  const url = new URL(providerUrl);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('q', query);
  const response = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'karte2/0.1' } });
  if (!response.ok) return [];
  const candidates = await response.json();
  return Array.isArray(candidates) ? candidates : [];
}

export async function findGeocodeCandidates({ location, providerUrl, replacements = new Map(), fetchImpl = fetch }) {
  if (!providerUrl) throw new Error('A geocoder URL is required');
  for (const query of buildGeocoderQueries(location, { replacements })) {
    const candidates = await fetchGeocodeCandidates({ query, providerUrl, fetchImpl });
    if (candidates.length) return { query, candidates };
  }
  return { query: null, candidates: [] };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(response) {
  const value = response.headers?.get?.('retry-after');
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0;
}

/**
 * Geocode unresolved locations through a Nominatim-compatible endpoint.
 * Results are cached and ambiguous responses are deliberately not placed on the map.
 */
export async function geocodeLocations({ database, providerUrl, replacements = new Map(), fetchImpl = fetch, userAgent = 'karte2/0.1', minIntervalMs = 1_000, maxRetries = 2, sleepImpl = wait, onProgress, dryRun = false }) {
  if (!providerUrl) throw new Error('A geocoder URL is required');
  const locations = database.prepare(`
    SELECT id, name, address FROM locations
    WHERE latitude IS NULL OR longitude IS NULL
    ORDER BY id
  `).all();
  const update = database.prepare('UPDATE locations SET latitude = ?, longitude = ?, geocoding_provider = ?, geocoding_confidence = ?, verified_at = ? WHERE id = ?');
  const insertCache = database.prepare('INSERT OR REPLACE INTO geocode_cache (query, provider_url, response_json, fetched_at) VALUES (?, ?, ?, ?)');
  const result = { inspected: locations.length, updated: 0, ambiguous: 0, cached: 0, failed: 0, failureReasons: {} };
  let lastRequestAt = 0;

  const recordFailure = (reason) => {
    result.failed += 1;
    result.failureReasons[reason] = (result.failureReasons[reason] ?? 0) + 1;
  };

  const report = (location, index, status, detail = null) => {
    onProgress?.({ current: index, total: locations.length, location, status, detail });
  };

  const loadCandidates = async (query) => {
    const cacheKey = `${providerUrl}|${query}`;
    const cached = database.prepare('SELECT response_json FROM geocode_cache WHERE query = ? AND provider_url = ?').get(cacheKey, providerUrl);
    if (cached) return { candidates: JSON.parse(cached.response_json), cached: true };
    try {
      const url = new URL(providerUrl);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      url.searchParams.set('q', query);
      let candidates;
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const waitFor = Math.max(0, minIntervalMs - (Date.now() - lastRequestAt));
        if (waitFor) await sleepImpl(waitFor);
        lastRequestAt = Date.now();
        const response = await fetchImpl(url, { headers: { 'accept': 'application/json', 'user-agent': userAgent } });
        if (response.ok) {
          candidates = await response.json();
          if (!Array.isArray(candidates)) throw new Error('invalid-json-shape');
          break;
        }
        const reason = `http-${response.status}`;
        if (attempt === maxRetries || (response.status !== 429 && response.status < 500)) throw new Error(reason);
        await sleepImpl(Math.max(retryAfterMilliseconds(response), minIntervalMs, 2 ** attempt * 1_000));
      }
      if (!dryRun) insertCache.run(cacheKey, providerUrl, JSON.stringify(candidates), new Date().toISOString());
      return { candidates, cached: false };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'request-failed' };
    }
  };

  for (const [index, location] of locations.entries()) {
    let candidates = [];
    let bestCandidates = [];
    let hadCandidates = false;
    let cached = false;
    let lastError = null;
    for (const query of buildGeocoderQueries(location, { replacements })) {
      const loaded = await loadCandidates(query);
      if (loaded.error) {
        lastError = loaded.error;
        continue;
      }
      cached ||= loaded.cached;
      candidates = loaded.candidates;
      hadCandidates ||= candidates.length > 0;
      if (candidates.length === 1) {
        bestCandidates = candidates;
        break;
      }
      if (candidates.length > bestCandidates.length) bestCandidates = candidates;
    }
    candidates = bestCandidates;
    if (cached) result.cached += 1;
    if (candidates.length === 0 && !hadCandidates && lastError) {
      recordFailure(lastError);
      report(location, index + 1, 'failed', lastError);
      continue;
    }
    if (candidates.length !== 1) {
      result.ambiguous += 1;
      report(location, index + 1, 'ambiguous', candidates.length ? `${candidates.length} Treffer` : 'kein Treffer');
      if (!dryRun) update.run(null, null, providerUrl, candidates.length ? 'ambiguous' : 'not-found', new Date().toISOString(), location.id);
      continue;
    }
    const candidate = candidates[0];
    const latitude = Number(candidate.lat);
    const longitude = Number(candidate.lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      recordFailure('invalid-coordinates');
      report(location, index + 1, 'failed', 'invalid-coordinates');
      continue;
    }
    result.updated += 1;
    report(location, index + 1, 'updated');
    if (!dryRun) update.run(latitude, longitude, providerUrl, 'approximate', new Date().toISOString(), location.id);
  }
  return result;
}
