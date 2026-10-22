import { describe, expect, it } from 'vitest';
import { resolveMode } from './theme';

describe('resolveMode', () => {
  it('follows the system when asked to', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
  });

  it('ignores the system when a mode is chosen', () => {
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});
