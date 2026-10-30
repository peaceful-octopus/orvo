import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Where the operator's saved settings are kept, as the JSON text of the object `SettingsStore` writes. */
export interface SettingsBackend {
  /** What messages call the place, such as a file path. */
  readonly where: string;
  /** The saved text, or `undefined` when nothing has been saved. */
  load(): Promise<string | undefined>;
  save(text: string): Promise<void>;
  /** Calls `onChange` when another process saved. Returns a function that stops listening. */
  watch?(onChange: () => void): () => void;
}

/** A file in the data directory: the settings of one server. */
export function fileSettings(file: string): SettingsBackend {
  return {
    where: file,
    async load() {
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    },
    // Written to a temporary file and renamed over the real one, so a crash never leaves half a file.
    async save(text) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(temp, text, { mode: 0o600 });
        fs.renameSync(temp, file);
      } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
      }
    },
  };
}

/**
 * One Redis key shared by every beacon that uses the same Redis, so they all serve the same settings and a beacon that
 * starts later reads the current ones. A save also publishes on a channel, which running beacons listen to.
 */
export function redisSettings(redis: Redis, key = 'orvo:settings'): SettingsBackend {
  const channel = `${key}:changed`;
  return {
    where: `Redis key ${key}`,
    async load() {
      return (await redis.get(key)) ?? undefined;
    },
    async save(text) {
      const results = await redis.multi().set(key, text).publish(channel, '1').exec();
      const failed = results?.find(([err]) => err);
      if (failed) throw failed[0];
    },
    watch(onChange) {
      const subscriber = redis.duplicate();
      subscriber.on('error', () => {});
      void subscriber.subscribe(channel).catch(() => {});
      subscriber.on('message', (name) => name === channel && onChange());
      return () => void subscriber.quit().catch(() => {});
    },
  };
}
