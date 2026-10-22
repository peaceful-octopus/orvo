import { describe, expect, it } from 'vitest';
import { MOOD_FILTERS, drawFiltered, findFilter, gradientLine, type FilterContext } from './filters';

function recorder() {
  const calls: string[] = [];
  const gradient = { addColorStop: (at: number, c: string) => calls.push(`stop ${at} ${c}`) };
  const ctx = {
    filter: 'none',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillRect: () => calls.push(`fill blend=${ctx.globalCompositeOperation} alpha=${ctx.globalAlpha}`),
    createLinearGradient: () => (calls.push('linear'), gradient),
    createRadialGradient: () => (calls.push('radial'), gradient),
  } as unknown as FilterContext & { filter: string };
  return { ctx, calls };
}

describe('gradientLine', () => {
  it('runs top to bottom at 180 degrees and spans the picture', () => {
    const l = gradientLine(180, 640, 480);
    expect(l.x0).toBeCloseTo(320);
    expect(l.x1).toBeCloseTo(320);
    expect(l.y0).toBeCloseTo(0);
    expect(l.y1).toBeCloseTo(480);
  });

  it('runs left to right at 90 degrees', () => {
    const l = gradientLine(90, 640, 480);
    expect(l.x0).toBeCloseTo(0);
    expect(l.x1).toBeCloseTo(640);
    expect(l.y0).toBeCloseTo(240);
  });

  it('reaches both corners at 135 degrees', () => {
    const l = gradientLine(135, 640, 480);
    expect(l.x1 - l.x0).toBeGreaterThan(0);
    expect(l.y1 - l.y0).toBeGreaterThan(0);
  });
});

describe('drawFiltered', () => {
  it('only draws the camera when there is no filter', () => {
    const { ctx, calls } = recorder();
    drawFiltered(ctx, undefined, 640, 480, () => calls.push('camera'));
    expect(calls).toEqual(['camera']);
  });

  it('grades the camera, then removes the grading before the overlays', () => {
    const { ctx, calls } = recorder();
    let during = '';
    drawFiltered(ctx, findFilter('sunset'), 640, 480, () => (during = ctx.filter));
    expect(during).toBe(findFilter('sunset')!.css);
    expect(ctx.filter).toBe('none');
    expect(calls).toContain('linear');
    expect(calls).toContain('fill blend=soft-light alpha=0.9');
  });

  it('adds a vignette to filters that have one, and nothing else for a plain grade', () => {
    const noir = recorder();
    drawFiltered(noir.ctx, findFilter('noir'), 640, 480, () => {});
    expect(noir.calls).toContain('radial');
    expect(noir.calls).not.toContain('linear');

    const vivid = recorder();
    drawFiltered(vivid.ctx, findFilter('vivid'), 640, 480, () => {});
    expect(vivid.calls).toEqual([]);
  });

  it('still draws the camera and overlays where colour grading is unsupported', () => {
    const { ctx, calls } = recorder();
    delete (ctx as { filter?: string }).filter;
    drawFiltered(ctx, findFilter('neon'), 640, 480, () => calls.push('camera'));
    expect(calls[0]).toBe('camera');
    expect(calls).toContain('linear');
  });
});

describe('MOOD_FILTERS', () => {
  it('has unique ids and a label and swatch for each', () => {
    expect(new Set(MOOD_FILTERS.map((f) => f.id)).size).toBe(MOOD_FILTERS.length);
    for (const f of MOOD_FILTERS) {
      expect(f.label).not.toBe('');
      expect(f.swatch).toHaveLength(2);
    }
  });
});
