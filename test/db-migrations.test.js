import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';

const temporaryDirectories = [];

function makePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-migrations-'));
  temporaryDirectories.push(root);
  return {
    root,
    testRoot: path.join(root, 'test'),
    runtimeRoot: path.join(root, 'runtime'),
    databasePath: path.join(root, 'test', 'database.sqlite'),
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('SQLite database migrations', () => {
  it('accepts the application configuration databasePath', () => {
    const paths = makePaths();
    const database = openDatabase({
      databasePath: paths.databasePath,
      nodeEnv: 'test',
      testRoot: paths.testRoot,
      runtimeRoot: paths.runtimeRoot,
    });

    expect(fs.existsSync(paths.databasePath)).toBe(true);
    database.close();
  });

  it('enables safety pragmas and creates the provenance schema', () => {
    const paths = makePaths();
    const database = openDatabase({
      filename: paths.databasePath,
      nodeEnv: 'test',
      testRoot: paths.testRoot,
      runtimeRoot: paths.runtimeRoot,
    });

    migrateDatabase(database);

    expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(database.pragma('busy_timeout', { simple: true })).toBe(5000);

    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map(({ name }) => name);
    expect(tables).toEqual(expect.arrayContaining([
      'providers', 'sources', 'source_sections', 'documents', 'positions',
      'publications', 'locations', 'position_locations', 'extracted_fields',
      'position_overrides', 'position_history', 'import_runs', 'import_issues',
      'schema_migrations',
    ]));
    expect(database.prepare('PRAGMA foreign_key_list(positions)').all())
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ table: 'locations', from: 'primary_location_id' }),
      ]));
    database.close();
  });

  it('can apply all migrations repeatedly without changing the schema', () => {
    const paths = makePaths();
    const database = openDatabase({
      filename: paths.databasePath,
      nodeEnv: 'test',
      testRoot: paths.testRoot,
      runtimeRoot: paths.runtimeRoot,
    });

    migrateDatabase(database);
    const firstMigrations = database.prepare('SELECT id FROM schema_migrations ORDER BY id').all();
    migrateDatabase(database);
    const secondMigrations = database.prepare('SELECT id FROM schema_migrations ORDER BY id').all();

    expect(secondMigrations).toEqual(firstMigrations);
    expect(secondMigrations.length).toBeGreaterThan(0);
    database.close();
  });
});
