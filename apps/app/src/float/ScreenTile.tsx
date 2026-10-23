import { useEffect, useRef } from 'react';

interface Props {
  /** Whose screen it is. */
  name: string;
  /** The picture, or undefined for your own screen, which is not shown back to you. */
  stream?: MediaStream;
  self?: boolean;
  onStop?: () => void;
}

/** A shared screen, as a rounded rectangle. Your own is a note with a stop button, so you do not see a mirror of yourself. */
export function ScreenTile({ name, stream, self, onStop }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video && video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null;
  }, [stream]);

  return (
    <figure className="screen-tile" data-self={self ? 'true' : undefined}>
      {self ? (
        <div className="screen-self">
          <p>You are sharing your screen.</p>
          <button className="primary" onClick={onStop}>
            Stop sharing
          </button>
        </div>
      ) : (
        <video ref={ref} autoPlay playsInline muted />
      )}
      <figcaption>{self ? 'Your screen' : `${name || 'Guest'}'s screen`}</figcaption>
    </figure>
  );
}
