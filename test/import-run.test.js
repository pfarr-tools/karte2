import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { runPageImport } from '../src/import/import-run.js';

const temporaryDirectories = [];
const pageUrl = 'https://www.elk-wue.de/wir/pfarrstellen';
const html = `
  <h2>Aktuelle Ausschreibungen</h2>
  <h3>Ausschreibungen zum 15. Oktober 2026 - Bewerbungsschluss zum 5. November 2026</h3>
  <a href="/downloads/one.pdf">Eine Stelle (PDF)</a>
  <a href="/downloads/two.pdf">Zweite Stelle (PDF)</a>
`;

function makeDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-import-'));
  temporaryDirectories.push(root);
  const paths = {
    databasePath: path.join(root, 'test', 'database.sqlite'),
    testRoot: path.join(root, 'test'),
    runtimeRoot: path.join(root, 'runtime'),
  };
  const database = openDatabase({ filename: paths.databasePath, nodeEnv: 'test', ...paths });
  migrateDatabase(database);
  database.prepare('INSERT INTO providers (id, name) VALUES (?, ?)').run('elkw', 'ELKW');
  database.prepare('INSERT INTO sources (id, provider_id, name, url, kind, parser_key) VALUES (?, ?, ?, ?, ?, ?)')
    .run('elkw-pfarrstellen', 'elkw', 'ELKW Pfarrstellen', pageUrl, 'official-listing-page', 'elkw-publication-page');
  return database;
}

function artifact(url, hash, localPath = `/data/documents/${hash}.pdf`) {
  return {
    originalUrl: url,
    localPath,
    sha256: hash,
    mimeType: 'application/pdf',
    size: 100,
    fetchedAt: '2026-10-19T12:00:00Z',
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('page import persistence', () => {
  it('keeps sections and document versions idempotently', async () => {
    const database = makeDatabase();
    const downloadDocumentImpl = async ({ url }) => artifact(url, url.endsWith('one.pdf') ? 'hash-one' : 'hash-two');
    const options = { database, html, sourceId: 'elkw-pfarrstellen', pageUrl, observedAt: '2026-10-19T12:00:00Z', downloadDocumentImpl };

    const first = await runPageImport(options);
    const second = await runPageImport(options);

    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');
    expect(database.prepare('SELECT COUNT(*) AS count FROM source_sections').get().count).toBe(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM documents').get().count).toBe(2);
    expect(database.prepare('SELECT COUNT(*) AS count FROM import_runs').get().count).toBe(2);
    database.close();
  });

  it('retains changed hashes and isolates one failed document', async () => {
    const database = makeDatabase();
    let version = 1;
    const downloadDocumentImpl = async ({ url }) => {
      if (url.endsWith('two.pdf')) throw new Error('malformed PDF');
      return artifact(url, `hash-one-v${version}`);
    };
    const options = { database, html, sourceId: 'elkw-pfarrstellen', pageUrl, observedAt: '2026-10-19T12:00:00Z', downloadDocumentImpl };

    const first = await runPageImport(options);
    version = 2;
    const second = await runPageImport(options);

    expect(first.issues).toHaveLength(1);
    expect(second.issues).toHaveLength(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM documents').get().count).toBe(2);
    expect(database.prepare('SELECT COUNT(*) AS count FROM import_issues').get().count).toBe(2);
    expect(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sha256 = 'hash-one-v1'").get().count).toBe(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM documents WHERE sha256 = 'hash-one-v2'").get().count).toBe(1);
    database.close();
  });

  it('does not delete existing documents when a later page has no PDFs', async () => {
    const database = makeDatabase();
    const options = {
      database,
      html,
      sourceId: 'elkw-pfarrstellen',
      pageUrl,
      observedAt: '2026-10-19T12:00:00Z',
      downloadDocumentImpl: async ({ url }) => artifact(url, url.endsWith('one.pdf') ? 'hash-one' : 'hash-two'),
    };
    await runPageImport(options);
    const empty = await runPageImport({ ...options, html: '<h2>Aktuelle Ausschreibungen</h2>' });

    expect(empty.status).toBe('completed');
    expect(database.prepare('SELECT COUNT(*) AS count FROM documents').get().count).toBe(2);
    database.close();
  });

  it('extracts new documents and records an isolated extraction failure', async () => {
    const database = makeDatabase();
    const extractionCalls = [];
    const options = {
      database,
      html,
      sourceId: 'elkw-pfarrstellen',
      pageUrl,
      observedAt: '2026-10-19T12:00:00Z',
      downloadDocumentImpl: async ({ url }) => artifact(url, url.endsWith('one.pdf') ? 'hash-one' : 'hash-two'),
      extractDocumentImpl: async ({ documentId, pdfPath, textPath }) => {
        extractionCalls.push({ documentId, pdfPath, textPath });
        if (documentId === 2) throw new Error('malformed PDF');
        return { textPath, pageCount: 2 };
      },
    };

    const result = await runPageImport(options);

    expect(extractionCalls).toHaveLength(2);
    expect(database.prepare("SELECT extraction_status, extracted_text_path, metadata_json FROM documents WHERE id = 1").get())
      .toEqual({ extraction_status: 'success', extracted_text_path: '/data/documents/hash-one.txt', metadata_json: '{"pageCount":2}' });
    expect(database.prepare('SELECT extraction_status FROM documents WHERE id = 2').get()).toEqual({ extraction_status: 'failed' });
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'document-extraction-failed', message: 'malformed PDF' }),
    ]));
    database.close();
  });
});
