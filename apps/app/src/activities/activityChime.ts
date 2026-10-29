import type { ChimeKind } from '../chime';
import type { ActivityRoom } from './activityRoom';

/**
 * The chime that goes with a change in the running activity, if any. Activities you start or end yourself are silent,
 * since you just did it; an activity replaced by another one in a simultaneous start is not announced either.
 */
export function activityChime(before: ActivityRoom, after: ActivityRoom, selfId: string | undefined): Extract<ChimeKind, 'activity-start' | 'activity-end'> | undefined {
  const was = before.current;
  const now = after.current;
  if (!was && now) return now.starter === selfId ? undefined : 'activity-start';
  if (was && !now) return was.starter === selfId ? undefined : 'activity-end';
  return undefined;
}
