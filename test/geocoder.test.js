import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { buildGeocoderQueries, geocodeLocations, normalizePoiLookup } from '../src/import/geocoder.js';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

function database() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-geocode-'));
  roots.push(root);
  const testRoot = path.join(root, 'test');
  const db = openDatabase({ filename: path.join(testRoot, 'db.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot: path.join(root, 'runtime') });
  migrateDatabase(db);
  db.prepare('INSERT INTO locations (name, address) VALUES (?, ?)').run('Beispielort', 'Kirchplatz 1');
  db.prepare('INSERT INTO locations (name, address) VALUES (?, ?)').run('Mehrdeutiger Ort', null);
  return db;
}

describe('geocoder', () => {
  it('uses the predecessor replacement mapping for imported vacancy names', () => {
    const replacements = new Map([
      [normalizePoiLookup('Rohr-Dürrlewang&#13;\n  II'), 'Dürrlewang'],
    ]);

    expect(buildGeocoderQueries({ name: 'Rohr-Dürrlewang II', address: null }, { replacements })).toEqual([
      'Dürrlewang',
      'Evangelisches Pfarramt Rohr, Württemberg',
      'Rohr, Württemberg',
    ]);
  });

  it('builds Pfarramt-friendly place queries from regional vacancy names', () => {
    expect(buildGeocoderQueries({ name: 'Kirchheim unter Teck West II', address: null })).toEqual([
      'Evangelisches Pfarramt Kirchheim unter Teck, Württemberg',
      'Kirchheim unter Teck, Württemberg',
    ]);
  });

  it('caches a unique result and leaves ambiguous results without coordinates', async () => {
    const db = database();
    let requests = 0;
    const fetchImpl = async (url) => {
      requests += 1;
      if (url.toString().includes('Mehrdeutiger')) return { ok: true, async json() { return [{ lat: '48', lon: '9' }, { lat: '49', lon: '10' }]; } };
      expect(url.toString()).toContain('Beispielort');
      return { ok: true, async json() { return [{ lat: '48.5', lon: '9.1', display_name: 'Beispielort' }]; } };
    };
    const first = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl, minIntervalMs: 0 });
    const second = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl, minIntervalMs: 0 });

    expect(first).toMatchObject({ updated: 1, ambiguous: 1 });
    expect(second).toMatchObject({ cached: 1, ambiguous: 1 });
    expect(requests).toBe(3);
    expect(db.prepare('SELECT latitude, longitude, geocoding_confidence FROM locations WHERE id = 1').get())
      .toEqual({ latitude: 48.5, longitude: 9.1, geocoding_confidence: 'approximate' });
    expect(db.prepare('SELECT latitude, longitude, geocoding_confidence FROM locations WHERE id = 2').get())
      .toEqual({ latitude: null, longitude: null, geocoding_confidence: 'ambiguous' });
    db.close();
  });

  it('reports progress for every unresolved location', async () => {
    const db = database();
    const progress = [];
    const fetchImpl = async (url) => ({ ok: true, async json() {
      return url.toString().includes('Mehrdeutiger') ? [{ lat: '48', lon: '9' }, { lat: '49', lon: '10' }] : [{ lat: '48.5', lon: '9.1' }];
    } });

    await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl, minIntervalMs: 0, onProgress: (event) => progress.push(event) });

    expect(progress.map(({ current, total, status }) => ({ current, total, status }))).toEqual([
      { current: 1, total: 2, status: 'updated' },
      { current: 2, total: 2, status: 'ambiguous' },
    ]);
    db.close();
  });

  it('uses the broader place query when the Pfarramt query is ambiguous', async () => {
    const db = database();
    db.prepare('DELETE FROM locations WHERE id = 2').run();
    db.prepare('UPDATE locations SET address = NULL WHERE id = 1').run();
    const queries = [];
    const fetchImpl = async (url) => {
      queries.push(url.searchParams.get('q'));
      if (url.searchParams.get('q').startsWith('Evangelisches Pfarramt')) {
        return { ok: true, async json() { return [{ lat: '48', lon: '9' }, { lat: '49', lon: '10' }]; } };
      }
      return { ok: true, async json() { return [{ lat: '48.5', lon: '9.1' }]; } };
    };

    const result = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl, minIntervalMs: 0 });

    expect(result.updated).toBe(1);
    expect(queries).toEqual(['Evangelisches Pfarramt Beispielort, Württemberg', 'Beispielort, Württemberg']);
    db.close();
  });

  it('retries rate limits and reports persistent provider failures', async () => {
    const db = database();
    let requests = 0;
    const fetchImpl = async () => {
      requests += 1;
      return { ok: false, status: 429, headers: { get: () => null } };
    };

    const result = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl, minIntervalMs: 0, sleepImpl: async () => {} });

    expect(requests).toBe(15);
    expect(result).toMatchObject({ failed: 2, failureReasons: { 'http-429': 2 } });
    db.close();
  });
});
