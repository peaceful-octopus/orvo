import Fastify from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveWebApp } from './web';

describe('serveWebApp', () => {
  it('answers 404 for the admin page when the request may not see it, and serves the app otherwise', async () => {
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<p>app</p>');
    const app = Fastify();
    let visible = false;
    try {
      await serveWebApp(app, web, { adminVisible: () => visible });
      for (const url of ['/admin', '/admin/', '/admin?x=1', '/admin/anything']) expect((await app.inject(url)).statusCode, url).toBe(404);
      expect((await app.inject('/admin')).json()).toEqual((await app.inject('/v1/nothing-here')).json());
      // Other routes, including ones that only start with the same letters, are the app.
      expect((await app.inject('/administrators')).body).toBe('<p>app</p>');
      expect((await app.inject('/r/room')).body).toBe('<p>app</p>');
      visible = true;
      expect((await app.inject('/admin')).body).toBe('<p>app</p>');
    } finally {
      await app.close();
      fs.rmSync(web, { recursive: true, force: true });
    }
  });
});
