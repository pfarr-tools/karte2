import { config } from './config.js';
import { createInterface } from 'node:readline/promises';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { syncSourceDefinitions, sourceDefinitions } from './db/source-registry.js';
import { downloadDocument } from './import/document-fetcher.js';
import { runPageImport } from './import/import-run.js';
import { parseElkwListingPage } from './import/elkw-page-parser.js';
import { extractPdfText } from './import/pdf-extractor.js';
import { reprocessDocument } from './import/document-reprocessor.js';
import { fetchGeocodeCandidates, findGeocodeCandidates, geocodeLocations, loadPoiReplacements } from './import/geocoder.js';
import { createBackup, restoreBackup } from './backup.js';

const usage = `Usage: node src/cli.js <command>

Commands:
  migrate              Apply SQLite migrations and sync source definitions
  status               Show database and source status
  import               Fetch and persist the official ELKW listing page
  import --dry-run     Fetch and parse without writing SQLite
  import --force       Re-extract already stored document versions
  import --file PATH   Reprocess one already stored PDF
  geocode              Geocode unresolved locations using the configured provider
  geocode --dry-run    Inspect unresolved locations without writing
  geocode --review     Resolve ambiguous locations interactively
  backup create         Create a consistent SQLite and document backup
  backup restore --yes  Restore a backup with explicit confirmation
`;

export function parseCliArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = argv.slice(1);
  const restorePathIndex = command === 'backup' && options.indexOf('restore') >= 0 ? options.indexOf('restore') + 1 : -1;
  let file = null;
  const known = new Set(['--dry-run', '--yes', '--force', '--review']);
  const unknown = options.find((option, index) => {
    if (option === '--file') {
      const value = options[index + 1];
      if (!value || value.startsWith('-')) return true;
      file = value;
      return false;
    }
    if (index === restorePathIndex || (command === 'backup' && ['create', 'restore'].includes(option))) return false;
    if (index > 0 && options[index - 1] === '--file') return false;
    return !known.has(option);
  });
  if (unknown) throw new Error(`unknown option: ${unknown}`);
  if (!['help', 'migrate', 'status', 'import', 'geocode', 'backup'].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  if (file && command !== 'import') throw new Error('--file is only valid for import');
  if (options.includes('--force') && command !== 'import') throw new Error('--force is only valid for import');
  if (options.includes('--review') && command !== 'geocode') throw new Error('--review is only valid for geocode');
  return { command, dryRun: options.includes('--dry-run'), force: options.includes('--force'), file, ...(options.includes('--review') ? { review: true } : {}) };
}

async function reviewGeocoding({ database, providerUrl, replacements, fetchImpl = fetch, input = process.stdin, output = process.stderr }) {
  const locations = database.prepare(`
    SELECT id, name, address FROM locations
    WHERE geocoding_confidence = 'ambiguous'
    ORDER BY id
  `).all();
  const readline = createInterface({ input, output });
  const update = database.prepare('UPDATE locations SET latitude = ?, longitude = ?, geocoding_provider = ?, geocoding_confidence = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?');
  try {
    for (const location of locations) {
      let search = await findGeocodeCandidates({ location, providerUrl, replacements, fetchImpl });
      while (true) {
        output.write(`\nGeocodierung für ${location.name}\n`);
        search.candidates.forEach((candidate, index) => output.write(`  ${index + 1}) ${candidate.display_name ?? `${candidate.lat}, ${candidate.lon}`}\n`));
        output.write('  n) Neue Suche\n  ü) Überspringen\n');
        const answer = (await readline.question('Auswahl: ')).trim().toLocaleLowerCase('de');
        if (answer === 'ü' || answer === 'u' || answer === '') break;
        if (answer === 'n') {
          const query = (await readline.question('Suchbegriff: ')).trim();
          if (query) search = { query, candidates: await fetchGeocodeCandidates({ query, providerUrl, fetchImpl }) };
          continue;
        }
        const selected = search.candidates[Number(answer) - 1];
        const latitude = Number(selected?.lat);
        const longitude = Number(selected?.lon);
        if (selected && Number.isFinite(latitude) && Number.isFinite(longitude)) {
          update.run(latitude, longitude, providerUrl, 'verified', location.id);
          output.write('  Standort übernommen.\n');
          break;
        }
      }
    }
  } finally {
    readline.close();
  }
  return { reviewed: locations.length };
}

async function fetchPage(url, fetchImpl = fetch, { sleepImpl = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), maxAttempts = 3 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'karte2/0.1' } });
      if (!response.ok) {
        const error = new Error(`Source page request failed with HTTP ${response.status}`);
        if (response.status >= 400 && response.status !== 429 && response.status < 500) throw error;
        lastError = error;
      } else {
        return await response.text();
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < maxAttempts - 1) await sleepImpl(100 * (2 ** attempt));
  }
  throw lastError;
}

