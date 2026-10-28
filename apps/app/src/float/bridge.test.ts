import { describe, expect, it } from 'vitest';
import { placeBeside, placeControls } from './bridge';

const monitor = { x: 0, y: 0, w: 1920, h: 1080 };
const size = { w: 400, h: 60 };

describe('placeControls', () => {
  it('centers under the bubble window', () => {
    const p = placeControls({ x: 500, y: 300, w: 200, h: 200 }, size, monitor, 4);
    expect(p).toEqual({ x: 400, y: 504, above: false });
  });

  it('moves above when there is no room below', () => {
    const p = placeControls({ x: 500, y: 900, w: 200, h: 170 }, size, monitor, 4);
    expect(p).toEqual({ x: 400, y: 836, above: true });
  });

  it('stays on the monitor horizontally', () => {
    expect(placeControls({ x: 0, y: 100, w: 100, h: 100 }, size, monitor, 4).x).toBe(0);
    expect(placeControls({ x: 1850, y: 100, w: 70, h: 100 }, size, monitor, 4).x).toBe(1520);
  });

  it('stays below when above would leave the monitor too', () => {
    const p = placeControls({ x: 0, y: 20, w: 100, h: 1040 }, size, monitor, 4);
    expect(p.above).toBe(false);
  });

  it('overlaps the bubbles rather than leaving the monitor when neither side has room', () => {
    const p = placeControls({ x: 0, y: 20, w: 100, h: 1040 }, size, monitor, 4);
    expect(p.y + size.h).toBeLessThanOrEqual(monitor.h);
  });
});

describe('placeBeside', () => {
  const pane = { w: 420, h: 360 };

  it('goes to the right of the bubble window, level with its top', () => {
    expect(placeBeside({ x: 500, y: 300, w: 200, h: 200 }, pane, monitor, 8)).toEqual({ x: 708, y: 300 });
  });

  it('goes to the left when the right is off the monitor', () => {
    expect(placeBeside({ x: 1600, y: 300, w: 200, h: 200 }, pane, monitor, 8)).toEqual({ x: 1172, y: 300 });
  });

  it('stays on the monitor vertically' , () => {
    expect(placeBeside({ x: 500, y: 900, w: 200, h: 200 }, pane, monitor, 8).y).toBe(720);
  });

  it('stays on the monitor when there is no room on either side', () => {
    const p = placeBeside({ x: 100, y: 0, w: 1700, h: 200 }, pane, monitor, 8);
    expect(p.x + pane.w).toBeLessThanOrEqual(monitor.w);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
});
