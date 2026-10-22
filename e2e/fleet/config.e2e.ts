import { fromBase64Url, signConfig, type ClientConfig } from '@chillcall/protocol';
import { makeConfig } from '@chillcall/testkit';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';
import { FLEET_KID, FLEET_SECRET } from './keys';

// The beacon in the fleet suite signs with a known test key, so these tests can publish their own config
// to a page and check that the app obeys it.
async function serveConfig(target: Page | BrowserContext, overrides: Partial<ClientConfig>) {
  const signed = signConfig(
    makeConfig({ version: Math.floor(Date.now() / 1000) + 1, validUntil: Date.now() + 3600_000, beaconUrls: ['http://localhost:8180'], ...overrides }, Date.now()),
    FLEET_KID,
    fromBase64Url(FLEET_SECRET),
  );
  await target.route('**/v1/config', (route) => route.fulfill({ json: signed }));
}

test('a server that requires a newer client blocks the app with an update screen @fleet', async ({ page }) => {
  await serveConfig(page, { minClientVersion: '9.0.0', updateUrl: 'https://example.com/download' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Update required' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Get the latest version' })).toHaveAttribute('href', 'https://example.com/download');
  await expect(page.getByRole('button', { name: 'Start a room' })).toHaveCount(0);
});

test('an announcement shows once and stays dismissed @fleet', async ({ page }) => {
  await serveConfig(page, { announcement: { id: 'maint-1', text: 'Maintenance on Friday at noon.' } });
  await page.goto('/');
  const banner = page.getByRole('status').filter({ hasText: 'Maintenance on Friday at noon.' });
  await expect(banner).toBeVisible();

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toBeHidden();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'ChillCall' })).toBeVisible();
  await expect(banner).toBeHidden();
});

test('room size and warning thresholds come from the published config @fleet', async ({ context }) => {
  await serveConfig(context, {
    limits: {
      maxRoomSize: 4,
      warnRoomSize: 2,
      videoTiers: [{ maxPeers: 4, maxBitrate: 300_000, scaleResolutionDownBy: 2, maxFramerate: 15 }],
    },
  });
  const home = await context.newPage();
  await home.goto('/');
  await expect(home.getByText('Rooms hold up to 4 people.')).toBeVisible();

  // Two people is within the published warning threshold of 2; a third crosses it.
  const room = `fleet-limits-${Date.now()}`;
  const pages = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected(pages);
  await expect(pages[0]!.locator('.banner', { hasText: 'More than 2 people' })).toHaveCount(0);

  pages.push(await joinRoom(context, room, 'cy'));
  await expectAllConnected(pages);
  await expect(pages[0]!.locator('.banner', { hasText: 'More than 2 people are here' })).toBeVisible();
});
