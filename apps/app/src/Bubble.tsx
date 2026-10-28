import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { useCall } from './callStore';
import { useSettings } from './settingsStore';
import { useSpeaking } from './useSpeaking';

interface Props {
  name: string;
  stream?: MediaStream;
  videoOn: boolean;
  audioOn: boolean;
  mirrored?: boolean;
  muteAudio?: boolean;
  /** The direct connection to this person failed, usually because their network blocks it. */
  unreachable?: boolean;
  /** How the connection to this person is routed; exposed for tests and styling. */
  route?: string;
}

/** A circular video that fills its parent; the parent sets the diameter. */
export function Bubble({ name, stream, videoOn, audioOn, mirrored, muteAudio, unreachable, route }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const speaker = useCall((s) => s.selected.audiooutput);
  const speakerVolume = useSettings((s) => s.speakerVolume);
  const speaking = useSpeaking(stream, audioOn);

  // Other people's audio plays through the chosen speaker where the browser allows choosing one.
  useEffect(() => {
    const video = ref.current as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!muteAudio) void video?.setSinkId?.(speaker).catch(() => {});
  }, [speaker, muteAudio]);

  useEffect(() => {
    if (ref.current && !muteAudio) ref.current.volume = speakerVolume / 100;
  }, [speakerVolume, muteAudio, stream]);

  useEffect(() => {
    const video = ref.current;
    if (video && video.srcObject !== (stream ?? null)) video.srcObject = stream ?? null;
  }, [stream]);

  return (
    <figure className="bubble" data-route={route} data-speaking={speaking}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muteAudio}
        className={mirrored ? 'mirrored' : undefined}
        style={{ visibility: videoOn ? 'visible' : 'hidden' }}
      />
      {!videoOn && <Avatar seed={name || 'Guest'} />}
      <figcaption>
        {name || 'Guest'}
        {!audioOn && ' (muted)'}
        {unreachable && " (can't connect)"}
      </figcaption>
    </figure>
  );
}
