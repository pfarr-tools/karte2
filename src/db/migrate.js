import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

/**
 * @param {import('better-sqlite3').Database} database
 */
export function migrateDatabase(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const applied = new Set(database.prepare('SELECT id FROM schema_migrations').all().map(({ id }) => id));
  const migrations = fs.readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();

  for (const filename of migrations) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
    const applyMigration = database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(filename);
    });
    applyMigration();
  }
}
