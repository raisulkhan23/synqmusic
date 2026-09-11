import { useEffect } from "react";

/** Single shared <audio> element for catalog playback. */
export function getAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
    // SSR safety — never actually used in this app, but keeps imports honest.
    return new Audio();
  }
  const w = window as unknown as { __ssAudio?: HTMLAudioElement };
  if (!w.__ssAudio) {
    w.__ssAudio = new Audio();
    w.__ssAudio.preload = "auto";
  }
  return w.__ssAudio;
}

/** Keep the audio element's playback rate in sync (call from an effect). */
export function useAudioRate(rate: number): void {
  useEffect(() => {
    getAudio().playbackRate = rate;
  }, [rate]);
}

// --- visualizer support -------------------------------------------------------

let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let source: MediaElementAudioSourceNode | null = null;

/**
 * Lazily create the shared analyser for the audio element. Must be called
 * from a user-gesture context the first time (browsers block suspended
 * AudioContexts otherwise). YouTube playback isn't analyser-tappable, so the
 * visualizer falls back to simulated bars in that case.
 */
export function ensureAnalyser(): AnalyserNode | null {
  try {
    if (analyser) return analyser;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    audioCtx = audioCtx ?? new AudioCtx();
    source = audioCtx.createMediaElementSource(getAudio());
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return analyser;
  } catch {
    return null;
  }
}

/** Copy the current frequency magnitudes into `out` (0-255 per bin). */
export function readFrequencyData(node: AnalyserNode, out: Uint8Array): void {
  node.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
}
