import { loadActivities } from '@orvo/beacon';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../activities');

describe('bundled activities', () => {
  it('ship a valid Snake manifest and page', () => {
    const warnings: string[] = [];
    const registry = loadActivities([bundled], (m) => warnings.push(m));
    expect(warnings).toEqual([]);
    expect(registry.manifests).toContainEqual(
      expect.objectContaining({ id: 'snake', entry: '/activities/snake/index.html', apiVersion: 1, maxPlayers: 8 }),
    );
  });
});
