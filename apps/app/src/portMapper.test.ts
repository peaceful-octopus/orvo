import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.doUnmock('./platform');
  vi.doUnmock('@tauri-apps/api/core');
});

async function load(inTauri: boolean) {
  vi.doMock('./platform', () => ({ inTauri }));
  const invoke = vi.fn(async () => ({ externalIp: '203.0.113.7', externalPort: 50000 }));
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }));
  return { ...(await import('./portMapper')), invoke };
}

describe('portMapperFor', () => {
  it('has the app map ports natively while the setting is on', async () => {
    const { portMapperFor, invoke } = await load(true);
    const mapper = portMapperFor(true)!;
    await expect(mapper.map('192.168.1.20', 50000)).resolves.toEqual({ externalIp: '203.0.113.7', externalPort: 50000 });
    expect(invoke).toHaveBeenCalledWith('map_udp_port', { localIp: '192.168.1.20', localPort: 50000 });
    await mapper.unmap('192.168.1.20', 50000);
    expect(invoke).toHaveBeenCalledWith('unmap_udp_port', { localIp: '192.168.1.20', localPort: 50000 });
  });

  it('gives none when the setting is off, or in a browser', async () => {
    expect((await load(true)).portMapperFor(false)).toBeUndefined();
    vi.resetModules();
    expect((await load(false)).portMapperFor(true)).toBeUndefined();
  });
});
