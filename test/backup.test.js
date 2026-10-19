import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { createBackup, restoreBackup } from '../src/backup.js';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

describe('backup creation', () => {
  it('creates a SQLite snapshot, document archive and manifest', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-backup-'));
    roots.push(root);
    const testRoot = path.join(root, 'test');
    const runtimeRoot = path.join(root, 'runtime');
    const dbPath = path.join(testRoot, 'db.sqlite');
    const db = openDatabase({ filename: dbPath, nodeEnv: 'test', testRoot, runtimeRoot });
    migrateDatabase(db);
    fs.mkdirSync(path.join(runtimeRoot, 'documents'), { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'documents', 'one.pdf'), 'fixture');
    const result = await createBackup({ database: db, databasePath: dbPath, runtimeRoot, backupRoot: path.join(root, 'backups'), timestamp: '2026-10-19T12:00:00Z' });
    expect(fs.existsSync(result.database)).toBe(true);
    expect(fs.readFileSync(path.join(result.documents, 'one.pdf'), 'utf8')).toBe('fixture');
    expect(JSON.parse(fs.readFileSync(path.join(result.destination, 'manifest.json')))).toMatchObject({ includes: ['karte.sqlite', 'documents'] });
    db.close();
  });

  it('requires explicit confirmation before restoring', async () => {
    await expect(restoreBackup({ backupPath: '/tmp/no-backup', databasePath: '/tmp/db', runtimeRoot: '/tmp/runtime' }))
      .rejects.toThrow(/explicit confirmation/);
  });
});
