import path from 'node:path';

export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databasePath: process.env.DATABASE_PATH ?? path.resolve('storage/karte.sqlite'),
  runtimeRoot: process.env.RUNTIME_ROOT ?? path.resolve('storage'),
  testRoot: process.env.TEST_ROOT ?? path.resolve('.test-data'),
  port: Number(process.env.PORT ?? 3000),
  geocoderUrl: process.env.GEOCODER_URL ?? '',
  geocoderMinIntervalMs: Number(process.env.GEOCODER_MIN_INTERVAL_MS ?? 1_000),
  boundaryPath: process.env.KIRCHENBEZIRKE_PATH ?? '/data/poi/KiBez.json',
  poiReplacePath: process.env.POI_REPLACE_PATH ?? '/data/poi/replace.json',
  backupRoot: process.env.BACKUP_ROOT ?? path.resolve('storage/backups'),
  adminToken: process.env.ADMIN_TOKEN ?? '',
  importIntervalSeconds: Number(process.env.IMPORT_INTERVAL_SECONDS ?? 86_400),
});
