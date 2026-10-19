import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSafeDatabasePath, createTestDatabasePath } from '../src/db/safety.js';

const temporaryDirectories = [];

function makeDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-safety-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('database path safety', () => {
  it('accepts a database path below the dedicated test root', () => {
    const testRoot = makeDirectory();
    const databasePath = path.join(testRoot, 'run-123', 'database.sqlite');

    expect(() => assertSafeDatabasePath({
      nodeEnv: 'test',
      databasePath,
      testRoot,
      runtimeRoot: path.join(testRoot, '..', 'runtime'),
    })).not.toThrow();
  });

  it('rejects a database path when the environment is not test', () => {
    const testRoot = makeDirectory();

    expect(() => assertSafeDatabasePath({
      nodeEnv: 'development',
      databasePath: path.join(testRoot, 'database.sqlite'),
      testRoot,
      runtimeRoot: path.join(testRoot, '..', 'runtime'),
    })).toThrow(/NODE_ENV=test/);
  });

  it('rejects a runtime database path and its descendants', () => {
    const testRoot = makeDirectory();
    const runtimeRoot = makeDirectory();

    expect(() => assertSafeDatabasePath({
      nodeEnv: 'test',
      databasePath: path.join(runtimeRoot, 'database.sqlite'),
      testRoot,
      runtimeRoot,
    })).toThrow(/runtime storage/);
  });

  it('rejects a path that resolves through a symlink into runtime storage', () => {
    const testRoot = makeDirectory();
    const runtimeRoot = makeDirectory();
    const escapedRoot = path.join(testRoot, 'escaped');
    fs.symlinkSync(runtimeRoot, escapedRoot, 'dir');

    expect(() => assertSafeDatabasePath({
      nodeEnv: 'test',
      databasePath: path.join(escapedRoot, 'database.sqlite'),
      testRoot,
      runtimeRoot,
    })).toThrow(/runtime storage/);
  });

  it('creates unique database paths below the test root', () => {
    const testRoot = makeDirectory();
    const first = createTestDatabasePath(testRoot);
    const second = createTestDatabasePath(testRoot);

    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(testRoot);
    expect(path.dirname(second)).toBe(testRoot);
    expect(first).toMatch(/\.sqlite$/);
    expect(second).toMatch(/\.sqlite$/);
  });
});
