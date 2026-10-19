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
});
