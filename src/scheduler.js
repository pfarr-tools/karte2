import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { acquireJobLock } from './job-lock.js';
import { runCli } from './cli.js';

export async function runScheduledImportOnce({ database, importImpl = () => runCli(['import'], { database }) }) {
  const lock = acquireJobLock({ database, name: 'import' });
  if (!lock.acquired) return { skipped: true };
  try {
    await importImpl();
    return { skipped: false };
  } finally {
    lock.release();
  }
}

export async function startScheduler() {
  const database = openDatabase(config);
  migrateDatabase(database);
  const run = () => runScheduledImportOnce({ database }).catch((error) => console.error(error));
  await run();
  setInterval(run, config.importIntervalSeconds * 1000);
}

if (process.argv[1]?.endsWith('/src/scheduler.js')) startScheduler().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
