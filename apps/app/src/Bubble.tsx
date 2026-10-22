import { useEffect, useRef } from 'react';

interface Props {
  name: string;
  stream?: MediaStream;
  videoOn: boolean;
  audioOn: boolean;
  mirrored?: boolean;
  muteAudio?: boolean;
  /** The direct connection to this person failed, usually because their network blocks it. */
  unreachable?: boolean;
}

/** A circular video that fills its parent; the parent sets the diameter. */
export function Bubble({ name, stream, videoOn, audioOn, mirrored, muteAudio, unreachable }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (video && video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null;
  }, [stream]);

  return (
    <figure className="bubble">
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muteAudio}
        className={mirrored ? 'mirrored' : undefined}
        style={{ visibility: videoOn ? 'visible' : 'hidden' }}
      />
      {!videoOn && <span className="initial">{name.slice(0, 1).toUpperCase() || '?'}</span>}
      <figcaption>
        {name || 'Guest'}
        {!audioOn && ' (muted)'}
        {unreachable && " (can't connect)"}
      </figcaption>
    </figure>
  );
}
