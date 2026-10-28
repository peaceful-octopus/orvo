import { BubbleField, type Member } from './BubbleField';
import { ControlButtons } from './ControlButtons';
import { startWindowDrag } from './float';
import { UNCAPPED, type LayoutMode } from './layouts';

interface Props {
  members: Member[];
  mode: LayoutMode;
  /** True when the window is an undecorated Tauri window that must be dragged by its content. */
  draggable: boolean;
  /** The pointer is over the floating window or its controls: show the translucent backdrop. */
  hot?: boolean;
  /** Controls drawn inside this window. Omitted when they live in their own window. */
  inlineControls?: {
    audio: boolean;
    video: boolean;
    onToggleAudio(): void;
    onToggleVideo(): void;
    onReact(emoji: string): void;
    onExpand(): void;
    onLeave(): void;
    onGif?: () => void;
  };
}

/** Bubbles-only view shown in the floating window; the bubbles grow with the window. */
export function FloatView({ members, mode, draggable, hot, inlineControls }: Props) {
  return (
    <div
      className={`float-view${hot ? ' hot' : ''}${inlineControls ? ' inline-controls' : ''}`}
      onMouseDown={draggable ? () => void startWindowDrag() : undefined}
    >
      <BubbleField members={members} mode={mode} maxSize={UNCAPPED} adaptive />
      {inlineControls && (
        <div onMouseDown={(e) => e.stopPropagation()}>
          <ControlButtons {...inlineControls} />
        </div>
      )}
    </div>
  );
}
