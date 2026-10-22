import { describe, expect, it } from 'vitest';
import { generateRoomId, isValidRoomSlug, randomId } from './room';

describe('room ids', () => {
  it('generates valid, distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, generateRoomId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isValidRoomSlug(id)).toBe(true);
  });

  it('rejects malformed slugs', () => {
    for (const bad of ['ab', 'Has_Underscore', 'UPPER', 'has space', 'x'.repeat(65), '']) {
      expect(isValidRoomSlug(bad)).toBe(false);
    }
    expect(isValidRoomSlug('e2e-room-123')).toBe(true);
  });

  it('randomId returns hex of the requested length', () => {
    expect(randomId(8)).toMatch(/^[0-9a-f]{16}$/);
  });
});
