import { config } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrateDatabase } from './db/migrate.js';
import { syncSourceDefinitions, sourceDefinitions } from './db/source-registry.js';
import { downloadDocument } from './import/document-fetcher.js';
import { runPageImport } from './import/import-run.js';
import { parseElkwListingPage } from './import/elkw-page-parser.js';
import { extractPdfText } from './import/pdf-extractor.js';

const usage = `Usage: node src/cli.js <command>

Commands:
  migrate              Apply SQLite migrations and sync source definitions
  status               Show database and source status
  import               Fetch and persist the official ELKW listing page
  import --dry-run     Fetch and parse without writing SQLite
`;

export function parseCliArgs(argv) {
  const command = argv[0] ?? 'help';
  const options = argv.slice(1);
  const unknown = options.find((option) => option !== '--dry-run');
  if (unknown) throw new Error(`unknown option: ${unknown}`);
  if (!['help', 'migrate', 'status', 'import'].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }
  return { command, dryRun: options.includes('--dry-run') };
}

async function fetchPage(url, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { 'user-agent': 'karte2/0.1' } });
    if (!response.ok) throw new Error(`Source page request failed with HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function runCli(argv, dependencies = {}) {
  const args = parseCliArgs(argv);
  const stdout = dependencies.stdout ?? process.stdout;
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

  const source = sourceDefinitions.find(({ id }) => id === 'elkw-pfarrstellen');
  const html = await fetchPage(source.url, dependencies.fetchImpl);
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
