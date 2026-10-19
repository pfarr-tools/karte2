import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { migrateDatabase } from '../src/db/migrate.js';
import { reprocessDocument } from '../src/import/document-reprocessor.js';

const roots = [];
afterEach(() => { while (roots.length) fs.rmSync(roots.pop(), { recursive: true, force: true }); });

describe('document reprocessor', () => {
  it('updates extraction status without replacing the source document', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-reprocess-'));
    roots.push(root);
    const testRoot = path.join(root, 'test');
    const runtimeRoot = path.join(root, 'runtime');
    const db = openDatabase({ filename: path.join(testRoot, 'db.sqlite'), nodeEnv: 'test', testRoot, runtimeRoot });
    migrateDatabase(db);
    const pdfPath = path.join(runtimeRoot, 'documents', 'one.pdf');
    fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
    fs.writeFileSync(pdfPath, 'pdf');
    db.prepare(`INSERT INTO providers (id, name) VALUES ('p', 'Provider')`).run();
    db.prepare(`INSERT INTO sources (id, provider_id, name, url, kind, parser_key) VALUES ('s', 'p', 'Source', 'https://example.test', 'page', 'test')`).run();
    db.prepare(`INSERT INTO documents (source_id, original_url, local_path, sha256, fetched_at) VALUES ('s', 'https://example.test/one.pdf', ?, 'hash', '2026-10-19T12:00:00Z')`).run(pdfPath);
    const result = await reprocessDocument({ database: db, documentId: 1, extractDocumentImpl: async ({ textPath }) => ({ textPath, pageCount: 1 }) });
    expect(result.status).toBe('success');
    expect(db.prepare('SELECT sha256, extraction_status FROM documents WHERE id = 1').get()).toEqual({ sha256: 'hash', extraction_status: 'success' });
    db.close();
  });
});
