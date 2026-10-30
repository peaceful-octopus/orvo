import type { Metrics } from '@orvo/metrics';
import type { PlacementStore } from '@orvo/placement';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adminReachable, registerAdminRoutes } from './admin';
import { loadActivities, serveActivities, type ActivityRegistry } from './activities';
import { createBeaconApp } from './app';
import { authSettingsFromEnv } from './auth-env';
import { DriftMonitor, redisRegistry } from './drift';
import { loadOrCreateSigningKey, type SigningKey } from './keys';
import { SettingsStore, settingsFromEnv } from './settings';
import { fileSettings, redisSettings } from './settings-backend';
import type { TurnPool } from './turn';
import { serveWebApp } from './web';

/**
 * The beacon as both the personal server and the standalone beacon run it, so the two cannot drift apart. They differ
 * only in what is passed here: where rooms are placed, whether settings are shared through Redis, and whether a
 * relay serves every room.
 *
 * Environment:
 *   DATA_DIR         where the signing key, saved settings and extra activities live (default ./data)
 *   SIGNING_KEY      <kid>:<base64url secret>, shared by every beacon in a fleet (otherwise one is made in DATA_DIR)
 *   PREVIOUS_PUBLIC_KEYS   JSON { "<old kid>": "<base64url public key>" } kept published while rotating keys
 *   TURN_URLS / TURN_SECRET            relay pool
 *   TURN_LITE_URLS / TURN_LITE_SECRET  capped relay pool for the relay-lite tier
 *   CONFIG_FILE      a pre-signed config served as is (see tools/sign-config)
 *   MIN_CLIENT_VERSION, MAX_ROOM_SIZE, WARN_ROOM_SIZE, STUN_URLS, ANNOUNCEMENT(_ID), GIPHY_API_KEY, RELAY_VIDEO_*,
 *   ROOM_CREATION, DEFAULT_ROOM_ACCESS   starting values of the settings the admin page can change
 *   OIDC_*           sign-in with an OpenID Connect provider (docs/accounts.md)
 *   ADMIN_PASSWORD   turns on the admin page; ADMIN_ALLOW_REMOTE=1 lets it be reached through a proxy
 *   ACTIVITIES_DIR   activities to offer in calls besides the bundled ones (default DATA_DIR/activities)
 *   RATE_LIMIT_PER_MINUTE, CORS_ORIGIN, BEHIND_PROXY
 */
export interface BeaconServerOptions {
  env: Record<string, string | undefined>;
  /** Where rooms are placed among signaling nodes. */
  store: PlacementStore;
  /** With Redis, saved settings are kept in it and shared by every beacon on it; without, in a file in DATA_DIR. */
  redis?: Redis;
  /** A metrics registry shared with other components in the process. */
  metrics?: Metrics;
  /** The built web app to serve alongside the API, when there is one. */
  webDir?: string;
  /** The directory of activities that ship with the server. */
  bundledActivities?: string;
  /**
   * Whether a relay in the settings serves every room. A personal server has no entitlement service to grant one, so
   * it does; where an entitlement service exists, only rooms it names get the relay.
   */
  relayForEveryRoom: boolean;
}

export interface BeaconServer {
  app: FastifyInstance;
  signingKey: SigningKey;
  settings: SettingsStore;
  activities: ActivityRegistry;
  listen(port: number): Promise<void>;
  close(): Promise<void>;
}

function pool(urls: string | undefined, secret: string | undefined): TurnPool | undefined {
  return urls && secret ? { urls: urls.split(',').filter(Boolean), secret } : undefined;
}

export async function createBeaconServer(opts: BeaconServerOptions): Promise<BeaconServer> {
  const { env } = opts;
  const dataDir = env.DATA_DIR ?? './data';
  const signingKey = loadOrCreateSigningKey(dataDir, env.SIGNING_KEY);
  const signIn = authSettingsFromEnv(env);
  const settings = await SettingsStore.open({
    defaults: settingsFromEnv(env, signIn),
    backend: opts.redis ? redisSettings(opts.redis) : fileSettings(path.join(dataDir, 'settings.json')),
    authConfigured: Boolean(signIn.auth),
    defaultAnnouncementId: env.ANNOUNCEMENT_ID || 'notice',
  });
  const liteTurn = pool(env.TURN_LITE_URLS, env.TURN_LITE_SECRET);
  const activities = loadActivities([...(opts.bundledActivities ? [opts.bundledActivities] : []), env.ACTIVITIES_DIR ?? path.join(dataDir, 'activities')]);

  const app = await createBeaconApp({
    ...signIn,
    signingKey,
    previousPublicKeys: env.PREVIOUS_PUBLIC_KEYS ? JSON.parse(env.PREVIOUS_PUBLIC_KEYS) : undefined,
    store: opts.store,
    metrics: opts.metrics,
    activities: activities.manifests,
    stunUrls: settings.effective().stunUrls,
    live: () => {
      const live = settings.live();
      return { ...live, turn: { ...live.turn, 'relay-lite': liteTurn }, defaultTier: opts.relayForEveryRoom ? live.defaultTier : undefined };
    },
    staticConfig: env.CONFIG_FILE ? JSON.parse(fs.readFileSync(env.CONFIG_FILE, 'utf8')) : undefined,
    // 0 turns limiting off, which load tests need because every simulated user shares one address.
    rateLimitPerMinute: env.RATE_LIMIT_PER_MINUTE ? Number(env.RATE_LIMIT_PER_MINUTE) || false : undefined,
    corsOrigin: env.CORS_ORIGIN ?? true,
    trustProxy: Boolean(env.BEHIND_PROXY),
  });
  // With shared settings, beacons also check that they start from the same environment (see drift.ts).
  const drift = opts.redis
    ? new DriftMonitor({
        registry: redisRegistry(opts.redis),
        id: `${os.hostname()}-${randomBytes(2).toString('hex')}`,
        defaults: settings.defaults(),
        secret: signingKey.secretKey,
        isSaved: (key) => settings.isSaved(key),
      })
    : undefined;
  await drift?.start();
  // The admin page exists only when the server has a password for it.
  if (env.ADMIN_PASSWORD) {
    await registerAdminRoutes(app, { store: settings, password: env.ADMIN_PASSWORD, signingKey, allowRemote: env.ADMIN_ALLOW_REMOTE === '1', drift: () => drift?.current() });
  }
  await serveActivities(app, activities);
  if (opts.webDir && !(await serveWebApp(app, opts.webDir, { adminVisible: (req) => adminReachable(req, env.ADMIN_ALLOW_REMOTE === '1') }))) {
    console.warn(`No web app found at ${opts.webDir}; serving the API only.`);
  }

  return {
    app,
    signingKey,
    settings,
    activities,
    async listen(port) {
      await app.listen({ port, host: '0.0.0.0' });
    },
    async close() {
      await drift?.stop();
      settings.close();
      await app.close();
    },
  };
}
