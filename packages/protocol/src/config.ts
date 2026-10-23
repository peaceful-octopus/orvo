import { z } from 'zod';
import { signValue, verifyValue, type KeyRing } from './signing';

export const VideoTierConfig = z.object({
  /** Applies while the room has at most this many participants. */
  maxPeers: z.number().int().positive(),
  maxBitrate: z.number().int().positive(),
  scaleResolutionDownBy: z.number().min(1),
  maxFramerate: z.number().int().positive(),
});

/** Remotely delivered client configuration. Everything a server move or limit change needs. */
export const ClientConfig = z.object({
  /** Increases with every publish; clients refuse to go backwards. */
  version: z.number().int().nonnegative(),
  issuedAt: z.number().int(),
  validUntil: z.number().int(),
  minClientVersion: z.string(),
  minProtocol: z.number().int(),
  /** Beacon base URLs in preference order; later entries are fallbacks on other domains. */
  beaconUrls: z.array(z.url()).min(1),
  limits: z.object({
    maxRoomSize: z.number().int().positive(),
    warnRoomSize: z.number().int().positive(),
    videoTiers: z.array(VideoTierConfig).min(1),
    /** Limits for connections that go through a relay; clients use a built-in default when absent. */
    relayVideoTier: VideoTierConfig.omit({ maxPeers: true }).optional(),
  }),
  features: z.record(z.string(), z.boolean()),
  ice: z.object({ stunUrls: z.array(z.string()) }),
  /** Third-party services the app can use. Keys here reach every client, so only publish keys meant for browsers. */
  integrations: z.object({ giphyApiKey: z.string().min(1).optional() }).optional(),
  /** Present when the server lets people sign in (OpenID Connect). Guests can still join unless a room says otherwise. */
  auth: z
    .object({
      issuer: z.url(),
      /** The id this app is registered under at the provider. */
      clientId: z.string().min(1),
      scope: z.string().default('openid profile email'),
      /** When true, starting a room needs a signed-in account. */
      createRequiresLogin: z.boolean(),
    })
    .optional(),
  regions: z.array(z.object({ id: z.string(), name: z.string() })),
  announcement: z.object({ id: z.string(), text: z.string().max(280) }).optional(),
  updateUrl: z.url().optional(),
});
export type ClientConfig = z.infer<typeof ClientConfig>;

export interface SignedConfig {
  kid: string;
  payload: unknown;
  sig: string;
}

export function signConfig(config: ClientConfig, kid: string, secretKey: Uint8Array): SignedConfig {
  return { kid, payload: config, sig: signValue({ kid, payload: config }, secretKey) };
}

export type ConfigFailure = 'malformed' | 'unknown-kid' | 'bad-signature' | 'rollback' | 'expired';

export type ConfigResult = { ok: true; config: ClientConfig } | { ok: false; reason: ConfigFailure };

export interface ConfigChecks {
  keys: KeyRing;
  now: number;
  /** Version of the config currently cached, to refuse rollbacks. */
  cachedVersion?: number;
  /** How long past `validUntil` a config is still honored when no fresher one can be fetched. */
  graceMs: number;
}

export function verifyConfig(signed: unknown, checks: ConfigChecks): ConfigResult {
  const envelope = z.object({ kid: z.string(), payload: z.unknown(), sig: z.string() }).safeParse(signed);
  if (!envelope.success) return { ok: false, reason: 'malformed' };
  const { kid, payload, sig } = envelope.data;

  const publicKey = checks.keys[kid];
  if (!publicKey) return { ok: false, reason: 'unknown-kid' };
  if (!verifyValue({ kid, payload }, sig, publicKey)) return { ok: false, reason: 'bad-signature' };

  const config = ClientConfig.safeParse(payload);
  if (!config.success) return { ok: false, reason: 'malformed' };
  if (checks.cachedVersion !== undefined && config.data.version < checks.cachedVersion) {
    return { ok: false, reason: 'rollback' };
  }
  if (checks.now > config.data.validUntil + checks.graceMs) return { ok: false, reason: 'expired' };
  return { ok: true, config: config.data };
}
