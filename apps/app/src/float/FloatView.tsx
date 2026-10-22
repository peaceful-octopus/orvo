import { BubbleField, type Member } from './BubbleField';
import { startWindowDrag } from './float';
import type { LayoutMode } from './layouts';

interface Props {
  members: Member[];
  mode: LayoutMode;
  audio: boolean;
  video: boolean;
  /** True when the window is an undecorated Tauri window that must be dragged by its content. */
  draggable: boolean;
  onToggleAudio(): void;
  onToggleVideo(): void;
  onReact(emoji: string): void;
  onExpand(): void;
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🎉'];

/** Compact bubbles-only view with hover controls, shown in the floating window. */
export function FloatView({ members, mode, audio, video, draggable, onToggleAudio, onToggleVideo, onReact, onExpand }: Props) {
  return (
    <div className="float-view" onMouseDown={draggable ? () => void startWindowDrag() : undefined}>
      <BubbleField members={members} mode={mode} />
      <div className="float-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button onClick={onToggleAudio} title={audio ? 'Mute' : 'Unmute'}>
          {audio ? 'Mute' : 'Unmute'}
        </button>
        <button onClick={onToggleVideo} title={video ? 'Camera off' : 'Camera on'}>
          {video ? 'Cam off' : 'Cam on'}
        </button>
        {QUICK_REACTIONS.map((emoji) => (
          <button key={emoji} disabled={!video} aria-label={`React with ${emoji}`} onClick={() => onReact(emoji)}>
            {emoji}
          </button>
        ))}
        <button onClick={onExpand} title="Back to full window">
          Expand
        </button>
      </div>
    </div>
  );
}
