import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { expectAllConnected } from '../helpers';

// These run against a server that needs an account to start a room (see playwright.config.ts) and a fake sign-in
// provider that approves at once; `/__user?name=bob` chooses who it signs in next.

const SERVER = 'http://localhost:8181';
const IDP = 'http://127.0.0.1:9190';

async function newPerson(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await context.addInitScript((server) => {
    localStorage.setItem('chillcall:server', server);
    if (!localStorage.getItem('chillcall:settings')) {
      localStorage.setItem('chillcall:settings', JSON.stringify({ state: { noise: { enabled: false, strength: 60 } }, version: 0 }));
    }
  }, SERVER);
  return context;
}

/** Signs in as `who` through the provider and lands back where the person was. */
async function signInAs(page: Page, who: string, button = 'Sign in') {
  await page.request.get(`${IDP}/__user?name=${who}`);
  await page.getByRole('button', { name: button }).first().click();
  // The page leaves for the provider and comes back; signed in means the tokens are stored and we are on the app again.
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem('chillcall:auth')) && !location.pathname.startsWith('/auth/')).catch(() => false), {
      message: 'signed in and back on the app',
    })
    .toBe(true);
}

test('starting a room needs an account, and signing in brings the person back to the same page @accounts', async ({ browser }) => {
  const context = await newPerson(browser);
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in to start a room' })).toBeVisible();

  await signInAs(page, 'ann', 'Sign in to start a room');
  await expect(page.getByRole('button', { name: 'Start a room' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Signed in as Ann' })).toBeVisible();

  await page.getByRole('button', { name: 'Start a room' }).click();
  await expect(page).toHaveURL(/\/r\/[a-z0-9-]+$/);
  await expect(page.getByPlaceholder('Your name')).toHaveValue('Ann'); // the account's name is the starting point
});

test('a guest cannot start a room by joining a name nobody has used, and can once signed in @accounts', async ({ browser }) => {
  const context = await newPerson(browser);
  const page = await context.newPage();
  await page.goto(`/r/new-room-${Date.now()}`);
  await page.getByPlaceholder('Your name').fill('Guest');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Sign in to start this room' })).toBeVisible();

  await signInAs(page, 'ann');
  await expect(page.getByPlaceholder('Your name')).toBeVisible();
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Leave' })).toBeVisible();
});

test('a signed-in-only room keeps guests out until they sign in, and the owner can open and close it @accounts', async ({ browser }) => {
  const ann = await newPerson(browser);
  const annPage = await ann.newPage();
  await annPage.goto('/');
  await signInAs(annPage, 'ann', 'Sign in to start a room');
  await annPage.getByLabel('Only signed-in people can join').check();
  await annPage.getByRole('button', { name: 'Start a room' }).click();
  await expect(annPage).toHaveURL(/\/r\//);
  const roomPath = new URL(annPage.url()).pathname;
  await annPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(annPage.getByRole('button', { name: 'Leave' })).toBeVisible();
  const lock = annPage.getByRole('button', { name: 'Only signed-in people can join' });
  await expect(lock).toHaveAttribute('aria-pressed', 'true'); // Ann made the room, so she can see and change this

  // A guest is turned away with a way forward.
  const guest = await newPerson(browser);
  const guestPage = await guest.newPage();
  await guestPage.goto(roomPath);
  await guestPage.getByPlaceholder('Your name').fill('Guest');
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guestPage.getByRole('alert').filter({ hasText: 'This room is for signed-in people' })).toBeVisible();

  // Bob signs in and gets in; he is not the owner, so he has no lock button.
  await signInAs(guestPage, 'bob');
  await guestPage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(guestPage.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Only signed-in people can join' })).toHaveCount(0);
  await expectAllConnected([annPage, guestPage]);

  // Ann opens the room to guests, and a guest can now join.
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  const late = await newPerson(browser);
  const latePage = await late.newPage();
  await latePage.goto(roomPath);
  await latePage.getByPlaceholder('Your name').fill('Late guest');
  await latePage.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(latePage.getByRole('button', { name: 'Leave' })).toBeVisible();
});

test('a sign-in that is about to run out is renewed without asking again @accounts', async ({ browser }) => {
  const context = await newPerson(browser);
  const page = await context.newPage();
  await page.goto('/');
  await signInAs(page, 'ann', 'Sign in to start a room');
  const before = await page.evaluate(() => (JSON.parse(localStorage.getItem('chillcall:auth')!) as { expiresAt: number }).expiresAt);

  // Pretend the token has nearly run out.
  await page.evaluate(() => {
    const tokens = JSON.parse(localStorage.getItem('chillcall:auth')!);
    tokens.expiresAt = Date.now() + 5_000;
    localStorage.setItem('chillcall:auth', JSON.stringify(tokens));
  });
  await page.reload();
  await page.getByRole('button', { name: 'Start a room' }).click(); // asks the server for a room, which renews the token first
  await expect(page).toHaveURL(/\/r\//);
  const after = await page.evaluate(() => (JSON.parse(localStorage.getItem('chillcall:auth')!) as { expiresAt: number }).expiresAt);
  expect(after).toBeGreaterThan(before - 1000);
  expect(after).toBeGreaterThan(Date.now() + 60_000);
});

test('a sign-in the server does not accept is cleared and the person is asked to sign in again @accounts', async ({ browser }) => {
  const context = await newPerson(browser);
  const page = await context.newPage();
  await page.goto('/');
  await signInAs(page, 'ann', 'Sign in to start a room');
  await page.getByRole('button', { name: 'Start a room' }).click();
  await expect(page).toHaveURL(/\/r\//);

  // Break the token while keeping it looking valid to the app.
  await page.evaluate(() => {
    const tokens = JSON.parse(localStorage.getItem('chillcall:auth')!);
    const [head, body] = tokens.idToken.split('.');
    tokens.idToken = `${head}.${body}.forged-signature`;
    localStorage.setItem('chillcall:auth', JSON.stringify(tokens));
  });
  await page.reload();
  await page.getByPlaceholder('Your name').fill('Ann');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Your sign-in ran out' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('chillcall:auth'))).toBeNull();
});

test('signing out returns to being a guest, and Settings shows who is signed in @accounts', async ({ browser }) => {
  const context = await newPerson(browser);
  const page = await context.newPage();
  await page.goto('/');
  await signInAs(page, 'bob', 'Sign in to start a room');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByText('Bob', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(dialog.getByText('You are using ChillCall as a guest.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Sign in to start a room' })).toBeVisible();
});

test('the server that does not offer accounts shows no sign-in anywhere @accounts', async ({ browser }) => {
  // Point the app at the ordinary server (no provider); nothing about accounts should appear.
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  await context.addInitScript(() => localStorage.setItem('chillcall:server', 'http://localhost:8080'));
  const page = await context.newPage();
  const reachable = await page.request.get('http://localhost:8080/healthz').then((r) => r.ok(), () => false);
  test.skip(!reachable, 'needs the ordinary server on :8080 (pnpm --filter @chillcall/server start)');
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Start a room' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sign in/ })).toHaveCount(0);
  await expect(page.getByLabel('Only signed-in people can join')).toHaveCount(0);
});
