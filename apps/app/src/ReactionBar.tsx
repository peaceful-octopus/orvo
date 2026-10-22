import { GifIcon } from './float/icons';

export const REACTION_EMOJI = ['👍', '❤️', '😂', '😮', '🎉', '👏'] as const;

interface Props {
  /** Reactions are drawn on your video, so they need the camera on. */
  disabled: boolean;
  onReact(emoji: string): void;
  /** Present only when GIFs are set up (a Giphy key is available). */
  onGif?: () => void;
}

export function ReactionBar({ disabled, onReact, onGif }: Props) {
  const hint = disabled ? 'Turn your camera on to use reactions' : undefined;
  return (
    <div className="reactions" role="group" aria-label="Reactions">
      {REACTION_EMOJI.map((emoji) => (
        <button key={emoji} className="icon emoji" disabled={disabled} title={hint} aria-label={`React with ${emoji}`} onClick={() => onReact(emoji)}>
          {emoji}
        </button>
      ))}
      {onGif && (
        <button className="icon" disabled={disabled} title={hint ?? 'Show a GIF on your video'} aria-label="GIF" onClick={onGif}>
          <GifIcon />
        </button>
      )}
    </div>
  );
}
