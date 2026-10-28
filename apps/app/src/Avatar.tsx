import { useId, useMemo } from 'react';
import { avatarColors } from './theme/avatar';
import { useCurrentTheme } from './theme/theme';

/** The picture shown in a bubble while the camera is off: a head and shoulders on a colour chosen from the name and palette. */
export function Avatar({ seed }: { seed: string }) {
  const { tokens, mode } = useCurrentTheme();
  const { from, to, figure } = useMemo(() => avatarColors(seed, tokens, mode), [seed, tokens, mode]);
  const gradient = `avatar-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg className="avatar" viewBox="0 0 640 480" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      <rect width="640" height="480" fill={`url(#${gradient})`} />
      <g fill={figure} opacity="0.88">
        <circle cx="320" cy="200" r="74" />
        <ellipse cx="320" cy="420" rx="150" ry="120" />
      </g>
    </svg>
  );
}
