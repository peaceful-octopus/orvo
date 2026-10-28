import { ACTIVITY_API_VERSION } from '@orvo/protocol';
import { useMemo } from 'react';
import { useCall } from '../callStore';
import { useConfig } from '../configStore';
import type { ActivityOption, RunningActivity } from './ActivityPanel';
import { openActivityInstance, useActivity } from './activityStore';

/** What the Play menu shows: the activities this client can run, and the one running in the call, if any. */
export function useActivitySummary(): { options: ActivityOption[]; running?: RunningActivity } {
  const manifests = useConfig((s) => s.config.activities);
  const current = useActivity((s) => s.room.current);
  const selfId = useActivity((s) => s.selfId);
  const opened = useActivity(openActivityInstance) !== undefined;
  const starterName = useCall((s) => (current ? s.remotes[current.starter]?.name : undefined));

  const options = useMemo<ActivityOption[]>(
    () =>
      (manifests ?? [])
        .filter((m) => m.apiVersion === ACTIVITY_API_VERSION)
        .map((m) => ({ id: m.id, name: m.name, description: m.description, icon: m.icon })),
    [manifests],
  );
  const name = current ? (options.find((m) => m.id === current.activityId)?.name ?? null) : null;
  const mine = current?.starter === selfId;
  const running = useMemo<RunningActivity | undefined>(
    () => (current ? { name, starter: mine ? null : starterName || 'Guest', opened } : undefined),
    [Boolean(current), name, mine, starterName, opened],
  );
  return { options, running };
}
