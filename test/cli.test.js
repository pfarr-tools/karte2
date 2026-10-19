import { describe, expect, it } from 'vitest';
import { parseCliArgs, runCli } from '../src/cli.js';

describe('CLI arguments', () => {
  it('parses import dry-run without enabling writes', () => {
    expect(parseCliArgs(['import', '--dry-run'])).toEqual({ command: 'import', dryRun: true });
  });

  it('rejects unknown options and exposes safe commands', () => {
    expect(() => parseCliArgs(['import', '--force-delete'])).toThrow(/unknown option/);
    expect(parseCliArgs(['migrate'])).toEqual({ command: 'migrate', dryRun: false });
    expect(parseCliArgs(['status'])).toEqual({ command: 'status', dryRun: false });
    expect(parseCliArgs(['geocode', '--dry-run'])).toEqual({ command: 'geocode', dryRun: true });
    expect(parseCliArgs(['backup', 'create'])).toEqual({ command: 'backup', dryRun: false });
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
});
