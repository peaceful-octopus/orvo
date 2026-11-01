import { useEffect, useRef } from 'react';
import { Avatar } from './Avatar';
import { useCall } from './callStore';
import { COPY } from './copy';
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

/** Frames of the new stream to wait for before the held picture goes away, the longest to wait, and the wait without frame callbacks. */
const HOLD_FRAMES = 3;
const HOLD_MAX_MS = 1000;
const HOLD_FALLBACK_MS = 250;

/** A circular video that fills its parent; the parent sets the diameter. */
export function Bubble({ name, stream, videoOn, audioOn, mirrored, muteAudio, unreachable, route }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const holdRef = useRef<HTMLCanvasElement>(null);
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
    const next = stream ?? null;
    if (!video || video.srcObject === next) return;
    // A video given a new stream shows nothing, then a black frame, before its first real picture. Keep the last picture
    // on screen over it until a few real frames have arrived.
    const hold = holdRef.current;
    let release: (() => void) | undefined;
    if (hold && video.srcObject && video.videoWidth && next) {
      hold.width = video.videoWidth;
      hold.height = video.videoHeight;
      hold.getContext('2d')?.drawImage(video, 0, 0);
      hold.style.visibility = 'visible';
      const done = () => (hold.style.visibility = 'hidden');
      const timer = setTimeout(done, HOLD_MAX_MS);
      let frames = 0;
      const onFrame = () => {
        if (++frames < HOLD_FRAMES) video.requestVideoFrameCallback(onFrame);
        else done();
      };
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame);
      else setTimeout(done, HOLD_FALLBACK_MS);
      release = () => {
        clearTimeout(timer);
        done();
      };
    }
    video.srcObject = next;
    return release;
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
      <canvas ref={holdRef} className={`hold${mirrored ? ' mirrored' : ''}`} aria-hidden="true" />
      {!videoOn && <Avatar seed={name || 'Guest'} />}
      <figcaption>
        {name || 'Guest'}
        {route === 'relay' && (
          <span className="relay-badge" role="img" aria-label={COPY.relayed} title={COPY.relayed}>
            📡
          </span>
        )}
        {!audioOn && ' (muted)'}
        {unreachable && " (can't connect)"}
      </figcaption>
    </figure>
  );
}
