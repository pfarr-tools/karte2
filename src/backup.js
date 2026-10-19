import fs from 'node:fs/promises';
import path from 'node:path';

export async function createBackup({ database, databasePath, runtimeRoot, backupRoot, timestamp = new Date().toISOString() }) {
  const safeName = timestamp.replace(/[^0-9TZ-]/g, '');
  const destination = path.resolve(backupRoot, safeName);
  await fs.mkdir(destination, { recursive: true });
  await database.backup(path.join(destination, 'karte.sqlite'));
  const documents = path.join(runtimeRoot, 'documents');
  try {
    await fs.cp(documents, path.join(destination, 'documents'), { recursive: true, errorOnExist: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.join(destination, 'documents'));
  }
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ createdAt: timestamp, databasePath, includes: ['karte.sqlite', 'documents'] }) + '\n');
  return { destination, database: path.join(destination, 'karte.sqlite'), documents: path.join(destination, 'documents') };
}
