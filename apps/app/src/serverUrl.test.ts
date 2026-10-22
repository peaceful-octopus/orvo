import { describe, expect, it } from 'vitest';
import { normalizeServerUrl } from './serverUrl';

describe('normalizeServerUrl', () => {
  it('returns empty for blank input so the default applies', () => {
    expect(normalizeServerUrl('   ')).toBe('');
  });

  it('adds https for public hosts and http for local addresses', () => {
    expect(normalizeServerUrl('chill.example.com')).toBe('https://chill.example.com');
    expect(normalizeServerUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeServerUrl('192.168.1.20:8080')).toBe('http://192.168.1.20:8080');
  });

  it('keeps an explicit scheme and drops paths and trailing slashes', () => {
    expect(normalizeServerUrl('http://chill.example.com/')).toBe('http://chill.example.com');
    expect(normalizeServerUrl('https://chill.example.com/some/path')).toBe('https://chill.example.com');
  });

  it('rejects other schemes and garbage', () => {
    expect(normalizeServerUrl('ftp://example.com')).toBeNull();
    expect(normalizeServerUrl('http://')).toBeNull();
  });
});
