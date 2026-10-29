import { describe, expect, it } from 'vitest';
import { activityChime } from './activityChime';
import { emptyRoom, type ActivityRoom } from './activityRoom';

const running = (starter: string, instanceId = 'i1'): ActivityRoom => ({ presence: {}, current: { instanceId, activityId: 'snake', starter } });

describe('activityChime', () => {
  it('announces an activity someone else starts or ends', () => {
    expect(activityChime(emptyRoom(), running('ann'), 'me')).toBe('activity-start');
    expect(activityChime(running('ann'), emptyRoom(), 'me')).toBe('activity-end');
  });

  it('stays silent for what you start or end yourself', () => {
    expect(activityChime(emptyRoom(), running('me'), 'me')).toBeUndefined();
    expect(activityChime(running('me'), emptyRoom(), 'me')).toBeUndefined();
  });

  it('stays silent when nothing starts or ends, including when one start replaces another', () => {
    expect(activityChime(emptyRoom(), emptyRoom(), 'me')).toBeUndefined();
    expect(activityChime(running('ann', 'b'), running('bob', 'a'), 'me')).toBeUndefined();
    expect(activityChime({ ...running('ann'), presence: { bob: 'i1' } }, running('ann'), 'me')).toBeUndefined();
  });
});
