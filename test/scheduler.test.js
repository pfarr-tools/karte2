import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { runScheduledImportOnce } from '../src/scheduler.js';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

describe('scheduler', () => {
  it('runs one import through the lock and releases it afterward', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-scheduler-'));
    roots.push(root);
    const testRoot = path.join(root, 'test');
    const db = openDatabase({ filename: path.join(testRoot, 'db.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot: path.join(root, 'runtime') });
    migrateDatabase(db);
    let calls = 0;
    expect(await runScheduledImportOnce({ database: db, importImpl: async () => { calls += 1; } })).toEqual({ skipped: false });
    expect(calls).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM job_locks').get().count).toBe(0);
    db.close();
  });
});
