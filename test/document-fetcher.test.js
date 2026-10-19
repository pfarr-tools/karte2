import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { downloadDocument } from '../src/import/document-fetcher.js';

const temporaryDirectories = [];

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-documents-'));
  temporaryDirectories.push(root);
  return root;
}

function response(body, headers = {}) {
  const bytes = Buffer.from(body);
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/pdf', 'content-length': String(bytes.length), ...headers }),
    body: bytes,
    async arrayBuffer() {
      return bytes;
    },
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('document downloader', () => {
  it('stores an allowed PDF under its content hash', async () => {
    const body = '%PDF-allowed';
    const result = await downloadDocument({
      url: 'https://www.elk-wue.de/downloads/one.pdf',
      storageRoot: makeRoot(),
      allowedHosts: ['www.elk-wue.de'],
      fetchImpl: async () => response(body),
    });

    const hash = crypto.createHash('sha256').update(body).digest('hex');
    expect(result.sha256).toBe(hash);
    expect(result.size).toBe(Buffer.byteLength(body));
    expect(result.localPath).toContain(`${hash}.pdf`);
    expect(fs.readFileSync(result.localPath, 'utf8')).toBe(body);
  });

  it('rejects untrusted hosts before making a request', async () => {
    let called = false;

    await expect(downloadDocument({
      url: 'https://evil.example/one.pdf',
      storageRoot: makeRoot(),
      allowedHosts: ['www.elk-wue.de'],
      fetchImpl: async () => {
        called = true;
        return response('%PDF');
      },
    })).rejects.toThrow(/allowed source host/);
    expect(called).toBe(false);
  });

  it('rejects non-success responses and oversized content', async () => {
    await expect(downloadDocument({
      url: 'https://www.elk-wue.de/downloads/missing.pdf',
      storageRoot: makeRoot(),
      allowedHosts: ['www.elk-wue.de'],
      fetchImpl: async () => ({ ok: false, status: 404, headers: new Headers() }),
    })).rejects.toThrow(/HTTP 404/);

    await expect(downloadDocument({
      url: 'https://www.elk-wue.de/downloads/large.pdf',
      storageRoot: makeRoot(),
      allowedHosts: ['www.elk-wue.de'],
      maxBytes: 3,
      fetchImpl: async () => response('1234'),
    })).rejects.toThrow(/size limit/);
  });

  it('reuses the same path for identical content and versions changed content', async () => {
    const storageRoot = makeRoot();
    let body = '%PDF-one';
    const options = {
      url: 'https://www.elk-wue.de/downloads/versioned.pdf',
      storageRoot,
      allowedHosts: ['www.elk-wue.de'],
      fetchImpl: async () => response(body),
    };

    const first = await downloadDocument(options);
    const same = await downloadDocument(options);
    body = '%PDF-two';
    const changed = await downloadDocument(options);

    expect(same.localPath).toBe(first.localPath);
    expect(changed.localPath).not.toBe(first.localPath);
    expect(fs.readdirSync(path.join(storageRoot, 'documents'))).toHaveLength(2);
  });
});