export async function runCli(argv, dependencies = {}) {
  const args = parseCliArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  if (args.command === 'help') {
    stdout.write(usage);
    return 0;
  }

  if (args.command === 'migrate') {
    const database = dependencies.database ?? openDatabase(config);
    migrateDatabase(database);
    syncSourceDefinitions(database, sourceDefinitions);
    stdout.write('Migrations and source registry synchronized.\n');
    return 0;
  }

  if (args.command === 'status') {
    const database = dependencies.database ?? openDatabase(config);
    const sourceCount = database.prepare('SELECT COUNT(*) AS count FROM sources').get().count;
    const importCount = database.prepare('SELECT COUNT(*) AS count FROM import_runs').get().count;
    stdout.write(JSON.stringify({ sourceCount, importCount }) + '\n');
    return 0;
  }

  if (args.command === 'geocode') {
    const database = dependencies.database ?? openDatabase(config);
    migrateDatabase(database);
    const replacements = dependencies.replacements ?? loadPoiReplacements(config.poiReplacePath);
    if (args.review) {
      const result = await reviewGeocoding({
        database,
        providerUrl: dependencies.geocoderUrl ?? config.geocoderUrl,
        replacements,
        fetchImpl: dependencies.fetchImpl,
        input: dependencies.input,
        output: stderr,
      });
      stdout.write(JSON.stringify(result) + '\n');
      return 0;
    }
    const result = await geocodeLocations({
      database,
      providerUrl: dependencies.geocoderUrl ?? config.geocoderUrl,
      replacements,
      fetchImpl: dependencies.fetchImpl,
      minIntervalMs: config.geocoderMinIntervalMs,
      onProgress: ({ current, total, location, status, detail }) => {
        const labels = { updated: 'geocodiert', cached: 'aus Cache', ambiguous: 'unklar', failed: `Fehler${detail ? ` (${detail})` : ''}` };
        stderr.write(`[Geocoding] ${current}/${total} ${location.name}: ${labels[status] ?? status}\n`);
      },
      dryRun: args.dryRun,
    });
    stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }

  if (args.file) {
    if (args.dryRun) throw new Error('--file cannot be combined with --dry-run');
    const database = dependencies.database ?? openDatabase(config);
    if (!dependencies.database) {
      migrateDatabase(database);
      syncSourceDefinitions(database, sourceDefinitions);
    }
    const document = database.prepare('SELECT id, local_path FROM documents WHERE local_path = ?').get(args.file);
    if (!document) throw new Error(`Stored document not found: ${args.file}`);
    const result = await (dependencies.reprocessDocumentImpl ?? reprocessDocument)({
      database,
      documentId: document.id,
      extractDocumentImpl: dependencies.extractDocumentImpl ?? extractPdfText,
    });
    stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }

  if (args.command === 'backup') {
    if (argv.includes('restore')) {
      const result = await restoreBackup({
        backupPath: argv[argv.indexOf('restore') + 1],
        databasePath: config.databasePath,
        runtimeRoot: config.runtimeRoot,
        confirm: argv.includes('--yes'),
      });
      stdout.write(JSON.stringify(result) + '\n');
      return 0;
    }
    if (!argv.includes('create')) throw new Error('backup requires the create or restore subcommand');
    const database = dependencies.database ?? openDatabase(config);
    migrateDatabase(database);
    const result = await createBackup({
      database,
      databasePath: config.databasePath,
      runtimeRoot: config.runtimeRoot,
      backupRoot: config.backupRoot,
    });
    stdout.write(JSON.stringify(result) + '\n');
    return 0;
  }

  const source = sourceDefinitions.find(({ id }) => id === 'elkw-pfarrstellen');
  const html = await fetchPage(source.url, dependencies.fetchImpl, { sleepImpl: dependencies.sleepImpl });
  if (args.dryRun) {
    const parsed = parseElkwListingPage(html, {
      sourceId: source.id,
      pageUrl: source.url,
      observedAt: new Date().toISOString(),
    });
    stdout.write(JSON.stringify({ sections: parsed.sections.length, documents: parsed.documents.length, issues: parsed.issues.length }) + '\n');
    return 0;
  }

  const database = dependencies.database ?? openDatabase(config);
  migrateDatabase(database);
  syncSourceDefinitions(database, sourceDefinitions);
  const result = await runPageImport({
    database,
    html,
    sourceId: source.id,
    pageUrl: source.url,
    observedAt: new Date().toISOString(),
    downloadDocumentImpl: (options) => (dependencies.downloadDocumentImpl ?? downloadDocument)({
      ...options,
      storageRoot: config.runtimeRoot,
      allowedHosts: [new URL(source.url).hostname],
    }),
    extractDocumentImpl: dependencies.extractDocumentImpl ?? extractPdfText,
    force: args.force,
  });
  stdout.write(JSON.stringify(result) + '\n');
  return 0;
}

if (process.argv[1]?.endsWith('/src/cli.js')) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
