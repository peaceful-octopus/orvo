import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Serves the built web app from `dir` if it exists. Unknown GET paths such as `/r/<room>` return
 * index.html so the single-page app can route them. Returns whether a web app was found.
 */
export async function serveWebApp(app: FastifyInstance, dir: string): Promise<boolean> {
  if (!fs.existsSync(path.join(dir, 'index.html'))) return false;
  await app.register(fastifyStatic, { root: path.resolve(dir) });
  app.setNotFoundHandler((req, reply) =>
    req.method === 'GET' && !req.url.startsWith('/v1/')
      ? reply.sendFile('index.html')
      : reply.code(404).send({ error: 'Not found.' }),
  );
  return true;
}
