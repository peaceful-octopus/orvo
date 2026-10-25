import { describe, expect, it, vi } from 'vitest';
import { createUpdater, type PendingUpdate } from './updater';

const offer = (over: Partial<PendingUpdate> = {}): PendingUpdate => ({ version: '1.1.0', downloadAndInstall: vi.fn(async () => {}), ...over });

describe('updater', () => {
  it('offers a newer version and stays quiet when there is none or the check fails', async () => {
    const none = createUpdater({ check: async () => null, relaunch: async () => {} });
    await none.getState().check();
    expect(none.getState().status).toBe('idle');

    const broken = createUpdater({ check: async () => Promise.reject(new Error('offline')), relaunch: async () => {} });
    await broken.getState().check();
    expect(broken.getState().status).toBe('idle');

    const found = createUpdater({ check: async () => offer(), relaunch: async () => {} });
    await found.getState().check();
    expect(found.getState()).toMatchObject({ status: 'available', version: '1.1.0' });
  });

  it('installs the offer and then restarts', async () => {
    const update = offer();
    const relaunch = vi.fn(async () => {});
    const store = createUpdater({ check: async () => update, relaunch });
    await store.getState().check();
    await store.getState().install();
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    expect(store.getState().status).toBe('installing');
  });

  it('reports a failed install and lets the person try again', async () => {
    const update = offer({ downloadAndInstall: vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined) });
    const relaunch = vi.fn(async () => {});
    const store = createUpdater({ check: async () => update, relaunch });
    await store.getState().check();
    await store.getState().install();
    expect(store.getState().status).toBe('failed');
    expect(relaunch).not.toHaveBeenCalled();
    await store.getState().install();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it('does nothing when there is nothing to install', async () => {
    const relaunch = vi.fn(async () => {});
    const store = createUpdater({ check: async () => null, relaunch });
    await store.getState().install();
    expect(relaunch).not.toHaveBeenCalled();
  });
});
