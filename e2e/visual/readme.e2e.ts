import { test, type BrowserContext, type Page } from '@playwright/test';

// Not a pass/fail check: it photographs the pictures in README.md. Run with `pnpm test:e2e:readme`; they are written to
// docs/screenshots. The camera is replaced by a drawn avatar per person, so no real faces are needed.

const OUT = 'docs/screenshots';
const PEOPLE = [
  { name: 'Joel', colour: '#ff7a3d' },
  { name: 'Sam', colour: '#6dd3ce' },
  { name: 'Maya', colour: '#c8e9a0' },
];

async function useDrawnCamera(context: BrowserContext, who: { name: string; colour: string }) {
  await context.addInitScript((p) => {
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = constraints?.audio ? await real({ audio: constraints.audio }) : new MediaStream();
      if (constraints?.video) {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d')!;
        const draw = () => {
          const g = ctx.createLinearGradient(0, 0, 640, 480);
          g.addColorStop(0, p.colour);
          g.addColorStop(1, '#2b211c');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, 640, 480);
          ctx.fillStyle = 'rgba(255,255,255,0.88)';
          ctx.beginPath();
          ctx.arc(320, 200, 74, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(320, 420, 150, 120, 0, 0, Math.PI * 2);
          ctx.fill();
          requestAnimationFrame(draw);
        };
        draw();
        canvas.captureStream(15).getVideoTracks().forEach((t) => stream.addTrack(t));
      }
      return stream;
    };
    localStorage.setItem(
      'orvo:settings',
      JSON.stringify({ state: { palette: 'evening', mode: 'dark', name: p.name, noise: { enabled: false, strength: 60 } }, version: 0 }),
    );
  }, who);
}

test('README pictures @readme', async ({ browser }) => {
  const room = `readme-${Date.now()}`;
  const pages: Page[] = [];
  for (const who of PEOPLE) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, permissions: ['camera', 'microphone'] });
    await useDrawnCamera(context, who);
    pages.push(await context.newPage());
  }
  const [joel, ...others] = pages as [Page, ...Page[]];

  for (const page of pages) {
    await page.goto(`/r/${room}`);
    await page.getByRole('button', { name: 'Join', exact: true }).click();
    await page.getByRole('button', { name: 'Leave' }).waitFor();
  }
  await joel.locator('.bubble').nth(2).waitFor();
  await joel.waitForTimeout(2500);
  await joel.screenshot({ path: `${OUT}/call.png` });

  await joel.getByRole('button', { name: 'Effects' }).click();
  await joel.waitForTimeout(800);
  await joel.screenshot({ path: `${OUT}/effects.png` });
  await joel.keyboard.press('Escape');

  await joel.getByRole('button', { name: 'Settings' }).click();
  await joel.waitForTimeout(500);
  await joel.screenshot({ path: `${OUT}/settings.png` });
  void others;
});
