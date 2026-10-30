import type { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** A change to the saved settings: values to store, and settings whose saved value is removed. Values are JSON-encodable. */
export interface SettingsChange {
  set: Record<string, unknown>;
  remove: string[];
}

/** Where the operator's saved settings are kept, one stored value per setting. */
export interface SettingsBackend {
  /** What messages call the place, such as a file path. */
  readonly where: string;
  /** Every saved setting by name, or `undefined` when nothing has been saved. The values are not checked. */
  load(): Promise<Record<string, unknown> | undefined>;
  /** Applies `change` to the saved settings, leaving the settings it does not name as they are. */
  save(change: SettingsChange): Promise<void>;
  /** Calls `onChange` when another process saved. Returns a function that stops listening. */
  watch?(onChange: () => void): () => void;
}

/** A file in the data directory: the settings of one server. */
export function fileSettings(file: string): SettingsBackend {
  const read = (): Record<string, unknown> | undefined => {
    if (!fs.existsSync(file)) return undefined;
    const text = fs.readFileSync(file, 'utf8');
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      // Not JSON: handed on as it is, so the caller reports it as damaged and the next save replaces it.
      return text as unknown as Record<string, unknown>;
    }
  };
  return {
    where: file,
    async load() {
      return read();
    },
    // Written to a temporary file and renamed over the real one, so a crash never leaves half a file.
    async save({ set, remove }) {
      const current = read();
      const next: Record<string, unknown> = typeof current === 'object' && current !== null && !Array.isArray(current) ? { ...current } : {};
      Object.assign(next, set);
      for (const key of remove) delete next[key];
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      try {
        fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
        fs.renameSync(temp, file);
      } catch (err) {
        fs.rmSync(temp, { force: true });
        throw err;
      }
    },
  };
}

/**
 * One Redis hash, a field per setting, shared by every beacon that uses the same Redis, so they all serve the same
 * settings and a beacon that starts later reads the current ones. A save touches only the fields it changes, so two
 * operators changing different settings at the same time both keep their change. A save also publishes on a channel,
 * which running beacons listen to.
 */
export function redisSettings(redis: Redis, key = 'orvo:settings'): SettingsBackend {
  const channel = `${key}:changed`;
  return {
    where: `Redis key ${key}`,
    async load() {
      const fields = await redis.hgetall(key);
      if (Object.keys(fields).length === 0) return undefined;
      return Object.fromEntries(
        Object.entries(fields).map(([name, text]) => {
          try {
            return [name, JSON.parse(text) as unknown];
          } catch {
            return [name, text]; // not JSON: kept as it is, and the check for that setting will refuse it
          }
        }),
      );
    },
    async save({ set, remove }) {
      const tx = redis.multi();
      const entries = Object.entries(set);
      if (entries.length > 0) tx.hset(key, Object.fromEntries(entries.map(([name, value]) => [name, JSON.stringify(value)])));
      if (remove.length > 0) tx.hdel(key, ...remove);
      tx.publish(channel, '1');
      const results = await tx.exec();
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
