import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { geocodeLocations } from '../src/import/geocoder.js';

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
  it('caches a unique result and leaves ambiguous results without coordinates', async () => {
    const db = database();
    let requests = 0;
    const fetchImpl = async (url) => {
      requests += 1;
      if (url.toString().includes('Mehrdeutiger')) return { ok: true, async json() { return [{ lat: '48', lon: '9' }, { lat: '49', lon: '10' }]; } };
      expect(url.toString()).toContain('Beispielort');
      return { ok: true, async json() { return [{ lat: '48.5', lon: '9.1', display_name: 'Beispielort' }]; } };
    };
    const first = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl });
    const second = await geocodeLocations({ database: db, providerUrl: 'https://nominatim.example/search', fetchImpl });

    expect(first).toMatchObject({ updated: 1, ambiguous: 1 });
    expect(second).toMatchObject({ cached: 1, ambiguous: 1 });
    expect(requests).toBe(2);
    expect(db.prepare('SELECT latitude, longitude, geocoding_confidence FROM locations WHERE id = 1').get())
      .toEqual({ latitude: 48.5, longitude: 9.1, geocoding_confidence: 'approximate' });
    expect(db.prepare('SELECT latitude, longitude, geocoding_confidence FROM locations WHERE id = 2').get())
      .toEqual({ latitude: null, longitude: null, geocoding_confidence: 'ambiguous' });
    db.close();
  });
});
