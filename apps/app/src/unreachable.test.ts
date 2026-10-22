import { describe, expect, it } from 'vitest';
import { unreachableNotice } from './unreachable';

describe('unreachableNotice', () => {
  it('is empty when everyone is reachable', () => {
    expect(unreachableNotice([])).toBeUndefined();
  });

  it('names one, two or several people', () => {
    expect(unreachableNotice(['Ann'])).toContain("Can't connect to Ann.");
    expect(unreachableNotice(['Ann', 'Bo'])).toContain("Can't connect to Ann and Bo.");
    expect(unreachableNotice(['Ann', 'Bo', 'Cy'])).toContain("Can't connect to Ann, Bo and Cy.");
  });

  it('copes with people who have no name yet', () => {
    expect(unreachableNotice([' '])).toContain("Can't connect to a guest.");
  });

  it('suggests a way forward', () => {
    expect(unreachableNotice(['Ann'])).toContain('different network');
  });
});
