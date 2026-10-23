import {
  Check,
  ChevronDown,
  DoorClosed,
  DoorOpen,
  LogOut,
  Link,
  Lock,
  LockOpen,
  Maximize2,
  Mic,
  MicOff,
  PanelTop,
  PictureInPicture2,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Sparkles,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** Lucide icons at the one size and weight used across the app. */
const SIZE = 20;
const STROKE = 2;

export const MicIcon = () => <Mic size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const MicOffIcon = () => <MicOff size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const VideoIcon = () => <Video size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const VideoOffIcon = () => <VideoOff size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const ExpandIcon = () => <Maximize2 size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const LeaveIcon = () => <LogOut size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const ChevronIcon = () => <ChevronDown size={14} strokeWidth={3} aria-hidden />;
export const GearIcon = () => <Settings size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const LinkIcon = () => <Link size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const LockIcon = () => <Lock size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const LockOpenIcon = () => <LockOpen size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const DoorClosedIcon = () => <DoorClosed size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const DoorOpenIcon = () => <DoorOpen size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const RemoveIcon = () => <X size={16} strokeWidth={3} aria-hidden />;
export const CheckIcon = () => <Check size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const ScreenShareIcon = () => <ScreenShare size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const ScreenShareOffIcon = () => <ScreenShareOff size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const SparklesIcon = () => <Sparkles size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const FloatIcon = () => <PictureInPicture2 size={SIZE} strokeWidth={STROKE} aria-hidden />;
export const DockIcon = () => <PanelTop size={SIZE} strokeWidth={STROKE} aria-hidden />;

/** Icons Lucide does not have, drawn on the same 24-unit grid with the same stroke. */
function Custom({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={SIZE}
      height={SIZE}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const GifIcon = () => (
  <Custom>
    <rect x="2" y="5" width="20" height="14" rx="3" />
    <path d="M9.5 10.5a2 2 0 1 0 0 3v-1.2H8.3M13 10v4M16 14v-4h2.5M16 12h2" />
  </Custom>
);

/** The three layouts, drawn as the bubbles they arrange. */
export const RowIcon = () => (
  <Custom>
    <circle cx="5" cy="12" r="3" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="19" cy="12" r="3" />
  </Custom>
);

export const ColumnIcon = () => (
  <Custom>
    <circle cx="12" cy="5" r="3" />
    <circle cx="12" cy="12" r="3" />
    <circle cx="12" cy="19" r="3" />
  </Custom>
);

export const CampfireIcon = () => (
  <Custom>
    <circle cx="12" cy="5" r="2.5" />
    <circle cx="19" cy="12" r="2.5" />
    <circle cx="12" cy="19" r="2.5" />
    <circle cx="5" cy="12" r="2.5" />
  </Custom>
);
