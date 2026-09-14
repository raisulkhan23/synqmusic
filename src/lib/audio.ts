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
    w.__ssAudio.crossOrigin = "anonymous";
  }
  return w.__ssAudio;
}

/** Keep the audio element's playback rate in sync (call from an effect). */
export function useAudioRate(rate: number): void {
  useEffect(() => {
    getAudio().playbackRate = rate;
  }, [rate]);
}

// --- audio filter chain -------------------------------------------------------

export type AudioFilterId = "off" | "8d" | "bass" | "vocal" | "night";

export const AUDIO_FILTERS: { id: AudioFilterId; label: string; icon: string; description: string }[] = [
  { id: "off", label: "None", icon: "🎵", description: "Original mix" },
  { id: "8d", label: "8D Audio", icon: "🌀", description: "Surround-style rotating effect" },
  { id: "bass", label: "Bass Boost", icon: "🔊", description: "Extra low-end punch" },
  { id: "vocal", label: "Vocal Boost", icon: "🎤", description: "Emphasizes voices" },
  { id: "night", label: "Night Mode", icon: "🌙", description: "Soft, quiet-friendly EQ" },
];

let audioCtx: AudioContext | null = null;
let filterSource: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;

// Filter graph nodes (created lazily alongside the context)
let bassFilter: BiquadFilterNode | null = null;
let vocalFilter: BiquadFilterNode | null = null;
let nightLow: BiquadFilterNode | null = null;
let panner: StereoPannerNode | null = null;
let gainOut: GainNode | null = null;

let activeFilter: AudioFilterId = "off";
let rotateRaf = 0;

/**
 * Lazily create the shared audio graph:
 *   <audio> → [biquad EQ nodes] → panner → analyser → destination
 * Must be called from a user-gesture context the first time (browsers block
 * suspended AudioContexts otherwise). YouTube playback isn't tappable here, so
 * filters apply to catalog tracks only.
 */
function ensureGraph(): boolean {
  try {
    if (audioCtx && filterSource) return true;
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    audioCtx = audioCtx ?? new AudioCtx();

    filterSource = audioCtx.createMediaElementSource(getAudio());

    bassFilter = audioCtx.createBiquadFilter();
    bassFilter.type = "lowshelf";
    bassFilter.frequency.value = 150;
    bassFilter.gain.value = 0;

    vocalFilter = audioCtx.createBiquadFilter();
    vocalFilter.type = "peaking";
    vocalFilter.frequency.value = 2500;
    vocalFilter.Q.value = 1;
    vocalFilter.gain.value = 0;

    nightLow = audioCtx.createBiquadFilter();
    nightLow.type = "lowpass";
    nightLow.frequency.value = 20000;
    nightLow.Q.value = 0.5;

    panner = audioCtx.createStereoPanner();
    gainOut = audioCtx.createGain();

    filterSource.connect(bassFilter);
    bassFilter.connect(vocalFilter);
    vocalFilter.connect(nightLow);
    nightLow.connect(panner);
    panner.connect(gainOut);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    gainOut.connect(analyser);
    analyser.connect(audioCtx.destination);

    if (audioCtx.state === "suspended") void audioCtx.resume();
    return true;
  } catch {
    return false;
  }
}

/** Analyser for the visualizer (now part of the filter graph). */
export function ensureAnalyser(): AnalyserNode | null {
  ensureGraph();
  return analyser;
}

function stopRotation(): void {
  if (rotateRaf) {
    cancelAnimationFrame(rotateRaf);
    rotateRaf = 0;
  }
  if (panner) panner.pan.value = 0;
}

function startRotation(): void {
  stopRotation();
  const ctx = audioCtx;
  if (!ctx || !panner) return;
  const start = ctx.currentTime;
  const tick = () => {
    if (!ctx || !panner) return;
    // Full L/R sweep every 4 seconds with a 0.35Hz wobble — clearly audible
    // "8D" motion (slow 8s pans read as stereo drift, not 8D).
    const t = ctx.currentTime - start;
    // Hard, wide swing: full -1 → +1 sweep every 3.2s. Combined with the
    // mid-dip EQ this reads as an unmistakable orbit around the head.
    panner.pan.value = Math.sin(t * (2 * Math.PI / 3.2));
    rotateRaf = requestAnimationFrame(tick);
  };
  rotateRaf = requestAnimationFrame(tick);
}

/** Activate an audio filter. Returns false if Web Audio isn't available. */
export function setAudioFilter(id: AudioFilterId): boolean {
  activeFilter = id;
  if (id === "off") {
    // Even for "off", keep the graph connected once it exists (the audio
    // element can only ever have one MediaElementSource). Reset all nodes.
    stopRotation();
    if (audioCtx && bassFilter && vocalFilter && nightLow && gainOut) {
      bassFilter.gain.value = 0;
      vocalFilter.gain.value = 0;
      nightLow.frequency.value = 20000;
      gainOut.gain.value = 1;
    }
    return true;
  }
  if (!ensureGraph()) return false;
  if (audioCtx?.state === "suspended") void audioCtx.resume();

  stopRotation();
  bassFilter!.gain.value = 0;
  vocalFilter!.gain.value = 0;
  nightLow!.frequency.value = 20000;
  gainOut!.gain.value = 1;

  switch (id) {
    case "8d":
      startRotation();
      // Aggressive spatialization: dip mids hard while the fast full-sweep
      // panning orbits the sound — unmistakably different from the original.
      vocalFilter!.frequency.value = 1000;
      vocalFilter!.gain.value = -7;
      bassFilter!.gain.value = -5;
      break;
    case "bass":
      // Extreme low-end: +24dB shelf at 70Hz — walls will shake.
      bassFilter!.frequency.value = 70;
      bassFilter!.gain.value = 24;
      vocalFilter!.frequency.value = 400;
      vocalFilter!.gain.value = -4; // clear room for the sub-bass
      break;
    case "vocal":
      // Hard presence lift at 3.2kHz + big mud cut — vocals jump way forward.
      vocalFilter!.frequency.value = 3200;
      vocalFilter!.Q.value = 0.7;
      vocalFilter!.gain.value = 16;
      bassFilter!.frequency.value = 300;
      bassFilter!.gain.value = -11;
      break;
    case "night":
      // Night mode: hard low-pass, tamed level, gentle bass warmth — very
      // obviously softer/darker than the original mix.
      nightLow!.frequency.value = 2400;
      gainOut!.gain.value = 0.45;
      vocalFilter!.gain.value = -5;
      bassFilter!.gain.value = 5;
      break;
  }
  return true;
}

export function getActiveAudioFilter(): AudioFilterId {
  return activeFilter;
}

/** Copy the current frequency magnitudes into `out` (0-255 per bin). */
export function readFrequencyData(node: AnalyserNode, out: Uint8Array): void {
  node.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
}
