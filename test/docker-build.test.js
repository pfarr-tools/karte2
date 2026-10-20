import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const dockerfile = fs.readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const wrapper = fs.readFileSync(new URL('../karte', import.meta.url), 'utf8');
const compose = fs.readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8');

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
    expect(wrapper).toMatch(/scheduler\)/);
  });

  it('uses status for Docker state and app-status for application state', () => {
    expect(wrapper).toMatch(/status\) docker compose -f compose\.yaml ps/);
    expect(wrapper).toMatch(/app-status\|data-status\) docker compose -f compose\.yaml run --rm --build app node src\/cli\.js status/);
  });

  it('passes a documented geocoder default to runtime services', () => {
    expect(compose).toMatch(/GEOCODER_URL: \$\{GEOCODER_URL:-https:\/\/nominatim\.openstreetmap\.org\/search\}/g);
    expect((compose.match(/^\s+GEOCODER_URL:/gm) ?? []).length).toBe(2);
  });
});
