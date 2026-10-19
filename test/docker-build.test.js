import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../karte', import.meta.url), 'utf8');

describe('Docker build prerequisites', () => {
  it('installs native addon build tools before npm ci', () => {
    const tools = dockerfile.indexOf('python3 make g++');
    const npmInstall = dockerfile.indexOf('RUN npm ci');

    expect(tools).toBeGreaterThanOrEqual(0);
    expect(npmInstall).toBeGreaterThan(tools);
  });

  it('rebuilds images before commands that execute copied source', () => {
    expect(wrapper).toMatch(/up -d --build/);
    expect(wrapper).toMatch(/run --rm --build app/);
    expect(wrapper).toMatch(/run --rm --build test/);
  });

  it('exposes the documented operational wrapper commands', () => {
    expect(wrapper).toMatch(/restart\)/);
    expect(wrapper).toMatch(/shell\)/);
    expect(wrapper).toMatch(/install\)/);
    expect(wrapper).toMatch(/geocode\|backup\)/);
  });
});
