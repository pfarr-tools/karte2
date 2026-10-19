import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { bootstrapDatabase, buildServer } from '../src/server.js';

const servers = [];
const databases = [];
const temporaryDirectories = [];

afterEach(async () => {
  while (databases.length > 0) {
    databases.pop().close();
  }
  while (servers.length > 0) {
    await servers.pop().close();
  }
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
  if (global.gc) global.gc();
});

describe('HTTP server', () => {
  it('reports service health without requiring authentication', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', lastSuccessfulImport: null, unresolvedIssues: 0 });
  });

  it('bootstraps migrations and the source registry for the application', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-server-'));
    temporaryDirectories.push(root);
    const database = openDatabase({
      filename: path.join(root, 'test', 'database.sqlite'),
      nodeEnv: 'test',
      testRoot: path.join(root, 'test'),
      runtimeRoot: path.join(root, 'runtime'),
    });
    databases.push(database);
    bootstrapDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM sources').get().count).toBe(1);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_runs'").get()).toEqual({ name: 'import_runs' });
  });

  it('serves filtered publications with source and document provenance', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-server-'));
    temporaryDirectories.push(root);
    const database = openDatabase({
      filename: path.join(root, 'test', 'database.sqlite'),
      nodeEnv: 'test',
      testRoot: path.join(root, 'test'),
      runtimeRoot: path.join(root, 'runtime'),
    });
    databases.push(database);
    bootstrapDatabase(database);
    database.prepare(`
      INSERT INTO positions (stable_slug, normalized_name, type, deanery, employment_percentage)
      VALUES ('beispiel', 'Beispielpfarrstelle', 'Pfarrstelle', 'Beispieldekanat', 75)
    `).run();
    database.prepare(`
      INSERT INTO locations (name, address, latitude, longitude)
      VALUES ('Beispielort', 'Kirchplatz 1', 48.5, 9.1)
    `).run();
    database.prepare(`
      INSERT INTO position_locations (position_id, location_id, role)
      VALUES (1, 1, 'duty')
    `).run();
    database.prepare(`
      INSERT INTO documents (source_id, original_url, local_path, sha256, mime_type, fetched_at)
      VALUES ('elkw-pfarrstellen', 'https://www.elk-wue.de/beispiel.pdf', 'documents/beispiel.pdf', 'hash', 'application/pdf', '2026-10-19T12:00:00Z')
    `).run();
    database.prepare(`
      INSERT INTO publications (position_id, source_id, document_id, category, application_deadline, first_seen_at, last_seen_at, current_state)
      VALUES (1, 'elkw-pfarrstellen', 1, 'advertised', '2026-11-05', '2026-10-19T12:00:00Z', '2026-10-19T12:00:00Z', 'current')
    `).run();

    const server = buildServer({ database, adminToken: 'secret' });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/api/publications?category=advertised&q=Beispielort' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        id: 1,
        positionId: 1,
        name: 'Beispielpfarrstelle',
        category: 'advertised',
        type: 'Pfarrstelle',
        deanery: 'Beispieldekanat',
        employmentPercentage: 75,
        deadline: '2026-11-05',
        appointmentProcedure: null,
        publishedAt: null,
        fetchedAt: '2026-10-19T12:00:00Z',
        extractionConfidence: null,
        description: null,
        state: 'current',
        locations: [{ name: 'Beispielort', address: 'Kirchplatz 1', latitude: 48.5, longitude: 9.1, role: 'duty' }],
        source: { name: 'Ausschreibungen und Liste zu besetzender Pfarrstellen', url: 'https://www.elk-wue.de/wir/oberkirchenrat/dezernat-3-ausbildung-und-pfarrdienst/referat-31-planung-einsatz-verwaltung-pfarrdienst/ausschreibungen-und-liste-zu-besetzender-pfarrstellen' },
        documentUrl: 'https://www.elk-wue.de/beispiel.pdf',
      }],
    });
    const csv = await server.inject({ method: 'GET', url: '/api/publications.csv?category=advertised' });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toContain('Name;Kategorie;Dekanat;Ort;Quelle;Originaldokument');
    expect(csv.body).toContain('Beispielpfarrstelle;advertised;Beispieldekanat;Beispielort;Ausschreibungen und Liste zu besetzender Pfarrstellen;https://www.elk-wue.de/beispiel.pdf');
    const detail = await server.inject({ method: 'GET', url: '/api/positions/1' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().publications[0]).toMatchObject({ documentUrl: 'https://www.elk-wue.de/beispiel.pdf' });
    const locationUpdate = await server.inject({ method: 'POST', url: '/admin/locations/1', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, payload: { latitude: 48.51, longitude: 9.11 } });
    expect(locationUpdate.statusCode).toBe(200);
    expect(database.prepare('SELECT latitude, longitude, geocoding_provider, geocoding_confidence FROM locations WHERE id = 1').get())
      .toEqual({ latitude: 48.51, longitude: 9.11, geocoding_provider: 'manual', geocoding_confidence: 'verified' });
    const page = await server.inject({ method: 'GET', url: '/position/1' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Beispielpfarrstelle');
    expect(page.body).toContain('Originaldokument');
    expect(page.body).toContain('Abgerufen: 2026-10-19T12:00:00Z');
  });

  it('filters by position type, deanery, employment percentage and deadline', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-server-'));
    temporaryDirectories.push(root);
    const testRoot = path.join(root, 'test');
    const database = openDatabase({ filename: path.join(testRoot, 'database.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot: path.join(root, 'runtime') });
    databases.push(database);
    bootstrapDatabase(database);
    database.prepare(`
      INSERT INTO positions (stable_slug, normalized_name, type, deanery, employment_percentage)
      VALUES ('passend', 'Passende Pfarrstelle', 'Pfarrstelle', 'Passenddekanat', 75),
             ('unpassend', 'Andere Stelle', 'Diakonat', 'Anderesdekanat', 50)
    `).run();
    database.prepare(`
      INSERT INTO publications (position_id, source_id, category, application_deadline, appointment_procedure, first_seen_at, last_seen_at, current_state)
      VALUES (1, 'elkw-pfarrstellen', 'advertised', '2026-11-05', 'Wahl', '2026-10-19', '2026-10-19', 'current'),
             (2, 'elkw-pfarrstellen', 'advertised', '2026-10-01', 'Berufung', '2026-10-19', '2026-10-19', 'current')
    `).run();
    const server = buildServer({ database });
    servers.push(server);

    const response = await server.inject({
      method: 'GET',
      url: '/api/publications?type=Pfarrstelle&deanery=Passenddekanat&employmentMin=70&deadlineAfter=2026-11-01',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items.map((item) => item.name)).toEqual(['Passende Pfarrstelle']);

    const sorted = await server.inject({ method: 'GET', url: '/api/publications?sort=deadline' });
    expect(sorted.json().items.map((item) => item.name)).toEqual(['Andere Stelle', 'Passende Pfarrstelle']);
    const procedure = await server.inject({ method: 'GET', url: '/api/publications?procedure=Wahl' });
    expect(procedure.json().items.map((item) => item.name)).toEqual(['Passende Pfarrstelle']);
  });

  it('renders a German public map/list shell with an unofficial disclaimer', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
    expect(response.body).toContain('Pfarrstellenkarte');
    expect(response.body).toContain('unoffiziell');
    expect(response.body).toContain('api/publications');
    expect(response.body).toContain('escapeHtml');
    expect(response.body).toContain('history.replaceState');
    expect(response.body).toContain('mapLat');
    expect(response.body).toContain('mapZoom');
    expect(response.body).toContain('leaflet.markercluster');
    expect(response.body).toContain('mobile-list');
    expect(response.body).toContain('<table');
    expect(response.body).toContain('name="sort"');
    expect(response.body).toContain('name="procedure"');
  });

  it('protects administrative status and issue endpoints with an admin token', async () => {
    let importCalls = 0;
    const server = buildServer({ adminToken: 'secret', importRunner: async () => { importCalls += 1; return { status: 'completed' }; } });
    servers.push(server);

    const unauthorized = await server.inject({ method: 'GET', url: '/admin/status' });
    expect(unauthorized.statusCode).toBe(401);
    const authorized = await server.inject({ method: 'GET', url: '/admin/status', headers: { authorization: 'Bearer secret' } });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual(expect.objectContaining({ positions: 0, documents: 0, unresolvedIssues: 0 }));
    const imports = await server.inject({ method: 'GET', url: '/admin/imports', headers: { authorization: 'Bearer secret' } });
    expect(imports.statusCode).toBe(200);
    expect(imports.json()).toEqual({ imports: [] });
    const manualImport = await server.inject({ method: 'POST', url: '/admin/import', headers: { authorization: 'Bearer secret' } });
    expect(manualImport.statusCode).toBe(200);
    expect(manualImport.json()).toEqual({ status: 'completed' });
    expect(importCalls).toBe(1);
  });

  it('stores a validated editorial override with history', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-server-'));
    temporaryDirectories.push(root);
    const testRoot = path.join(root, 'test');
    const database = openDatabase({ filename: path.join(testRoot, 'database.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot: path.join(root, 'runtime') });
    databases.push(database);
    bootstrapDatabase(database);
    database.prepare("INSERT INTO positions (stable_slug, normalized_name, deanery) VALUES ('test', 'Teststelle', 'Import')").run();
    const server = buildServer({ database, adminToken: 'secret' });
    servers.push(server);
    const response = await server.inject({ method: 'POST', url: '/admin/positions/1/overrides', headers: { authorization: 'Bearer secret', 'content-type': 'application/json' }, payload: { field: 'deanery', value: 'Redaktion', editor: 'admin', reason: 'geprüft' } });
    expect(response.statusCode).toBe(200);
    expect(database.prepare('SELECT deanery FROM positions WHERE id = 1').get()).toEqual({ deanery: 'Redaktion' });
    expect(database.prepare('SELECT field_name, override_value, reason FROM position_overrides').all()).toEqual([{ field_name: 'deanery', override_value: 'Redaktion', reason: 'geprüft' }]);
    expect(database.prepare('SELECT event_type FROM position_history').all()).toEqual([{ event_type: 'editorial-override' }]);
  });
});
