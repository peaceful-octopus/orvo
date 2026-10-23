import { expect, test, type Browser, type BrowserContext, type Page, type WebSocketRoute } from '@playwright/test';
import { expectAllConnected } from '../helpers';

// The room owner's controls: removing people and locking the room. Same servers as accounts.e2e.ts.

const SERVER = process.env.ACCOUNTS_SERVER ?? 'http://localhost:8181';
const IDP = process.env.ACCOUNTS_IDP ?? 'http://127.0.0.1:9190';
const IDP_CONTROL = process.env.ACCOUNTS_IDP_CONTROL ?? IDP;

interface Person {
  page: Page;
  /** The page's signaling connections, so a test can cut them. */
  sockets: { client: WebSocketRoute; server: WebSocketRoute }[];
}

// Everyone in a test is in a call sending video, so they are all closed when the test is over.
const opened: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.close()));
});

async function person(browser: Browser, who?: string): Promise<Person> {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  opened.push(context);
  await context.addInitScript((server) => {
    localStorage.setItem('chillcall:server', server);
    if (!localStorage.getItem('chillcall:settings')) {
      localStorage.setItem('chillcall:settings', JSON.stringify({ state: { noise: { enabled: false, strength: 60 } }, version: 0 }));
    }
  }, SERVER);
  const page = await context.newPage();
  const sockets: Person['sockets'] = [];
  await page.routeWebSocket(/\/ws$/, (client) => sockets.push({ client, server: client.connectToServer() }));
  await page.goto('/');
  if (who) await signIn(page, who);
  return { page, sockets };
}

async function signIn(page: Page, who: string) {
  await page.request.get(`${IDP_CONTROL}/__user?name=${who}`);
  await page
    .getByRole('button', { name: /^Sign in/ })
    .first()
    .click();
  await expect
    .poll(() => page.evaluate(() => Boolean(localStorage.getItem('chillcall:auth')) && !location.pathname.startsWith('/auth/')).catch(() => false))
    .toBe(true);
}

async function enter(page: Page, roomPath: string, name: string) {
  await page.goto(roomPath);
  await page.getByPlaceholder('Your name').fill(name);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
}

/** Ann starts a room and joins it; returns her page and the room's path. */
async function annsRoom(browser: Browser) {
  const ann = await person(browser, 'ann');
  await ann.page.getByRole('button', { name: 'Start a room' }).click();
  await expect(ann.page).toHaveURL(/\/r\//);
  const roomPath = new URL(ann.page.url()).pathname;
  await ann.page.getByRole('button', { name: 'Join', exact: true }).click();
  await expect(ann.page.getByRole('button', { name: 'Leave' })).toBeVisible();
  return { ann: ann.page, roomPath };
}

const removed = (page: Page) => page.getByRole('alert').filter({ hasText: 'You were removed from this room' });
const locked = (page: Page) => page.getByRole('alert').filter({ hasText: 'This room is locked' });

test('the owner can remove someone, who is told and cannot get back in with the same account @accounts', async ({ browser }) => {
  const { ann, roomPath } = await annsRoom(browser);
  const bob = (await person(browser, 'bob')).page;
  await enter(bob, roomPath, 'Bob');
  await expect(bob.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expectAllConnected([ann, bob]);

  // Only the owner has remove buttons.
  await expect(bob.getByRole('button', { name: /^Remove .* from the room$/ })).toHaveCount(0);
  await ann.locator('.slot', { hasText: 'Bob' }).hover();
  await ann.getByRole('button', { name: 'Remove Bob from the room' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Remove Bob?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(removed(bob)).toBeVisible();
  await expect(ann.locator('.bubble')).toHaveCount(1); // Bob is gone from Ann's call

  // Bob tries again, even after reloading: the account is out.
  await enter(bob, roomPath, 'Bob');
  await expect(removed(bob)).toBeVisible();
});

test('removing and locking in one step keeps out a guest who tries to come back as someone new @accounts', async ({ browser }) => {
  const { ann, roomPath } = await annsRoom(browser);
  const guest = (await person(browser)).page;
  await enter(guest, roomPath, 'Troll');
  await expect(guest.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expectAllConnected([ann, guest]);

  await ann.locator('.slot', { hasText: 'Troll' }).hover();
  await ann.getByRole('button', { name: 'Remove Troll from the room' }).click();
  await ann.getByRole('dialog', { name: 'Remove Troll?' }).getByRole('button', { name: 'Remove and lock the room' }).click();
  await expect(removed(guest)).toBeVisible();

  // A guest has no account to ban, so a fresh page is a new person; the lock is what stops them.
  const again = (await person(browser)).page;
  await enter(again, roomPath, 'Troll again');
  await expect(locked(again)).toBeVisible();
});

test('a locked room admits nobody new, keeps its members connected through a drop, and opens again when unlocked @accounts', async ({ browser }) => {
  const { ann, roomPath } = await annsRoom(browser);
  const bob = await person(browser, 'bob');
  await enter(bob.page, roomPath, 'Bob');
  await expect(bob.page.getByRole('button', { name: 'Leave' })).toBeVisible();
  await expectAllConnected([ann, bob.page]);

  await ann.getByRole('button', { name: 'Room controls' }).click();
  const lock = ann.getByRole('menuitemcheckbox', { name: /Lock the room/ });
  await lock.click();
  await expect(lock).toHaveAttribute('aria-checked', 'true');
  await ann.keyboard.press('Escape');

  // Someone new, signed in or not, is turned away.
  for (const [label, who] of [['Cy', undefined], ['Dee', 'dee']] as const) {
    const newcomer = (await person(browser, who)).page;
    await enter(newcomer, roomPath, label);
    await expect(locked(newcomer)).toBeVisible();
  }

  // Bob's connection to the server drops; he is let back in because he was already here.
  for (const { client, server } of bob.sockets) {
    void client.close();
    void server.close();
  }
  await expect(bob.page.locator('.banner', { hasText: 'Reconnecting' })).toBeHidden();
  await expect.poll(() => bob.sockets.length).toBeGreaterThan(1); // a second connection was made, and admitted
  await expectAllConnected([ann, bob.page]);

  // Ann unlocks the room, and a newcomer can join.
  await ann.getByRole('button', { name: 'Room controls' }).click();
  await ann.getByRole('menuitemcheckbox', { name: /Lock the room/ }).click();
  await ann.keyboard.press('Escape');
  const cy = (await person(browser)).page;
  await enter(cy, roomPath, 'Cy');
  await expect(cy.getByRole('button', { name: 'Leave' })).toBeVisible();
});

test('the owner is always let back into a locked room @accounts', async ({ browser }) => {
  const { ann, roomPath } = await annsRoom(browser);
  await ann.getByRole('button', { name: 'Room controls' }).click();
  await ann.getByRole('menuitemcheckbox', { name: /Lock the room/ }).click();
  await ann.keyboard.press('Escape');
  await ann.getByRole('button', { name: 'Leave' }).click();

  // Ann leaves and comes back with no resume token: the owner is never locked out.
  await enter(ann, roomPath, 'Ann');
  await expect(ann.getByRole('button', { name: 'Leave' })).toBeVisible();
});
