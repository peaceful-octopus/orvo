import { expect, test, type Page } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

/** Makes the browser refuse something, the way a missing device or a blocked permission would. */
const failNext = (page: Page, api: 'getDisplayMedia' | 'getUserMedia', error: { name: string; message: string }) =>
  page.evaluate(
    ([name, e]) => {
      (navigator.mediaDevices as unknown as Record<string, unknown>)[name] = () => Promise.reject(Object.assign(new Error(e.message), { name: e.name }));
    },
    [api, error] as const,
  );

test('a screen share that fails says so, while closing the picker stays quiet @smoke', async ({ context }) => {
  const ann = await joinRoom(context, `e2e-toast-share-${Date.now()}`, 'ann');
  await expect(ann.getByRole('button', { name: 'Leave' })).toBeVisible();

  await failNext(ann, 'getDisplayMedia', { name: 'NotAllowedError', message: 'Permission denied' }); // the person cancelled
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await ann.waitForTimeout(800);
  await expect(ann.getByRole('alert')).toHaveCount(0);

  await failNext(ann, 'getDisplayMedia', { name: 'NotReadableError', message: 'Could not start video source' });
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(ann.getByRole('alert')).toContainText('Could not start screen sharing');
  await expect(ann.getByRole('button', { name: 'Share screen' })).toBeVisible(); // still ready to try again

  await failNext(ann, 'getDisplayMedia', { name: 'NotAllowedError', message: 'Permission denied by system' });
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(ann.getByRole('alert').filter({ hasText: 'blocked' })).toBeVisible();
});

test('turning a camera or microphone back on that no longer works says so and leaves it off @smoke', async ({ context }) => {
  // With the noise filter off, the microphone in the call is the device's own track.
  await context.addInitScript(() => {
    localStorage.setItem('chillcall:settings', JSON.stringify({ state: { noise: { enabled: false, strength: 60 } }, version: 0 }));
  });
  const ann = await joinRoom(context, `e2e-toast-device-${Date.now()}`, 'ann');
  await expect(ann.getByRole('button', { name: 'Leave' })).toBeVisible();
  const stopTracks = (kind: 'video' | 'audio') =>
    ann.evaluate((k) => {
      const video = document.querySelector('.bubble video') as HTMLVideoElement;
      const stream = video.srcObject as MediaStream;
      (k === 'video' ? stream.getVideoTracks() : stream.getAudioTracks()).forEach((t) => t.stop());
    }, kind);

  // Turn the camera off, then lose it (the track ends) and make opening it again fail.
  await ann.getByRole('button', { name: 'Camera off' }).click();
  await stopTracks('video');
  await failNext(ann, 'getUserMedia', { name: 'NotReadableError', message: 'Could not start video source' });
  await ann.getByRole('button', { name: 'Camera on' }).click();
  await expect(ann.getByRole('alert')).toContainText('Could not turn your camera on');
  await expect(ann.getByRole('button', { name: 'Camera on' })).toBeVisible(); // still off

  await ann.getByRole('button', { name: 'Mute' }).click();
  await stopTracks('audio');
  await ann.getByRole('button', { name: 'Unmute' }).click();
  await expect(ann.getByRole('alert').filter({ hasText: 'microphone' })).toBeVisible();
  await expect(ann.getByRole('button', { name: 'Unmute' })).toBeVisible(); // still muted
});

test('a camera that stops by itself during a call is turned off with a message, and others see it off @smoke', async ({ context }) => {
  const room = `e2e-toast-lost-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  await ann.evaluate(() => {
    const video = document.querySelector('.bubble video') as HTMLVideoElement;
    const track = (video.srcObject as MediaStream).getVideoTracks()[0]!;
    track.dispatchEvent(new Event('ended')); // what the browser does when a camera is unplugged
  });
  await expect(ann.getByRole('alert')).toContainText('camera stopped working');
  await expect(ann.getByRole('button', { name: 'Camera on' })).toBeVisible();
  await expect(bob.locator('.bubble').nth(1).locator('.initial')).toBeVisible(); // bob sees ann's initial, not her picture
});

test('messages can be dismissed, and go away on their own @smoke', async ({ context }) => {
  const ann = await joinRoom(context, `e2e-toast-dismiss-${Date.now()}`, 'ann');
  await expect(ann.getByRole('button', { name: 'Leave' })).toBeVisible();
  await failNext(ann, 'getDisplayMedia', { name: 'AbortError', message: 'x' });
  await ann.getByRole('button', { name: 'Share screen' }).click();
  await expect(ann.getByRole('alert')).toBeVisible();
  await ann.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(ann.getByRole('alert')).toHaveCount(0);
});
