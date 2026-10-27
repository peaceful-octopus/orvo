import { verifyConfig } from '@orvo/protocol';
import { FakeClock, testKeys } from '@orvo/testkit';
import { MemoryPlacementStore } from '@orvo/placement';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadActivities, serveActivities } from './activities';
import { createBeaconApp } from './app';
import { serveWebApp } from './web';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-activities-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const manifest = (id: string, extra: object = {}) => ({
  id,
  name: id,
  description: 'test',
  version: '1.0.0',
  apiVersion: 1,
  minPlayers: 1,
  maxPlayers: 4,
  capabilities: [],
  ...extra,
});

function addActivity(dir: string, id: string, extra: object = {}, files: Record<string, string> = { 'index.html': '<p>hi</p>' }) {
  const base = path.join(dir, id);
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'manifest.json'), JSON.stringify(manifest(id, extra)));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(base, name), content);
}

describe('loadActivities', () => {
  it('publishes the full entry path and remembers where the files are', () => {
    addActivity(root, 'snake');
    const registry = loadActivities([root]);
    expect(registry.manifests).toHaveLength(1);
    expect(registry.manifests[0]).toMatchObject({ id: 'snake', entry: '/activities/snake/index.html' });
    expect(registry.dirs.get('snake')).toBe(path.join(root, 'snake'));
  });

  it('lets a later directory replace an earlier activity with the same id', () => {
    const operator = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-operator-'));
    try {
      addActivity(root, 'snake', { name: 'Bundled' });
      addActivity(operator, 'snake', { name: 'Custom' });
      const registry = loadActivities([root, operator]);
      expect(registry.manifests.map((m) => m.name)).toEqual(['Custom']);
    } finally {
      fs.rmSync(operator, { recursive: true, force: true });
    }
  });

  it('skips and reports an activity that is invalid, instead of failing the others', () => {
    addActivity(root, 'good');
    addActivity(root, 'mismatch', { id: 'other' });
    addActivity(root, 'nopage', {}, {});
    addActivity(root, 'toobig', { maxPlayers: 50 });
    addActivity(root, 'escape', { entry: '../../etc/passwd' });
    const warnings: string[] = [];
    const registry = loadActivities([root, path.join(root, 'missing-dir')], (m) => warnings.push(m));
    expect(registry.manifests.map((m) => m.id)).toEqual(['good']);
    expect(warnings).toHaveLength(4);
  });
});

describe('serveActivities', () => {
  it('serves files with the sandbox headers, next to the web app, and does not fall back to the app for missing files', async () => {
    addActivity(root, 'snake', {}, { 'index.html': '<p>snake</p>' });
    const web = fs.mkdtempSync(path.join(os.tmpdir(), 'orvo-web-'));
    fs.writeFileSync(path.join(web, 'index.html'), '<p>app</p>');
    const app = Fastify();
    try {
      await serveActivities(app, loadActivities([root]));
      await serveWebApp(app, web);

      const page = await app.inject('/activities/snake/index.html');
      expect(page.statusCode).toBe(200);
      expect(page.body).toBe('<p>snake</p>');
      expect(page.headers['access-control-allow-origin']).toBe('*');
      expect(page.headers['content-security-policy']).toContain("connect-src 'none'");
      expect(page.headers['x-content-type-options']).toBe('nosniff');

      expect((await app.inject('/activities/snake/missing.js')).statusCode).toBe(404);
      expect((await app.inject('/activities/unknown/index.html')).statusCode).toBe(404);
      // The web app still works, and falls back to its index for app routes.
      expect((await app.inject('/r/some-room')).body).toBe('<p>app</p>');
    } finally {
      await app.close();
      fs.rmSync(web, { recursive: true, force: true });
    }
  });
});

describe('config', () => {
  const key = testKeys('beacon-activities');
  const clock = new FakeClock();

  async function config(activities?: ReturnType<typeof loadActivities>['manifests']) {
    const app = await createBeaconApp({
      signingKey: { kid: key.kid, publicKey: key.publicKey, secretKey: key.secretKey },
      store: new MemoryPlacementStore([{ id: 'n', region: 'r', weight: 1, draining: false }], () => clock.now),
      stunUrls: [],
      now: () => clock.now,
      rateLimitPerMinute: false,
      activities,
    });
    try {
      const res = await app.inject({ url: '/v1/config', headers: { host: 'orvo.example.com' } });
      const result = verifyConfig(res.json(), { keys: { [key.kid]: key.publicKey }, now: clock.now, graceMs: 0 });
      if (!result.ok) throw new Error(result.reason);
      return result.config;
    } finally {
      await app.close();
    }
  }

  it('signs the activities the server offers', async () => {
    addActivity(root, 'snake');
    const offered = await config(loadActivities([root]).manifests);
    expect(offered.activities?.map((a) => a.id)).toEqual(['snake']);
  });

  it('leaves the field out when there are none', async () => {
    expect((await config([])).activities).toBeUndefined();
    expect((await config()).activities).toBeUndefined();
  });
});
