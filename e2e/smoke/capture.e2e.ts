import { expect, test, type Page } from '@playwright/test';
import { expectInCall, joinRoom, seedSettings } from '../helpers';

// The camera is opened at 720p, and a camera that cannot do that still works at its default size.

const cameraSizes = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('video')]
      .map((v) => (v.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings())
      .filter((s): s is MediaTrackSettings => Boolean(s))
      .map((s) => `${s.width}x${s.height}`),
  );

test('the camera is opened at 1280x720 @smoke', async ({ context }) => {
  await seedSettings(context);
  const page = await joinRoom(context, `e2e-capture-${Date.now()}`, 'ann');
  await expectInCall(page);
  expect(await cameraSizes(page)).toContain('1280x720');
});

test('a camera that cannot be opened at 720p is opened at its default size @smoke', async ({ context }) => {
  await seedSettings(context);
  // This camera refuses any request that names a size, as some drivers do for a mode they do not offer.
  await context.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      const video = constraints?.video;
      if (video && typeof video === 'object' && 'width' in video) return Promise.reject(new DOMException('no such mode', 'OverconstrainedError'));
      return original(constraints);
    };
  });
  const page = await joinRoom(context, `e2e-capture-fallback-${Date.now()}`, 'ann');
  await expectInCall(page);
  const sizes = await cameraSizes(page);
  expect(sizes).toContain('640x480');
  expect(sizes).not.toContain('1280x720');
});
