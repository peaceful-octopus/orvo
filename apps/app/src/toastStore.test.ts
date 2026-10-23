import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TOASTS, toast, useToasts } from './toastStore';

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.setState({ toasts: [] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('shows a message and removes it after a while', () => {
    toast.error('Camera failed');
    expect(useToasts.getState().toasts).toMatchObject([{ kind: 'error', text: 'Camera failed' }]);
    vi.advanceTimersByTime(7001);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('keeps errors up longer than information', () => {
    toast.info('Heads up');
    toast.error('Broken');
    vi.advanceTimersByTime(5001);
    expect(useToasts.getState().toasts.map((t) => t.text)).toEqual(['Broken']);
  });

  it('refreshes a repeated message instead of stacking copies', () => {
    toast.error('Same');
    vi.advanceTimersByTime(5000);
    toast.error('Same');
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(5000); // the first timer would have fired by now
    expect(useToasts.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2100);
    expect(useToasts.getState().toasts).toEqual([]);
  });

  it('shows at most a few at once, dropping the oldest', () => {
    for (let i = 1; i <= MAX_TOASTS + 2; i++) toast.error(`Problem ${i}`);
    const texts = useToasts.getState().toasts.map((t) => t.text);
    expect(texts).toHaveLength(MAX_TOASTS);
    expect(texts[texts.length - 1]).toBe(`Problem ${MAX_TOASTS + 2}`);
    expect(texts).not.toContain('Problem 1');
  });

  it('can be dismissed by hand', () => {
    toast.error('Gone soon');
    useToasts.getState().dismiss(useToasts.getState().toasts[0]!.id);
    expect(useToasts.getState().toasts).toEqual([]);
  });
});
