import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sourceDefinitions, syncSourceDefinitions } from '../src/db/source-registry.js';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';

const temporaryDirectories = [];

function makeDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-sources-'));
  temporaryDirectories.push(root);
  const paths = {
    databasePath: path.join(root, 'test', 'database.sqlite'),
    testRoot: path.join(root, 'test'),
    runtimeRoot: path.join(root, 'runtime'),
  };
  const database = openDatabase({ filename: paths.databasePath, nodeEnv: 'test', ...paths });
  migrateDatabase(database);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('ELKW source registry', () => {
  it('defines one explicit official ELKW listing source', () => {
    expect(sourceDefinitions).toEqual([
      expect.objectContaining({
        id: 'elkw-pfarrstellen',
        providerId: 'elkw',
        name: expect.stringContaining('Ausschreibungen'),
        url: 'https://www.elk-wue.de/wir/oberkirchenrat/dezernat-3-ausbildung-und-pfarrdienst/referat-31-planung-einsatz-verwaltung-pfarrdienst/ausschreibungen-und-liste-zu-besetzender-pfarrstellen',
        parserKey: 'elkw-publication-page',
        enabled: true,
      }),
    ]);
  });

  it('synchronizes providers and sources idempotently by stable IDs', () => {
    const database = makeDatabase();

    syncSourceDefinitions(database, sourceDefinitions);
    syncSourceDefinitions(database, sourceDefinitions);

    expect(database.prepare('SELECT COUNT(*) AS count FROM providers').get().count).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM sources').get().count).toBe(1);
    expect(database.prepare('SELECT id, provider_id, parser_key FROM sources').get()).toEqual({
      id: 'elkw-pfarrstellen',
      provider_id: 'elkw',
      parser_key: 'elkw-publication-page',
    });
    database.close();
  });
});
