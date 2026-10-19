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

export async function restoreBackup({ backupPath, databasePath, runtimeRoot, confirm = false }) {
  if (!confirm) throw new Error('Restoring a backup requires explicit confirmation');
  const source = path.resolve(backupPath);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest.includes) || !manifest.includes.includes('karte.sqlite') || !manifest.includes.includes('documents')) {
    throw new Error('Backup manifest is incomplete');
  }
  await fs.access(path.join(source, 'karte.sqlite'));
  const temporaryDatabase = `${path.resolve(databasePath)}.${process.pid}.restore.tmp`;
  await fs.copyFile(path.join(source, 'karte.sqlite'), temporaryDatabase);
  await fs.rename(temporaryDatabase, path.resolve(databasePath));
  await fs.rm(path.join(runtimeRoot, 'documents'), { recursive: true, force: true });
  await fs.cp(path.join(source, 'documents'), path.join(runtimeRoot, 'documents'), { recursive: true });
  return { databasePath: path.resolve(databasePath), runtimeRoot: path.resolve(runtimeRoot) };
}
