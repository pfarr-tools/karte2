import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server.js';

const servers = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop().close();
  }
});

describe('HTTP server', () => {
  it('reports service health without requiring authentication', async () => {
    const server = buildServer();
    servers.push(server);

    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});
