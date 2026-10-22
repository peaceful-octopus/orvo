import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const MicIcon = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);

export const MicOffIcon = () => (
  <Icon>
    <path d="M9 9v2a3 3 0 0 0 5 2.2M15 10V6a3 3 0 0 0-5.9-.8" />
    <path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.5 2.6M12 18v3M3 3l18 18" />
  </Icon>
);

export const VideoIcon = () => (
  <Icon>
    <rect x="2" y="6" width="13" height="12" rx="2" />
    <path d="m15 10 6-3v10l-6-3" />
  </Icon>
);

export const VideoOffIcon = () => (
  <Icon>
    <path d="M15 11v-1l6-3v10M9 6h4a2 2 0 0 1 2 2v2M15 15v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2" />
    <path d="M3 3l18 18" />
  </Icon>
);

export const GifIcon = () => (
  <Icon>
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M9.5 10.5a2 2 0 1 0 0 3v-1.2H8.3M13 10v4M16 14v-4h2.5M16 12h2" />
  </Icon>
);

export const ExpandIcon = () => (
  <Icon>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
  </Icon>
);
