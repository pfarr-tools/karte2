import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { bootstrapDatabase, buildServer } from '../src/server.js';

const servers = [];
const temporaryDirectories = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop().close();
  }
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('HTTP server', () => {
  it('reports service health without requiring authentication', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
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

    bootstrapDatabase(database);

    expect(database.prepare('SELECT COUNT(*) AS count FROM sources').get().count).toBe(1);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_runs'").get()).toEqual({ name: 'import_runs' });
    database.close();
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

    const server = buildServer({ database });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/api/publications?category=advertised&q=Beispielort' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [{
        id: 1,
        name: 'Beispielpfarrstelle',
        category: 'advertised',
        type: 'Pfarrstelle',
        deanery: 'Beispieldekanat',
        employmentPercentage: 75,
        deadline: '2026-11-05',
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
    database.close();
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
  });
});
