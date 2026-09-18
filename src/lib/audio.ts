import { useEffect } from "react";

/** Single shared <audio> element for direct-stream playback. */
export function getAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
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

// --- dedicated USER EQ nodes (always active once the graph exists) ------------
let eqBassNode: BiquadFilterNode | null = null; // low shelf
let eqTrebleNode: BiquadFilterNode | null = null; // high shelf
let balanceNode: StereoPannerNode | null = null;

// --- effect chain nodes (driven by the active sound effect) -------------------
let fxIn: GainNode | null = null; // effects tap in here
let bassFilter: BiquadFilterNode | null = null;
let vocalFilter: BiquadFilterNode | null = null;
let nightLow: BiquadFilterNode | null = null;
let panner: StereoPannerNode | null = null;
let gainOut: GainNode | null = null;

// User EQ state (persisted by settings; applied whenever the graph exists)
let eqBass = 0; // dB
let eqTreble = 0; // dB
let eqBalance = 0; // -1 (left) → +1 (right)
let eqMono = false;

let activeFilter: AudioFilterId = "off";
let rotateRaf = 0;

/**
 * Lazily create the shared audio graph:
 *   <audio> → [user EQ: bass → treble] → balance → [effects: bass → vocal →
 *   night → pan → gain] → analyser → destination
 *
 * The user EQ lives on its OWN nodes, separate from the effect nodes, so
 * presets/sound-effects can never clobber the user's bass/treble/balance
 * settings (the old bug: both wrote to the same BiquadFilter gains, so
 * changing one silently reset the other).
 *
 * Must be called from a user-gesture context the first time (browsers block
 * suspended AudioContexts). YouTube IFrame playback isn't tappable here —
 * those tracks only hit this graph when routed through the audio element
 * (effects active / stream rescue).
 */
export function ensureGraph(): boolean {
  try {
    if (audioCtx && filterSource) {
      if (audioCtx.state === "suspended") void audioCtx.resume();
      return true;
    }
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    audioCtx = audioCtx ?? new AudioCtx();

    filterSource = audioCtx.createMediaElementSource(getAudio());

    // user EQ stage
    eqBassNode = audioCtx.createBiquadFilter();
    eqBassNode.type = "lowshelf";
    eqBassNode.frequency.value = 150;
    eqBassNode.gain.value = eqBass;

    eqTrebleNode = audioCtx.createBiquadFilter();
    eqTrebleNode.type = "highshelf";
    eqTrebleNode.frequency.value = 6000;
    eqTrebleNode.gain.value = eqTreble;

    balanceNode = audioCtx.createStereoPanner();
    balanceNode.pan.value = eqMono ? 0 : eqBalance;

    // effects stage (tapped after the user EQ)
    fxIn = audioCtx.createGain();

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

    filterSource.connect(eqBassNode);
    eqBassNode.connect(eqTrebleNode);
    eqTrebleNode.connect(balanceNode);
    balanceNode.connect(fxIn);
    fxIn.connect(bassFilter);
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

/** Reset the effect stage to neutral (used when switching effects). */
function resetEffects(): void {
  stopRotation();
  if (bassFilter) {
    bassFilter.frequency.value = 150;
    bassFilter.gain.value = 0;
  }
  if (vocalFilter) {
    vocalFilter.frequency.value = 2500;
    vocalFilter.Q.value = 1;
    vocalFilter.gain.value = 0;
  }
  if (nightLow) nightLow.frequency.value = 20000;
  if (gainOut) gainOut.gain.value = 1;
}

/** Analyser for the visualizer (part of the graph). */
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
  if (eqMono) return; // mono pins the pan — skip the orbit
  const start = ctx.currentTime;
  const tick = () => {
    if (!ctx || !panner) return;
    // Full -1 → +1 sweep every 3.2s — clearly audible "8D" orbit.
    panner.pan.value = Math.sin((ctx.currentTime - start) * ((2 * Math.PI) / 3.2));
    rotateRaf = requestAnimationFrame(tick);
  };
  rotateRaf = requestAnimationFrame(tick);
}

/** Activate a sound effect. Returns false if Web Audio isn't available. */
export function setAudioFilter(id: AudioFilterId): boolean {
  activeFilter = id;
  if (!ensureGraph()) return false;

  resetEffects();
  if (id === "off") return true;

  if (audioCtx?.state === "suspended") void audioCtx.resume();

  switch (id) {
    case "8d":
      startRotation();
      // Aggressive spatialization: dip mids hard while the fast full-sweep
      // panning orbits the sound.
      vocalFilter!.frequency.value = 1000;
      vocalFilter!.gain.value = -7;
      bassFilter!.gain.value = -5;
      break;
    case "bass":
      // Extreme low-end: +24dB shelf at 70Hz.
      bassFilter!.frequency.value = 70;
      bassFilter!.gain.value = 24;
      vocalFilter!.frequency.value = 400;
      vocalFilter!.gain.value = -4; // clear room for the sub-bass
      break;
    case "vocal":
      // Hard presence lift at 3.2kHz + big mud cut.
      vocalFilter!.frequency.value = 3200;
      vocalFilter!.Q.value = 0.7;
      vocalFilter!.gain.value = 16;
      bassFilter!.frequency.value = 300;
      bassFilter!.gain.value = -11;
      break;
    case "night":
      // Night mode: hard low-pass, tamed level, gentle bass warmth.
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

// --- user EQ (audio settings panel) -------------------------------------------
//
// These write ONLY to the dedicated user-EQ nodes, so they work no matter
// which sound effect is active and are never overwritten by effects.

export function setEqBass(db: number): void {
  eqBass = db;
  if (eqBassNode) eqBassNode.gain.value = db;
}

export function setEqTreble(db: number): void {
  eqTreble = db;
  if (eqTrebleNode) eqTrebleNode.gain.value = db;
}

export function setEqBalance(v: number): void {
  eqBalance = Math.min(1, Math.max(-1, v));
  if (balanceNode && !eqMono) balanceNode.pan.value = eqBalance;
}

export function setEqMono(mono: boolean): void {
  eqMono = mono;
  if (balanceNode) balanceNode.pan.value = mono ? 0 : eqBalance;
}

/** One-shot EQ presets. */
export function applyEqPreset(preset: { bass: number; treble: number }): void {
  setEqBass(preset.bass);
  setEqTreble(preset.treble);
}

/** Copy the current frequency magnitudes into `out` (0-255 per bin). */
export function readFrequencyData(node: AnalyserNode, out: Uint8Array): void {
  node.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
}
