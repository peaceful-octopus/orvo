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

export const LeaveIcon = () => (
  <Icon>
    <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M15 8l4 4-4 4M19 12H9" />
  </Icon>
);

export const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const RowIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="3" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="19" cy="12" r="3" />
  </Icon>
);

export const ColumnIcon = () => (
  <Icon>
    <circle cx="12" cy="5" r="3" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="19" r="3" />
  </Icon>
);

export const CampfireIcon = () => (
  <Icon>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="19" cy="12" r="2.5" />
    <circle cx="12" cy="19" r="2.5" />
    <circle cx="5" cy="12" r="2.5" />
  </Icon>
);

export const FloatIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="15" cy="14" r="3" />
  </Icon>
);

export const DockIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18" />
  </Icon>
);

export const LinkIcon = () => (
  <Icon>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);
