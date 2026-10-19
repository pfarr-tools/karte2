import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractPdfText } from '../src/import/pdf-extractor.js';

const temporaryDirectories = [];

function makePaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'karte2-pdf-'));
  temporaryDirectories.push(root);
  return {
    pdfPath: path.join(root, 'document.pdf'),
    textPath: path.join(root, 'document.txt'),
  };
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    fs.rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

describe('PDF text extractor', () => {
  it('extracts page count and layout-preserving text using Poppler commands', async () => {
    const paths = makePaths();
    fs.writeFileSync(paths.pdfPath, '%PDF-placeholder');
    const calls = [];
    const result = await extractPdfText({
      ...paths,
      runCommand: async (command, args) => {
        calls.push([command, args]);
        if (command === 'pdfinfo') return 'Title: Fixture\nPages: 3\n';
        return 'Pfarrstelle Beispiel\n  100 %\n';
      },
    });

    expect(result).toMatchObject({ pageCount: 3, text: 'Pfarrstelle Beispiel\n  100 %\n', extractionStatus: 'success' });
    expect(fs.readFileSync(paths.textPath, 'utf8')).toBe(result.text);
    expect(calls).toEqual([
      ['pdfinfo', [paths.pdfPath]],
      ['pdftotext', ['-layout', paths.pdfPath, '-']],
    ]);
  });

  it('propagates a Poppler failure without claiming extracted text', async () => {
    const paths = makePaths();
    fs.writeFileSync(paths.pdfPath, '%PDF-placeholder');

    await expect(extractPdfText({
      ...paths,
      runCommand: async () => {
        throw new Error('malformed PDF');
      },
    })).rejects.toThrow('malformed PDF');
    expect(fs.existsSync(paths.textPath)).toBe(false);
  });
});
