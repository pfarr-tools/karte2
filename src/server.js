import Fastify from 'fastify';
import { config } from './config.js';

export function buildServer() {
  const server = Fastify({ logger: true });
  server.get('/health', async () => ({ status: 'ok' }));
  return server;
}

export async function startServer() {
  const server = buildServer();
  await server.listen({ host: '0.0.0.0', port: config.port });
  return server;
}

if (process.argv[1]?.endsWith('/src/server.js')) {
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
