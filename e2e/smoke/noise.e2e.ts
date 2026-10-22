import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

// Uses the real DeepFilterNet3 files from apps/app/public/noise. The browser runs with its sound output muted.

test('the noise filter starts with the call, can be turned off and on, and the call stays connected @smoke', async ({ context }) => {
  const room = `e2e-noise-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  // What is sent is the filter's output (a Web Audio destination track) rather than the raw microphone.
  const FILTERED = 'MediaStreamAudioDestinationNode';
  const sentLabel = () =>
    ann.locator('.bubble video').first().evaluate((v) => ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0]?.label);

  await ann.getByRole('button', { name: 'Settings' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.locator('.hint[role="status"]')).toHaveText('Noise filter running.');
  expect(await sentLabel()).toBe(FILTERED);
  await expect(ann.getByText('Noise suppression could not start')).toHaveCount(0);

  await dialog.getByLabel('Reduce background noise and typing sounds').uncheck();
  await expect(dialog.locator('.hint[role="status"]')).toContainText('extra processing power');
  await expect.poll(sentLabel).not.toBe(FILTERED); // the raw microphone again

  await dialog.getByLabel('Reduce background noise and typing sounds').check();
  await expect(dialog.locator('.hint[role="status"]')).toHaveText('Noise filter running.');
  await dialog.getByLabel('Noise suppression strength').fill('100'); // applies live without restarting the filter
  await expect(dialog.locator('.hint[role="status"]')).toHaveText('Noise filter running.');
  expect(await sentLabel()).toBe(FILTERED);

  await expectAllConnected([ann, bob]);
});

test('bob keeps receiving a live audio track from ann while the filter runs @smoke', async ({ context }) => {
  const room = `e2e-noise-audio-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);
  await expect(ann.getByText('Noise suppression could not start')).toHaveCount(0);

  // The fake microphone's beep counts as noise to the model, so check that audio is flowing, not how loud it is.
  const received = () =>
    bob.locator('.bubble video').nth(1).evaluate((v) => {
      const track = ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0];
      return { state: track?.readyState, muted: track?.muted };
    });
  await expect.poll(received).toEqual({ state: 'live', muted: false });
});

test('the filter really removes steady hiss and key-click bursts @smoke', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createMicProcessor } = await import('/src/noise.ts');
    const rate = 48000;
    const source = (fill: (t: number) => number) => {
      const context = new AudioContext({ sampleRate: rate });
      const destination = context.createMediaStreamDestination();
      const buffer = context.createBuffer(1, rate * 2, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = fill(i / rate);
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(destination);
      node.start();
      return destination.stream.getAudioTracks()[0]!;
    };
    const rms = async (track: MediaStreamTrack) => {
      const context = new AudioContext({ sampleRate: rate });
      await context.resume();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let sum = 0;
      let n = 0;
      const end = Date.now() + 2000;
      while (Date.now() < end) {
        analyser.getFloatTimeDomainData(samples);
        for (const x of samples) {
          sum += x * x;
          n++;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      void context.close();
      return Math.sqrt(sum / n);
    };
    const sounds: Record<string, (t: number) => number> = {
      hiss: () => (Math.random() * 2 - 1) * 0.1,
      clicks: (t) => ((t * 6) % 1 < 0.004 ? (Math.random() * 2 - 1) * 0.6 : 0),
    };
    const out: Record<string, { before: number; after: number }> = {};
    for (const [name, fill] of Object.entries(sounds)) {
      const track = source(fill);
      const before = await rms(track);
      const filter = await createMicProcessor(track, { noise: true, level: 100, gain: 100 });
      await new Promise((r) => setTimeout(r, 1500)); // the model needs a moment to settle
      out[name] = { before, after: await rms(filter.track) };
      filter.dispose();
    }
    return out;
  });
  console.log('rms before and after the filter:', JSON.stringify(result));
  expect(result.hiss!.after).toBeLessThan(result.hiss!.before * 0.1);
  expect(result.clicks!.after).toBeLessThan(result.clicks!.before * 0.2);
});
