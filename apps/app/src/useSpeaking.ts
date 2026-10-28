import { useEffect, useState } from 'react';
import { levelOf, SpeakingGate } from './speaking';

const POLL_MS = 80;

let context: AudioContext | undefined;
/** One audio context serves every bubble; it is made on first use, when the person has already interacted with the page. */
function sharedContext(): AudioContext | undefined {
  if (context) return context;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return undefined;
  context = new Ctor();
  return context;
}

/**
 * Whether the person whose audio is in `stream` is speaking now. It listens to the stream without playing it a second
 * time. Pass `active` false (for instance while muted) to report silence.
 */
export function useSpeaking(stream: MediaStream | undefined, active: boolean): boolean {
  const [speaking, setSpeaking] = useState(false);
  // The audio track can arrive after the stream does.
  const [tracks, setTracks] = useState(0);

  useEffect(() => {
    if (!stream) return;
    const refresh = () => setTracks(stream.getAudioTracks().length);
    refresh();
    stream.addEventListener('addtrack', refresh);
    stream.addEventListener('removetrack', refresh);
    return () => {
      stream.removeEventListener('addtrack', refresh);
      stream.removeEventListener('removetrack', refresh);
    };
  }, [stream]);

  useEffect(() => {
    const audio = stream?.getAudioTracks()[0];
    const ctx = sharedContext();
    if (!active || !stream || !audio || !ctx) {
      setSpeaking(false);
      return;
    }
    void ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([audio]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser); // not to the speakers: the bubble's video element already plays the sound
    const samples = new Uint8Array(analyser.fftSize);
    const gate = new SpeakingGate();
    const timer = setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      setSpeaking(gate.push(levelOf(samples), performance.now()));
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      source.disconnect();
      analyser.disconnect();
      setSpeaking(false);
    };
  }, [stream, active, tracks]);

  return speaking;
}
