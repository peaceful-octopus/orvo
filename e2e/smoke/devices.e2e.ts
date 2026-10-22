import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

// Chromium's fake devices appear as the system default plus at least one named device.

test('the lobby lists devices and defaults to the system default @smoke', async ({ page }) => {
  await page.goto(`/r/e2e-devices-lobby-${Date.now()}`);
  const camera = page.getByLabel('Camera');
  await expect(camera).toBeVisible();
  await expect(camera.locator('option').first()).toHaveText(/System default/);
  await expect(camera).toHaveValue('');
  expect(await page.getByLabel('Microphone').locator('option').count()).toBeGreaterThan(1);
});

test('switching camera and microphone mid-call keeps everyone connected and is remembered @smoke', async ({ context }) => {
  const room = `e2e-devices-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  const trackDevice = (kind: 'audio' | 'video') =>
    ann.locator('.bubble video').first().evaluate(
      (v, k) => ((v as HTMLVideoElement).srcObject as MediaStream | null)?.[k === 'audio' ? 'getAudioTracks' : 'getVideoTracks']()[0]?.getSettings().deviceId,
      kind,
    );

  const saved = () => ann.evaluate(() => JSON.parse(localStorage.getItem('chillcall:devices') ?? '{}') as Record<string, string>);

  for (const [menu, group, kind, key] of [
    ['Microphone options', 'Microphone', 'audio', 'audioinput'],
    ['Camera options', 'Camera', 'video', 'videoinput'],
  ] as const) {
    await ann.getByRole('button', { name: menu }).click();
    const options = ann.getByRole('group', { name: group }).getByRole('menuitemradio');
    await expect(options.first()).toHaveAttribute('aria-checked', 'true'); // system default is chosen to begin with
    const count = await options.count();
    expect(count).toBeGreaterThan(1);
    await options.nth(count - 1).click();
    await expect(options.nth(count - 1)).toHaveAttribute('aria-checked', 'true');
    // The call now sends from that exact device (there may be only one fake device, so compare with the saved id).
    await expect.poll(async () => (await saved())[key]).not.toBe('');
    await expect.poll(async () => (await trackDevice(kind)) === (await saved())[key]).toBe(true);
    await ann.keyboard.press('Escape');
  }

  await expectAllConnected([ann, bob]); // bob still receives ann's video after the swap
});
