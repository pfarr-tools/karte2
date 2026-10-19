import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

describe('Docker build prerequisites', () => {
  it('installs native addon build tools before npm ci', () => {
    const tools = dockerfile.indexOf('python3 make g++');
    const npmInstall = dockerfile.indexOf('RUN npm ci');

    expect(tools).toBeGreaterThanOrEqual(0);
    expect(npmInstall).toBeGreaterThan(tools);
  });
});
