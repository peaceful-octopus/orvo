import fastifyStatic from '@fastify/static';
import { ActivityManifest } from '@orvo/protocol';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';

/** The activities found on disk: what clients are told about, and where each one's files live. */
export interface ActivityRegistry {
  manifests: ActivityManifest[];
  dirs: Map<string, string>;
}

/**
 * Reads activities from directories that each hold one subdirectory per activity, with a `manifest.json` inside.
 * The subdirectory name is the activity id. `entry` in the file is a page inside that directory (default `index.html`);
 * the published manifest gets the full URL path. A later directory replaces an earlier activity of the same id, so an
 * operator can override a bundled one. Invalid activities are skipped and reported through `warn`.
 */
export function loadActivities(roots: string[], warn: (message: string) => void = console.warn): ActivityRegistry {
  const found = new Map<string, { manifest: ActivityManifest; dir: string }>();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const file = path.join(dir, 'manifest.json');
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (raw.id !== entry.name) throw new Error(`id "${String(raw.id)}" does not match the directory name`);
        const page = typeof raw.entry === 'string' ? raw.entry : 'index.html';
        const parsed = ActivityManifest.safeParse({ ...raw, entry: `/activities/${entry.name}/${page}` });
        if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        if (!fs.existsSync(path.join(dir, page))) throw new Error(`entry page ${page} does not exist`);
        found.set(entry.name, { manifest: parsed.data, dir });
      } catch (error) {
        warn(`Skipping activity ${entry.name} in ${root}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return {
    manifests: [...found.values()].map((a) => a.manifest),
    dirs: new Map([...found].map(([id, a]) => [id, a.dir])),
  };
}

/**
 * Activities run in a sandboxed iframe without `allow-same-origin`, so they load as an opaque origin. That is why module
 * scripts need CORS here. The policy stops an activity from contacting anything but itself, which keeps it from sending
 * what it sees in a call somewhere else.
 */
const ACTIVITY_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'content-security-policy':
    "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'; frame-ancestors *",
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-cache',
};

/** Serves each activity's files under `/activities/<id>/`. Register before `serveWebApp`. */
export async function serveActivities(app: FastifyInstance, registry: ActivityRegistry): Promise<void> {
  for (const [id, dir] of registry.dirs) {
    await app.register(fastifyStatic, {
      root: path.resolve(dir),
      prefix: `/activities/${id}/`,
      // The web app's registration owns `sendFile`.
      decorateReply: false,
      index: false,
      dotfiles: 'deny',
      setHeaders: (reply) => {
        for (const [name, value] of Object.entries(ACTIVITY_HEADERS)) reply.header(name, value);
      },
    });
  }
}
