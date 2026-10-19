import path from 'node:path';

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databasePath: process.env.DATABASE_PATH ?? path.resolve('storage/karte.sqlite'),
  runtimeRoot: process.env.RUNTIME_ROOT ?? path.resolve('storage'),
  testRoot: process.env.TEST_ROOT ?? path.resolve('.test-data'),
  port: Number(process.env.PORT ?? 3000),
  geocoderUrl: process.env.GEOCODER_URL ?? '',
  backupRoot: process.env.BACKUP_ROOT ?? path.resolve('storage/backups'),
});
