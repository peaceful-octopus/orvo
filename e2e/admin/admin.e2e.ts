import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

// These run against a server with an admin password and one without (see playwright.config.ts, E2E_ADMIN=1). The app is
// pointed at each server by the tests, the way the accounts tests do.
const SERVER = process.env.ADMIN_SERVER ?? 'http://localhost:8182';
const NO_ADMIN_SERVER = process.env.NO_ADMIN_SERVER ?? 'http://localhost:8183';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'e2e-admin-password';

const opened: BrowserContext[] = [];

/** Puts everything an earlier test changed back, so each test starts from the server's own settings. */
async function resetEverything(browser: Browser) {
  const context = await browser.newContext();
  opened.push(context);
  const login = await context.request.post(`${SERVER}/v1/admin/login`, { data: { password: PASSWORD } });
  const { token } = (await login.json()) as { token: string };
  const keys = ['maxRoomSize', 'warnRoomSize', 'minClientVersion', 'announcement', 'roomCreation', 'defaultRoomAccess', 'stunUrls', 'turnUrls', 'turnSecret', 'relayVideoKbps', 'relayVideoScale', 'relayVideoFps', 'giphyApiKey'];
  await context.request.patch(`${SERVER}/v1/admin/settings`, { headers: { authorization: `Bearer ${token}` }, data: { reset: keys } });
}

test.beforeEach(({ browser }) => resetEverything(browser));
test.afterEach(async ({ browser }) => {
  await resetEverything(browser);
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

async function newPage(browser: Browser, server = SERVER): Promise<Page> {
  const context = await browser.newContext();
  opened.push(context);
  await context.addInitScript((url) => localStorage.setItem('orvo:server', url), server);
  return context.newPage();
}

async function loginToAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel('Admin password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Calls and limits' })).toBeVisible();
}

const group = (page: Page, name: string) => page.getByRole('group', { name, exact: true });
const box = (page: Page, name: string) => page.getByRole('textbox', { name, exact: true });

test('the page says when the server has no admin password @admin', async ({ browser }) => {
  const page = await newPage(browser, NO_ADMIN_SERVER);
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'The admin page is turned off' })).toBeVisible();
  await expect(page.getByLabel('Admin password')).toHaveCount(0);
});

test('a wrong password is refused and the right one opens the settings @admin', async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto('/admin');
  await page.getByLabel('Admin password').fill('not the password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('That password is not right.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Calls and limits' })).toHaveCount(0);

  await page.getByLabel('Admin password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Calls and limits' })).toBeVisible();
  await expect(box(page, 'Room size')).toHaveValue('10');

  // A reload keeps the login for this tab; logging out ends it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Calls and limits' })).toBeVisible();
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByLabel('Admin password')).toBeVisible();
});

test('changes apply to the server right away, and a reset brings the default back @admin', async ({ browser }) => {
  const admin = await newPage(browser);
  await loginToAdmin(admin);
  await expect(admin.getByRole('button', { name: 'No changes' })).toBeDisabled();

  await box(admin, 'Room size').fill('4');
  await box(admin, 'Announcement').fill('Back in ten minutes');
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByText(/^Saved\./)).toBeVisible();
  await expect(group(admin, 'Room size').getByText('Changed here')).toBeVisible();
  // The warning size followed the room size down.
  await expect(box(admin, 'Warning size')).toHaveValue('4');

  // A person opening the app afterwards sees both, with no restart.
  const guest = await newPage(browser);
  await guest.goto('/');
  await expect(guest.getByText('Back in ten minutes')).toBeVisible();
  await expect(guest.getByText('Rooms hold up to 4 people.')).toBeVisible();

  await group(admin, 'Room size').getByRole('button', { name: 'Reset to default' }).click();
  await expect(box(admin, 'Room size')).toHaveValue('10');
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(group(admin, 'Room size').getByText('Changed here')).toHaveCount(0);

  const fresh = await newPage(browser);
  await fresh.goto('/');
  await expect(fresh.getByText('Rooms hold up to 10 people.')).toBeVisible();
});

test('an open page follows changes the operator makes later @admin', async ({ browser }) => {
  const guest = await newPage(browser);
  await guest.clock.install();
  await guest.goto('/');
  await expect(guest.getByText('Rooms hold up to 10 people.')).toBeVisible();

  const admin = await newPage(browser);
  await loginToAdmin(admin);
  await box(admin, 'Room size').fill('6');
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(admin.getByText(/^Saved\./)).toBeVisible();

  await guest.clock.fastForward('06:00'); // past the five minutes the page waits before asking the server again
  await expect(guest.getByText('Rooms hold up to 6 people.')).toBeVisible();
});

test('values that do not fit are explained, and nothing is saved @admin', async ({ browser }) => {
  const admin = await newPage(browser);
  await loginToAdmin(admin);

  await box(admin, 'Room size').fill('lots');
  await expect(admin.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(group(admin, 'Room size').getByText('Enter a whole number.')).toBeVisible();

  await box(admin, 'Room size').fill('4');
  await box(admin, 'Warning size').fill('8');
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(group(admin, 'Warning size').getByText('The warning size cannot be above the room size.')).toBeVisible();
  await expect(group(admin, 'Room size').getByText('Changed here')).toHaveCount(0);

  // Requiring sign-in is not on offer without a sign-in provider.
  await expect(group(admin, 'Who can start a room').getByRole('button', { name: 'Signed-in people only' })).toBeDisabled();
  await expect(admin.getByText(/needs a sign-in provider/).first()).toBeVisible();

  // A minimum version no app could meet is stopped before it locks everyone out.
  await box(admin, 'Room size').fill('10');
  await box(admin, 'Warning size').fill('6');
  await box(admin, 'Minimum app version').fill('99.0.0');
  await admin.getByRole('button', { name: 'Save changes' }).click();
  await expect(group(admin, 'Minimum app version').getByText(/would tell everyone using it to update/)).toBeVisible();
});

test('the admin page stays reachable when the minimum version locks the app out @admin', async ({ browser }) => {
  const admin = await newPage(browser);
  await loginToAdmin(admin);
  // Set through the API, which does not know this app's version.
  const token = await admin.evaluate(() => sessionStorage.getItem('orvo:admin-token'));
  const set = await admin.request.patch(`${SERVER}/v1/admin/settings`, { headers: { authorization: `Bearer ${token}` }, data: { set: { minClientVersion: '99.0.0' } } });
  expect(set.ok()).toBe(true);

  const guest = await newPage(browser);
  await guest.goto('/');
  await expect(guest.getByText(/update/i).first()).toBeVisible();

  await admin.reload();
  await expect(admin.getByRole('heading', { name: 'Calls and limits' })).toBeVisible();
  await expect(box(admin, 'Minimum app version')).toHaveValue('99.0.0');
});

test('requests that came through a reverse proxy are refused @admin', async ({ browser }) => {
  const context = await browser.newContext();
  opened.push(context);
  const plain = await context.request.get(`${SERVER}/v1/admin/status`);
  expect(plain.status()).toBe(200);
  const proxied = await context.request.get(`${SERVER}/v1/admin/status`, { headers: { 'x-forwarded-for': '203.0.113.9' } });
  expect(proxied.status()).toBe(403);
  expect(((await proxied.json()) as { code: string }).code).toBe('admin-local-only');
});
