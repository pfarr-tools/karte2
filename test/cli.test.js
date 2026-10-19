import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli } from '../src/cli.js';

describe('CLI arguments', () => {
  it('parses import dry-run without enabling writes', () => {
    expect(parseCliArgs(['import', '--dry-run'])).toEqual({ command: 'import', dryRun: true, force: false, file: null });
  });

  it('parses force reprocessing for an import', () => {
    expect(parseCliArgs(['import', '--force'])).toEqual({ command: 'import', dryRun: false, force: true, file: null });
    expect(parseCliArgs(['import'])).toEqual({ command: 'import', dryRun: false, force: false, file: null });
    expect(parseCliArgs(['import', '--file', '/data/documents/example.pdf'])).toEqual({ command: 'import', dryRun: false, force: false, file: '/data/documents/example.pdf' });
  });

  it('rejects unknown options and exposes safe commands', () => {
    expect(() => parseCliArgs(['import', '--force-delete'])).toThrow(/unknown option/);
    expect(parseCliArgs(['migrate'])).toEqual({ command: 'migrate', dryRun: false, force: false, file: null });
    expect(parseCliArgs(['status'])).toEqual({ command: 'status', dryRun: false, force: false, file: null });
    expect(parseCliArgs(['geocode', '--dry-run'])).toEqual({ command: 'geocode', dryRun: true, force: false, file: null });
    expect(parseCliArgs(['backup', 'create'])).toEqual({ command: 'backup', dryRun: false, force: false, file: null });
    expect(parseCliArgs(['backup', 'restore', '/tmp/backup', '--yes'])).toEqual({ command: 'backup', dryRun: false, force: false, file: null });
  });

  it('runs import dry-run without touching the database dependency', async () => {
    const output = { write() {} };
    const response = { ok: true, async text() { return '<h2>Kontakt</h2>'; } };
    const dependencies = { fetchImpl: async () => response, stdout: output };
    Object.defineProperty(dependencies, 'database', {
      get() {
        throw new Error('database touched during dry-run');
      },
    });

    await expect(runCli(['import', '--dry-run'], dependencies)).resolves.toBe(0);
  });

  it('reprocesses a stored PDF when import receives --file', async () => {
    const calls = [];
    const database = {
      prepare(sql) {
        expect(sql).toContain('SELECT id, local_path FROM documents');
        return { get() { return { id: 7, local_path: '/data/documents/example.pdf' }; } };
      },
    };
    const output = { write() {} };
    await expect(runCli(['import', '--file', '/data/documents/example.pdf'], {
      database,
      stdout: output,
      reprocessDocumentImpl: async (options) => { calls.push(options); return { status: 'success' }; },
    })).resolves.toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ database, documentId: 7 });
  });
});
