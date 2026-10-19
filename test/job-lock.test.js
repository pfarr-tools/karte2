import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { acquireJobLock } from '../src/job-lock.js';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

describe('job lock', () => {
  it('prevents overlapping jobs and releases safely', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-lock-'));
    roots.push(root);
    const testRoot = path.join(root, 'test');
    const db = openDatabase({ filename: path.join(testRoot, 'db.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot: path.join(root, 'runtime') });
    migrateDatabase(db);
    const first = acquireJobLock({ database: db, name: 'import', now: '2026-10-19T12:00:00.000Z', ttlMs: 60_000 });
    const second = acquireJobLock({ database: db, name: 'import', now: '2026-10-19T12:00:01.000Z', ttlMs: 60_000 });
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    first.release();
    expect(acquireJobLock({ database: db, name: 'import', now: '2026-10-19T12:00:02.000Z', ttlMs: 60_000 }).acquired).toBe(true);
    db.close();
  });
});
