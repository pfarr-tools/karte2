import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { assertSafeDatabasePath } from './safety.js';

/**
 * @param {{filename?: string, databasePath?: string, nodeEnv: string, testRoot: string, runtimeRoot: string}} options
 * @returns {import('better-sqlite3').Database}
 */
export function openDatabase({ filename, databasePath, nodeEnv, testRoot, runtimeRoot }) {
  const selectedPath = databasePath ?? filename;
  const safeFilename = nodeEnv === 'test'
    ? assertSafeDatabasePath({ nodeEnv, databasePath: selectedPath, testRoot, runtimeRoot })
    : path.resolve(selectedPath);
  fs.mkdirSync(path.dirname(safeFilename), { recursive: true });

  const database = new Database(safeFilename);
  database.pragma('foreign_keys = ON');
  database.pragma('journal_mode = WAL');
  database.pragma('busy_timeout = 5000');
  return database;
}
