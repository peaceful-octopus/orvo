import { useEffect, useRef } from 'react';

interface Props {
  name: string;
  stream?: MediaStream;
  videoOn: boolean;
  audioOn: boolean;
  mirrored?: boolean;
  muteAudio?: boolean;
}

export function Bubble({ name, stream, videoOn, audioOn, mirrored, muteAudio }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream ?? null;
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
      </figcaption>
    </figure>
  );
}
