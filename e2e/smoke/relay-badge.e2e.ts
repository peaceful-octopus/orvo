import { expect, test } from '@playwright/test';
import { expectAllConnected, joinRoom } from '../helpers';

// A local test has no relay server, so the connection statistics are made to say the selected path is relayed.
const REPORT_RELAYED = () => {
  RTCPeerConnection.prototype.getStats = async function () {
    return new Map<string, Record<string, unknown>>([
      ['t', { type: 'transport', selectedCandidatePairId: 'p' }],
      ['p', { type: 'candidate-pair', localCandidateId: 'l', remoteCandidateId: 'r' }],
      ['l', { type: 'local-candidate', candidateType: 'relay' }],
      ['r', { type: 'remote-candidate', candidateType: 'host' }],
    ]) as unknown as RTCStatsReport;
  };
};

test('a small emoji marks the people you are connected to through a relay @smoke', async ({ browser }) => {
  const room = `e2e-relay-badge-${Date.now()}`;
  const relayed = await browser.newContext();
  await relayed.addInitScript(REPORT_RELAYED);
  const direct = await browser.newContext();
  try {
    const ann = await joinRoom(relayed, room, 'ann');
    const bob = await joinRoom(direct, room, 'bob');
    await expectAllConnected([ann, bob]);

    // Ann's connection to bob is relayed, so she sees the badge on bob's bubble, and never on her own.
    const onBob = ann.locator('.bubble', { hasText: 'bob' });
    await expect(onBob.locator('.relay-badge')).toBeVisible();
    await expect(onBob.getByRole('img', { name: 'Connected through a relay' })).toHaveAttribute('title', 'Connected through a relay');
    await expect(ann.locator('.bubble', { hasText: 'ann' }).locator('.relay-badge')).toHaveCount(0);
    // Bob's own statistics are real, so his path to ann is direct and shows no badge.
    await expect(bob.locator('.relay-badge')).toHaveCount(0);
  } finally {
    await relayed.close();
    await direct.close();
  }
});
