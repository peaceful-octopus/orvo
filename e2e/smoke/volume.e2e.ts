import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

test('the speaker slider sets the volume of other people, and the microphone slider processes what is sent @smoke', async ({ context }) => {
  const room = `e2e-volume-${Date.now()}`;
  const [ann, bob] = [await joinRoom(context, room, 'ann'), await joinRoom(context, room, 'bob')];
  await expectAllConnected([ann, bob]);

  const remoteVolume = () => ann.locator('.bubble video').nth(1).evaluate((v) => (v as HTMLVideoElement).volume);
  const ownVolume = () => ann.locator('.bubble video').first().evaluate((v) => (v as HTMLVideoElement).volume);
  expect(await remoteVolume()).toBe(1);

  await ann.getByRole('button', { name: 'Settings' }).click();
  const dialog = ann.getByRole('dialog', { name: 'Settings' });
  await dialog.getByLabel('Speaker volume').fill('35');
  await expect(dialog.getByLabel('Speaker volume')).toHaveValue('35');
  await expect.poll(remoteVolume).toBeCloseTo(0.35, 2);
  expect(await ownVolume()).toBe(1); // your own preview is muted regardless, and is not scaled

  // Turn the noise filter off so only the volume stage is in the path, then change the microphone volume.
  await dialog.getByLabel('Reduce background noise and typing sounds').uncheck();
  const sentLabel = () =>
    ann.locator('.bubble video').first().evaluate((v) => ((v as HTMLVideoElement).srcObject as MediaStream).getAudioTracks()[0]?.label);
  await expect.poll(sentLabel).not.toBe('MediaStreamAudioDestinationNode'); // raw microphone at 100%
  await dialog.getByLabel('Microphone volume').fill('150');
  await expect.poll(sentLabel).toBe('MediaStreamAudioDestinationNode');
  await dialog.getByLabel('Microphone volume').fill('100');
  await expect.poll(sentLabel).not.toBe('MediaStreamAudioDestinationNode'); // back to the plain microphone

  await expectAllConnected([ann, bob]);
});

test('the microphone volume stage scales the level that is sent @smoke', async ({ page }) => {
  test.skip(Boolean(process.env.E2E_BASE_URL), 'imports the source modules, so it needs the development server');
  await page.goto('/');
  const levels = await page.evaluate(async () => {
    const { createMicProcessor } = await import('/src/noise.ts');
    const rate = 48000;
    const context = new AudioContext({ sampleRate: rate });
    const destination = context.createMediaStreamDestination();
    const buffer = context.createBuffer(1, rate, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < rate; i++) data[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / rate);
    const tone = context.createBufferSource();
    tone.buffer = buffer;
    tone.loop = true;
    tone.connect(destination);
    tone.start();
    const track = destination.stream.getAudioTracks()[0]!;

    const rms = async (t: MediaStreamTrack) => {
      const ctx = new AudioContext({ sampleRate: rate });
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      ctx.createMediaStreamSource(new MediaStream([t])).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let sum = 0;
      let n = 0;
      const end = Date.now() + 1200;
      while (Date.now() < end) {
        analyser.getFloatTimeDomainData(samples);
        for (const x of samples) {
          sum += x * x;
          n++;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      void ctx.close();
      return Math.sqrt(sum / n);
    };

    const processor = await createMicProcessor(track, { noise: false, level: 0, gain: 100 });
    const out: Record<string, number> = { unity: await rms(processor.track) };
    processor.setGain(50);
    await new Promise((r) => setTimeout(r, 200));
    out.half = await rms(processor.track);
    processor.setGain(200);
    await new Promise((r) => setTimeout(r, 200));
    out.double = await rms(processor.track);
    processor.setGain(0);
    await new Promise((r) => setTimeout(r, 200));
    out.silent = await rms(processor.track);
    processor.dispose();
    return out;
  });
  console.log('rms at 100%, 50%, 200%, 0%:', JSON.stringify(levels));
  expect(levels.half! / levels.unity!).toBeCloseTo(0.5, 1);
  expect(levels.double! / levels.unity!).toBeCloseTo(2, 1);
  expect(levels.silent).toBeLessThan(0.001);
});
