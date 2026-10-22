import { ExpandIcon, GifIcon, LeaveIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from './icons';

import type { MenuKind } from '../DeviceMenu';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉'];

interface Props {
  audio: boolean;
  video: boolean;
  onToggleAudio(): void;
  onToggleVideo(): void;
  onReact(emoji: string): void;
  onExpand(): void;
  onLeave(): void;
  /** Present only when GIFs are set up. */
  onGif?: () => void;
  /** Present when device choices can be shown; adds an arrow beside the microphone and camera buttons. */
  onDeviceMenu?: (menu: MenuKind) => void;
  openMenu?: MenuKind | null;
}

/** The floating view's control strip: icon buttons plus quick reactions. */
export function ControlButtons({ audio, video, onToggleAudio, onToggleVideo, onReact, onExpand, onLeave, onGif, onDeviceMenu, openMenu }: Props) {
  const chevron = (menu: MenuKind, label: string) => (
    <button className="chevron" aria-label={label} aria-haspopup="menu" aria-expanded={openMenu === menu} title={label} onClick={() => onDeviceMenu?.(menu)}>
      ▾
    </button>
  );
  const needsCamera = video ? undefined : 'Turn your camera on to use reactions';
  return (
    <div className="float-controls" role="toolbar" aria-label="Call controls">
      <div className="split">
        <button className="icon" onClick={onToggleAudio} aria-label={audio ? 'Mute' : 'Unmute'} title={audio ? 'Mute' : 'Unmute'}>
          {audio ? <MicIcon /> : <MicOffIcon />}
        </button>
        {onDeviceMenu && chevron('mic', 'Microphone options')}
      </div>
      <div className="split">
        <button className="icon" onClick={onToggleVideo} aria-label={video ? 'Camera off' : 'Camera on'} title={video ? 'Camera off' : 'Camera on'}>
          {video ? <VideoIcon /> : <VideoOffIcon />}
        </button>
        {onDeviceMenu && chevron('cam', 'Camera options')}
      </div>
      <span className="sep" />
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} className="icon emoji" disabled={!video} title={needsCamera} aria-label={`React with ${emoji}`} onClick={() => onReact(emoji)}>
          {emoji}
        </button>
      ))}
      {onGif && (
        <button className="icon" disabled={!video} onClick={onGif} aria-label="GIF" title={needsCamera ?? 'Show a GIF on your video'}>
          <GifIcon />
        </button>
      )}
      <span className="sep" />
      <button className="icon" onClick={onExpand} aria-label="Expand" title="Back to full window">
        <ExpandIcon />
      </button>
      <button className="icon leave" onClick={onLeave} aria-label="Leave" title="Leave the call">
        <LeaveIcon />
      </button>
    </div>
  );
}
