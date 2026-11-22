import { useEffect } from "react";
import { releaseAudioSource } from "@/lib/hlsAudio";

/**
 * A playback "deck": one <audio> element plus the Web Audio nodes that belong
 * to it.
 *
 * SYNQ runs on TWO decks, not one. A crossfade needs the outgoing song and the
 * incoming song to be audible at the same time, and a single <audio> element
 * can only ever play one of them — so the second element is not a luxury, it
 * is the whole mechanism. Whichever deck is `active` is what `getAudio()`
 * returns, which is why the rest of the app needed no changes at all to
 * support crossfading: a transition simply swaps which deck is active.
 *
 * The spec allows exactly one MediaElementSource per ELEMENT (not per context),
 * so each deck gets its own source and they share the single downstream EQ /
 * balance / effects / analyser chain.
 */
interface Deck {
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode | null;
  /** Transition multiplier for this deck only. 1 = untouched. */
  gain: GainNode | null;
}

function createDeckElement(): HTMLAudioElement {
  const audio = new Audio();
  audio.preload = "auto";
  audio.crossOrigin = "anonymous";
  // Mobile browsers are more consistent about continuing Media Session
  // playback when the media element remains in the document. Keep it
  // hidden and non-interactive; the player store still owns all controls.
  audio.setAttribute("aria-hidden", "true");
  audio.setAttribute("playsinline", "true");
  audio.style.display = "none";
  if (document.body) document.body.appendChild(audio);
  return audio;
}

let decks: Record<"a" | "b", Deck> | null = null;
/** Which deck `getAudio()` currently resolves to. */
let activeDeck: "a" | "b" = "a";

function ensureDecks(): Record<"a" | "b", Deck> {
  if (decks) return decks;
  const w = window as unknown as {
    __ssAudio?: HTMLAudioElement;
    __ssAudioSpare?: HTMLAudioElement;
  };
  // Reuse an element left over from a previous page load when one is already
  // on the window, so a hot reload does not orphan a playing element.
  const first = w.__ssAudio ?? createDeckElement();
  const second = w.__ssAudioSpare ?? createDeckElement();
  w.__ssAudio = first;
  w.__ssAudioSpare = second;
  decks = {
    a: { el: first, source: null, gain: null },
    b: { el: second, source: null, gain: null },
  };
  return decks;
}

/**
 * The deck that currently owns playback. Every existing call site keeps
 * working unchanged; a crossfade works by making the *other* deck active once
 * the blend finishes.
 */
export function getAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
    return new Audio();
  }
  const d = ensureDecks();
  const el = d[activeDeck].el;
  if (!el.isConnected && document.body) document.body.appendChild(el);
  // Kept in sync for the benefit of anything reading the legacy global.
  (window as unknown as { __ssAudio?: HTMLAudioElement }).__ssAudio = el;
  return el;
}

/** The idle deck — the one a crossfade loads the incoming song onto. */
export function getSpareAudio(): HTMLAudioElement {
  if (typeof window === "undefined") {
    return new Audio();
  }
  const d = ensureDecks();
  const slot = activeDeck === "a" ? "b" : "a";
  const el = d[slot].el;
  if (!el.isConnected && document.body) document.body.appendChild(el);
  return el;
}

/**
 * Notified after the active deck changes so the player store can move its
 * event listeners onto the new element. Without this the store would keep
 * listening to the deck that just went silent and playback position, buffering
 * and end-of-track would all freeze at the moment of the swap.
 */
let activeDeckListener:
  | ((next: HTMLAudioElement, prev: HTMLAudioElement) => void)
  | null = null;
export function onActiveDeckChange(
  cb: ((next: HTMLAudioElement, prev: HTMLAudioElement) => void) | null,
): void {
  activeDeckListener = cb;
}

/**
 * Make the spare deck the active one. Returns false when there is nothing to
 * swap, so a caller can never believe a transition happened when it did not.
 */
export function swapActiveDeck(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  const d = ensureDecks();
  const next = activeDeck === "a" ? "b" : "a";
  const prevEl = d[activeDeck].el;
  const nextEl = d[next].el;
  if (prevEl === nextEl) return null;
  activeDeck = next;
  // Restore the outgoing deck to a neutral gain so it is clean if it is ever
  // used for playback again.
  try {
    if (d[next].gain) d[next].gain.gain.cancelScheduledValues(0);
    if (d[next].gain) d[next].gain.gain.value = 1;
  } catch {
    /* not built yet */
  }
  try {
    activeDeckListener?.(nextEl, prevEl);
  } catch {
    /* a listener must never break the swap */
  }
  return nextEl;
}

/** Keep both decks' playback rate in sync (call from an effect). */
export function useAudioRate(rate: number): void {
  useEffect(() => {
    setDeckRate(rate);
  }, [rate]);
}

/** Apply the rate to BOTH decks, so a swap never lands on a stale speed. */
export function setDeckRate(rate: number): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  deckRate = Math.min(2, Math.max(0.5, rate));
  // The preserving "Speed" slider owns the rate now — exactly what the
  // fullscreen speed dropdown has always meant.
  tapeMode = false;
  applyDeckRateAndPitch(d);
  notifyEqChange();
}

/**
 * "Speed (pitch)": tape-style speed that raises/lowers the key as it moves.
 * Takes ownership of the rate (mutually exclusive with the preserving slider,
 * as in melo) and disables pitch preservation. Any pitch shift rides on top.
 */
export function setTapeSpeed(speed: number): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  deckRate = Math.min(2, Math.max(0.5, speed));
  // melo's slider reads 1.00x as "off": exactly 1.0 hands the rate back to
  // the preserving mode, so the panel's two sliders can both legitimately
  // show 1.00x only when nothing is active.
  tapeMode = deckRate !== 1;
  applyDeckRateAndPitch(d);
  notifyEqChange();
}

/**
 * Tape-style pitch: the deck plays at rate × 2^(n/12) with pitch preservation
 * disabled, so +1..+12 genuinely raises the key (Nightcore) and −N lowers it.
 * At 0 the listener's preserve-pitch preference rules.
 */
export function setDeckPitch(semitones: number): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  deckPitch = Math.min(12, Math.max(-12, Math.round(semitones)));
  applyDeckRateAndPitch(d);
  notifyEqChange();
}

/** The listener's "speed changes keep the key" preference (used at pitch 0). */
export function setRatePreservesPitch(preserve: boolean): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  ratePreservesPitch = preserve;
  applyDeckRateAndPitch(d);
  notifyEqChange();
}

function applyDeckRateAndPitch(d: Record<"a" | "b", Deck>): void {
  // The pitch shift rides ON the rate: rate × 2^(semitones/12). Clamped to a
  // range every browser accepts. Preservation is disabled whenever a pitch
  // shift is active (it would undo the shift) or the tape mode owns the rate;
  // otherwise the listener's keep-the-key preference rules.
  const shifted = deckPitch !== 0 || tapeMode;
  const effective = Math.min(
    4,
    Math.max(0.25, deckRate * Math.pow(2, deckPitch / 12)),
  );
  const preserve = shifted ? false : ratePreservesPitch;
  for (const slot of ["a", "b"] as const) {
    const el = d[slot].el;
    try {
      el.playbackRate = effective;
    } catch {
      /* not ready */
    }
    try {
      el.preservesPitch = preserve;
      (
        el as HTMLAudioElement & {
          webkitPreservesPitch?: boolean;
          mozPreservesPitch?: boolean;
        }
      ).webkitPreservesPitch = preserve;
      (
        el as HTMLAudioElement & {
          webkitPreservesPitch?: boolean;
          mozPreservesPitch?: boolean;
        }
      ).mozPreservesPitch = preserve;
    } catch {
      /* older engine without the property — the rate still applies */
    }
  }
}

/** The current pitch (semitones), for settings UI to render. */
export function getDeckPitch(): number {
  return deckPitch;
}

/** The current preserve-pitch preference. */
export function getRatePreservesPitch(): boolean {
  return ratePreservesPitch;
}

/** The rate shown by the preserving "Speed" slider (1.0 when tape mode owns it). */
export function getSpeed(): number {
  return tapeMode ? 1 : deckRate;
}

/** The rate shown by the tape-style "Speed (pitch)" slider (1.0 otherwise). */
export function getTapeSpeed(): number {
  return tapeMode ? deckRate : 1;
}

/** Whether the tape-style speed mode currently owns the rate. */
export function getTapeMode(): boolean {
  return tapeMode;
}

/**
 * Master volume applies to both decks. `getAudio().volume = v` only reaches one
 * of them, which after a crossfade would leave the listener's volume change
 * silently applying to the idle deck.
 */
export function setDeckVolume(v: number): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  const value = Math.min(1, Math.max(0, v));
  for (const slot of ["a", "b"] as const) {
    try {
      d[slot].el.volume = value;
    } catch {
      /* not ready */
    }
  }
}

/**
 * Pause BOTH decks.
 *
 * Necessary because a crossfade has two songs audible at once. Pausing only
 * `getAudio()` — which is what this code did before decks existed — leaves the
 * incoming song playing while the UI says "paused", and then resuming makes
 * both songs audible together. Unpausing has to stop the blend too.
 */
export function pauseAllDecks(): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  for (const slot of ["a", "b"] as const) {
    try {
      d[slot].el.pause();
    } catch {
      /* ignore */
    }
  }
}

/** Mute must cover both decks, for the same reason as volume. */
export function setDeckMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  const d = ensureDecks();
  for (const slot of ["a", "b"] as const) {
    try {
      d[slot].el.muted = muted;
    } catch {
      /* not ready */
    }
  }
}

// --- audio filter chain -------------------------------------------------------

export type AudioFilterId = "off" | "8d" | "bass" | "vocal" | "night";

export const AUDIO_EFFECT_DELAY_MESSAGE =
  "Turning on sound effects may add a small delay before music starts.";

export const AUDIO_FILTERS: {
  id: AudioFilterId;
  label: string;
  icon: string;
  description: string;
}[] = [
  { id: "off", label: "None", icon: "🎵", description: "Original mix" },
  {
    id: "8d",
    label: "8D Audio",
    icon: "🌀",
    description: "Surround-style rotating effect",
  },
  {
    id: "bass",
    label: "Bass Boost",
    icon: "🔊",
    description: "Extra low-end punch",
  },
  {
    id: "vocal",
    label: "Vocal Boost",
    icon: "🎤",
    description: "Emphasizes voices",
  },
  {
    id: "night",
    label: "Night Mode",
    icon: "🌙",
    description: "Soft, quiet-friendly EQ",
  },
];

let audioCtx: AudioContext | null = null;
let filterSource: MediaElementAudioSourceNode | null = null;
let analyser: AnalyserNode | null = null;

/**
 * A stereo panner, or the plain GainNode we degrade to.
 *
 * `createStereoPanner()` is absent on older Safari and in several WebViews —
 * this file's own header comment already names it as the API whose absence
 * once caused silent playback. The problem is not the missing panner, it is
 * that an UNGUARDED call takes the whole chain down with it: `ensureGraph()`
 * throws, nulls every node, and the decks are never captured, so they keep
 * playing directly to the speakers.
 *
 * The result is the worst possible failure to diagnose: the listener hears
 * every song perfectly normally through the un-tapped element, while
 * `ensureDeckAttached()` sees a null `eqBassNode` and `canCrossfadeNow()`
 * returns false for the rest of the session — so every transition is refused
 * and every track ends in a hard cut, with nothing on screen to explain it.
 *
 * Balance is a nicety. A crossfade is the feature. A missing panner must cost
 * the balance control, never the audio graph.
 */
type PannerLike = AudioNode & { pan?: AudioParam };

function createPanner(ctx: AudioContext): PannerLike {
  if (typeof ctx.createStereoPanner === "function") {
    return ctx.createStereoPanner();
  }
  return ctx.createGain();
}

/** Write the pan, tolerating a node that has no `pan` (the GainNode fallback). */
function setPan(node: PannerLike | null | undefined, value: number): void {
  if (!node?.pan) return;
  try {
    node.pan.value = value;
  } catch {
    /* context not running */
  }
}

// --- vibe helpers -------------------------------------------------------------

/**
 * Generate the reverb impulse response: exponentially-decaying noise, the
 * classic synthetic room. Ported from melo's engine (0.6 s decay), scaled to
 * a gentle stereo tail. Returns null-ish safe: callers guard on the convolver.
 */
function makeReverbImpulse(
  ctx: AudioContext,
  seconds: number,
  decay: number,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      // White noise × exponential decay — a plausible small room.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

/**
 * Cubic soft-clip curve for the distortion WaveShaper, matching melo's
 * `_makeDistortionCurve` shape: k drives how hard the wave is folded.
 */
function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = amount * 1.2;
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + k) * x * 20 * Math.PI) / (Math.PI + k * Math.abs(x));
  }
  return curve;
}

/**
 * Dry/wet mix for a given distortion amount (0..100), melo's blend: the wet
 * path carries up to 0.75 of the signal, the dry path is ducked to 0.6 at
 * full drive so the two sum back near unity.
 */
function applyDistortionMix(amount: number): { wet: number; dry: number } {
  const a = Math.min(100, Math.max(0, amount));
  return { wet: (a / 100) * 0.75, dry: 1 - (a / 100) * 0.4 };
}

/**
 * Gentle harmonic-saturation curve for the enhancer (melo's
 * `_makeHarmonicCurve`): a cubic softening term rather than hard folding, so
 * low amounts add warmth instead of audible clipping.
 */
function makeHarmonicCurve(amount: number): Float32Array<ArrayBuffer> {
  const k = Math.max(0, amount) * 0.02;
  const samples = 1024;
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = x - k * Math.pow(x, 3);
  }
  return curve;
}

/**
 * Configure the normalization nodes for the current toggle state.
 *
 * OFF must be TRANSPARENT, not "off but still limiting": the limiter sits in
 * the dry path, so when normalization is disabled its threshold goes to 0 dB
 * and its ratio to 1 — a no-op. When enabled it becomes the brickwall melo
 * uses (threshold −2 dB, ratio 20) and the RMS loop steers `normGain`.
 */
function applyNormalizationNodes(): void {
  if (!normLimiter) return;
  try {
    if (volumeNormalization) {
      normLimiter.threshold.value = -2;
      normLimiter.ratio.value = 20;
      normLimiter.attack.value = 0.003;
      normLimiter.release.value = 0.25;
    } else {
      normLimiter.threshold.value = 0;
      normLimiter.ratio.value = 1;
      normGain?.gain.cancelScheduledValues(0);
      if (normGain) normGain.gain.value = 1;
    }
  } catch {
    /* context not running */
  }
}

/** The RMS target the normalization loop aims for, in dBFS. */
const NORMALIZE_TARGET_DB = -18;
/** How far the correction gain may swing from unity, in either direction. */
const NORMALIZE_GAIN_LIMIT = 4;

/**
 * One normalization step: read the current RMS, aim the gain so it lands on
 * the target, smooth the move. Runs on an interval only while enabled —
 * melo's equivalent fed its loop from a level watcher in the renderer; here
 * the graph module owns the whole loop so no other file needs to care.
 */
function normalizationStep(): void {
  if (!volumeNormalization || !normGain || !audioCtx) return;
  const level = getSignalLevel();
  // -1 = the analyser is not built; no measurement, no correction.
  if (level <= 0) return;
  const levelDb = 20 * Math.log10(level);
  // Anything below −60 dBFS is silence between songs: park at unity so the
  // gain does not creep toward its limit waiting for the next track.
  if (levelDb < -60) return;
  const target = Math.pow(
    10,
    Math.min(
      Math.log10(NORMALIZE_GAIN_LIMIT),
      Math.max(
        Math.log10(1 / NORMALIZE_GAIN_LIMIT),
        (NORMALIZE_TARGET_DB - levelDb) / 20,
      ),
    ),
  );
  try {
    // ~0.8 s smoothing, like melo's ramped correction — audible pumping
    // would be worse than an imperfect match.
    normGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.4);
  } catch {
    /* context not running */
  }
}

function startNormalizationLoop(): void {
  if (normalizationTimer || typeof window === "undefined") return;
  normalizationTimer = window.setInterval(normalizationStep, 250);
}

function stopNormalizationLoop(): void {
  if (!normalizationTimer) return;
  clearInterval(normalizationTimer);
  normalizationTimer = 0;
}

// --- dedicated USER EQ nodes (always active once the graph exists) ------------
let eqBassNode: BiquadFilterNode | null = null; // low shelf
let eqTrebleNode: BiquadFilterNode | null = null; // high shelf
let balanceNode: PannerLike | null = null;

// --- 10-band graphic EQ (between the shelves and balance) ---------------------
//
// Ported from the melo desktop player's audio engine: ten peaking filters at
// one-octave spacing with Q 1.1, each clamped to ±12 dB. They sit BETWEEN the
// two shelf knobs and the balance node, so the bass/treble sliders, the 10-band
// sliders and every effect preset all compose instead of overwriting each
// other — the dedicated-node rule that fixed the "changing one reset the
// other" bug applies here too.
export const EQ_BAND_FREQUENCIES = [
  32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000,
] as const;
export const EQ_BAND_MIN_DB = -12;
export const EQ_BAND_MAX_DB = 12;
const EQ_BAND_Q = 1.1;
let eqBandNodes: Array<BiquadFilterNode | null> = EQ_BAND_FREQUENCIES.map(
  () => null,
);

// --- effect chain nodes (driven by the active sound effect) -------------------
let fxIn: GainNode | null = null; // effects tap in here
let bassFilter: BiquadFilterNode | null = null;
let vocalFilter: BiquadFilterNode | null = null;
let nightLow: BiquadFilterNode | null = null;
let panner: PannerLike | null = null;
let gainOut: GainNode | null = null;

// --- post-effect stage: dry path + vibe taps + normalization ------------------
// After the effect chain the signal splits: a dry path (which the distortion
// tap ducks when active), the reverb, echo and distortion taps in parallel,
// and then the user's volume gain, volume normalization (a gain the RMS loop
// steers, followed by a brickwall limiter) before the analyser. Every path —
// dry AND taps — sums at the user gain, so the gain slider and the limiter
// hear exactly what the listener hears (melo's single master-gain sum).
let postFxDry: GainNode | null = null;
let reverbConvolver: ConvolverNode | null = null;
let reverbWet: GainNode | null = null;
let distortionShaper: WaveShaperNode | null = null;
let distortionWet: GainNode | null = null;
let echoDelay: DelayNode | null = null;
let echoFeedback: GainNode | null = null;
let echoWet: GainNode | null = null;
let userGain: GainNode | null = null;
let normGain: GainNode | null = null;
let normLimiter: DynamicsCompressorNode | null = null;

// --- enhancer chain nodes (melo's HQ chain, between the decks and the EQ) -----
// Wired in ONLY while enabled: deck gains connect to `enhancerIn` and the
// chain hands off to the EQ stage. When disabled the decks connect straight
// to the EQ, exactly as before the enhancer existed — "off" must be the same
// graph the app shipped with.
let enhancerIn: GainNode | null = null;
let enhancerComp: DynamicsCompressorNode | null = null;
let enhancerBass: BiquadFilterNode | null = null;
let enhancerVocal: BiquadFilterNode | null = null;
let enhancerAir: BiquadFilterNode | null = null;
let enhancerSat: WaveShaperNode | null = null;
let enhancerLimiter: DynamicsCompressorNode | null = null;

// User EQ state (persisted by settings; applied whenever the graph exists)
let eqBass = 0; // dB
let eqTreble = 0; // dB
let eqBalance = 0; // -1 (left) → +1 (right)
let eqMono = false;
// Mutated only through index assignment (setEqBand), so the binding itself
// never reassigns.
const eqBands: number[] = EQ_BAND_FREQUENCIES.map(() => 0); // dB per band

// --- vibe state (pitch / reverb / distortion) ---------------------------------
// Pitch is tape-style: the deck's effective rate becomes rate × 2^(n/12) with
// pitch preservation disabled, so a positive value genuinely raises the key
// (the Nightcore mechanism) rather than resampling it back to the original.
//
// Speed is ONE rate with TWO modes, which is what melo's "Speed" and
// "Speed (pitch)" sliders really are: the preserving browser rate, or the
// tape-style rate that drags the key along. The mode flag decides which of
// the panel's two sliders owns the value (they are mutually exclusive, as in
// melo) — but the RATE itself is a single number, so the fullscreen speed
// dropdown and every other existing `setDeckRate` consumer keep their exact
// rate × pitch composition.
let deckRate = 1;
let tapeMode = false; // true = "Speed (pitch)" owns the rate; speed drags the key
let deckPitch = 0; // semitones, -12..+12
let ratePreservesPitch = true; // the user's "speed keeps the key" preference
let reverbMix = 0; // 0..1 wet level of the room simulation
let distortionAmount = 0; // 0..100
let echoAmount = 0; // 0..100 wet level of the echo tap
let volumeGain = 1; // 0..2 — melo's "volume gain", pre-limiter output boost

// --- enhancer (melo's "High Quality" chain, renamed) ---------------------------
export type EnhancerEngineId = "harmonic" | "air" | "depth";

interface EnhancerSettings {
  engine: EnhancerEngineId;
  /** -50..50, percentage-style like melo's knobs. */
  vocal: number;
  air: number;
  bass: number;
}

let enhancerEnabled = false;
let enhancerSettings: EnhancerSettings = {
  engine: "harmonic",
  vocal: 0,
  air: 0,
  bass: 0,
};

// --- volume normalization -----------------------------------------------------
let volumeNormalization = false;
let normalizationTimer = 0;

let activeFilter: AudioFilterId = "off";
let rotateRaf = 0;

/**
 * True once `createMediaElementSource` has succeeded for ANY of our elements.
 * The spec allows exactly ONE MediaElementSource per ELEMENT — so this is
 * tracked per element on the deck, but the flag below is what stops a failed
 * rebuild from closing the live context: without it the old code closed and
 * recreated the AudioContext on every failed attempt, which tore down the graph
 * the YouTube player was routed through and made playback skip to another
 * track.
 */
let mediaSourceAttached = false;

/**
 * True once `ensureGraph()` has FAILED to build the chain on this device.
 *
 * This is the flag that lets the app say "crossfade cannot run here" instead
 * of silently doing nothing. Every other reason a blend is refused — a
 * suspended context, a deck not yet attached — is transient and resolves
 * itself; a build failure is permanent for the session, and the listener is
 * left hearing normal music with hard cuts at every track boundary and no
 * explanation anywhere.
 */
let graphBuildFailed = false;

/** True when the Web Audio graph could not be built on this device. */
export function audioGraphFailed(): boolean {
  return graphBuildFailed;
}

/**
 * Lazily create the shared audio graph:
 *   <audio> → [deck gain] → [user EQ: bass shelf → 10 peaking bands → treble
 *   shelf] → balance → [effects: bass → vocal → night → pan → gain] →
 *   [post-FX: dry ‖ reverb ‖ distortion] → [normalization gain → limiter] →
 *   analyser → destination
 *
 * The user EQ lives on its OWN nodes, separate from the effect nodes, so
 * presets/sound-effects can never clobber the user's bass/treble/balance
 * settings (the old bug: both wrote to the same BiquadFilter gains, so
 * changing one silently reset the other). The 10-band EQ sits between the two
 * shelves for the same reason — everything composes.
 *
 * Must be called from a user-gesture context the first time (browsers block
 * suspended AudioContexts). YouTube IFrame playback isn't tappable here —
 * those tracks only hit this graph when routed through the audio element
 * (effects active / stream rescue).
 */
export function ensureGraph(): boolean {
  // Declared out here so the catch can see it: the close/keep decision is
  // about THIS attempt, not about the sticky page-lifetime flag.
  let attachedHere = false;
  try {
    if (audioCtx && filterSource) {
      if (audioCtx.state === "suspended") void audioCtx.resume();
      return true;
    }
    // A previous attempt may have died half-way (e.g. created the context in
    // a non-gesture task). Tear it down so this call can build it cleanly —
    // otherwise every subsequent call throws and the EQ never works.
    if (audioCtx && !filterSource) {
      if (mediaSourceAttached) {
        // The element already owns a MediaElementSource, so the graph cannot
        // be rebuilt. Leave the live context alone — closing it is what made
        // playback jump to another track when an effect was switched on.
        return false;
      }
      try {
        void audioCtx.close();
      } catch {
        /* ignore */
      }
      audioCtx = null;
    }
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return false;
    audioCtx = audioCtx ?? new AudioCtx();

    // Both decks get their own MediaElementSource, and both feed the SAME
    // downstream chain. That is what makes a crossfade a real audio
    // crossfade: the outgoing and incoming songs are mixed inside the graph
    // while the user's EQ, balance and effects apply to both at once.
    //
    // It is DELIBERATELY not done yet. `createMediaElementSource` permanently
    // diverts the element's output into this graph: once it has been called,
    // the element can never sound on its own again, and its audio only exists
    // if the chain below actually reaches `destination`. Capturing first and
    // wiring second means any throw in between — `createStereoPanner` is
    // missing on older Safari and some WebViews — leaves a captured element
    // feeding nothing at all. That is silent playback with a running progress
    // bar, and because `mediaSourceAttached` was already true the catch block
    // refused to close the context, so every later call rebuilt from scratch
    // and hit InvalidStateError on the already-claimed element for good.
    //
    // Every failure-prone call now happens BEFORE anything is captured, which
    // is what makes the catch block below safe.

    // user EQ stage
    eqBassNode = audioCtx.createBiquadFilter();
    eqBassNode.type = "lowshelf";
    eqBassNode.frequency.value = 150;
    eqBassNode.gain.value = eqBass;

    eqTrebleNode = audioCtx.createBiquadFilter();
    eqTrebleNode.type = "highshelf";
    eqTrebleNode.frequency.value = 6000;
    eqTrebleNode.gain.value = eqTreble;

    balanceNode = createPanner(audioCtx);
    setPan(balanceNode, eqMono ? 0 : eqBalance);

    // 10-band graphic EQ: ten peaking filters chained between the shelves and
    // balance. Created before anything is captured, like every other node —
    // a missing BiquadFilter here must cost the band, never the graph.
    // `ctx` captures the narrowed binding: inside a callback, TS will not
    // carry the enclosing null-check across.
    const ctx = audioCtx;
    eqBandNodes = EQ_BAND_FREQUENCIES.map((freq, index) => {
      const node = ctx.createBiquadFilter();
      node.type = "peaking";
      node.frequency.value = freq;
      node.Q.value = EQ_BAND_Q;
      node.gain.value = eqBands[index] ?? 0;
      return node;
    });

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

    panner = createPanner(audioCtx);
    gainOut = audioCtx.createGain();

    // post-effect stage. Every node is created inside its own guarded block
    // and connected only after all exist, mirroring the capture-block rule:
    // any failure here must leave the dry path intact, not orphan the decks.
    postFxDry = audioCtx.createGain();
    postFxDry.gain.value = 1;

    try {
      reverbConvolver = audioCtx.createConvolver();
      reverbConvolver.buffer = makeReverbImpulse(audioCtx, 0.6, 2.4);
      reverbWet = audioCtx.createGain();
      reverbWet.gain.value = reverbMix;
    } catch {
      reverbConvolver = null;
      reverbWet = null;
    }

    try {
      distortionShaper = audioCtx.createWaveShaper();
      distortionShaper.curve = makeDistortionCurve(distortionAmount);
      distortionShaper.oversample = "2x";
      distortionWet = audioCtx.createGain();
      distortionWet.gain.value = applyDistortionMix(distortionAmount).wet;
      postFxDry.gain.value = applyDistortionMix(distortionAmount).dry;
    } catch {
      distortionShaper = null;
      distortionWet = null;
    }

    // Echo tap: a feedback delay (melo's values — 300 ms, 35% regen), created
    // guarded like the other taps: a missing DelayNode must cost the echo,
    // never the graph.
    try {
      echoDelay = audioCtx.createDelay(1.0);
      echoDelay.delayTime.value = 0.3;
      echoFeedback = audioCtx.createGain();
      echoFeedback.gain.value = 0.35;
      echoWet = audioCtx.createGain();
      echoWet.gain.value = echoAmount / 100;
      echoDelay.connect(echoFeedback);
      echoFeedback.connect(echoDelay);
    } catch {
      echoDelay = null;
      echoFeedback = null;
      echoWet = null;
    }

    // The user's volume gain: every path (dry + taps) sums here, before
    // normalization and the limiter — so a >100% boost is still guarded
    // against clipping, and 0% really is silence. Unguarded like postFxDry:
    // createGain exists in every WebAudio implementation.
    userGain = audioCtx.createGain();
    userGain.gain.value = volumeGain;

    try {
      normGain = audioCtx.createGain();
      normGain.gain.value = 1;
      normLimiter = audioCtx.createDynamicsCompressor();
      applyNormalizationNodes();
    } catch {
      normGain = null;
      normLimiter = null;
    }

    // Enhancer chain (melo's HQ chain): compressor → low shelf → vocal
    // peaking → air shelf → harmonic saturation → brickwall limiter. Guarded
    // as one unit — a missing DynamicsCompressor or WaveShaper disables the
    // enhancer for the session but leaves the standard graph untouched, and
    // the decks keep their direct route to the EQ.
    try {
      enhancerIn = audioCtx.createGain();
      enhancerComp = audioCtx.createDynamicsCompressor();
      enhancerBass = audioCtx.createBiquadFilter();
      enhancerBass.type = "lowshelf";
      enhancerBass.frequency.value = 80;
      enhancerVocal = audioCtx.createBiquadFilter();
      enhancerVocal.type = "peaking";
      enhancerVocal.frequency.value = 2500;
      enhancerVocal.Q.value = 1.2;
      enhancerAir = audioCtx.createBiquadFilter();
      enhancerAir.type = "highshelf";
      enhancerAir.frequency.value = 9000;
      enhancerSat = audioCtx.createWaveShaper();
      enhancerSat.oversample = "2x";
      enhancerLimiter = audioCtx.createDynamicsCompressor();
      enhancerLimiter.threshold.value = -1;
      enhancerLimiter.knee.value = 0;
      enhancerLimiter.ratio.value = 20;
      enhancerLimiter.attack.value = 0.005;
      enhancerLimiter.release.value = 0.05;
      enhancerIn.connect(enhancerComp);
      enhancerComp.connect(enhancerBass);
      enhancerBass.connect(enhancerVocal);
      enhancerVocal.connect(enhancerAir);
      enhancerAir.connect(enhancerSat);
      enhancerSat.connect(enhancerLimiter);
      enhancerLimiter.connect(eqBassNode);
      applyEnhancerParams();
    } catch {
      enhancerIn = null;
      enhancerComp = null;
      enhancerBass = null;
      enhancerVocal = null;
      enhancerAir = null;
      enhancerSat = null;
      enhancerLimiter = null;
    }

    // Deck wiring happens after the chain is complete — see the capture block
    // below. Connecting here would need `eqBassNode` to exist first, which it
    // does, but keeping every element-touching step in one place is what makes
    // the failure argument above checkable.

    eqBassNode.connect(eqBandNodes[0]!);
    for (let i = 0; i < eqBandNodes.length - 1; i++) {
      eqBandNodes[i]!.connect(eqBandNodes[i + 1]!);
    }
    eqBandNodes[eqBandNodes.length - 1]!.connect(eqTrebleNode);
    eqTrebleNode.connect(balanceNode);
    balanceNode.connect(fxIn);
    fxIn.connect(bassFilter);
    bassFilter.connect(vocalFilter);
    vocalFilter.connect(nightLow);
    nightLow.connect(panner);
    panner.connect(gainOut);

    // The analyser is a nicety (visualizer + the level probe the intro-trim
    // reads). It sits INLINE in the chain, so if it cannot be created the
    // audio must be wired straight to the destination instead of failing the
    // whole graph — otherwise the listener loses playback AND crossfading to
    // lose a spectrum display they cannot see anyway.
    try {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      // Dry path (ducked by the distortion mix), then the user gain, then
      // normalization, then the analyser — the taps feed the user gain too, so
      // the volume-gain slider and the limiter hear the whole mix (melo's
      // single master-gain sum).
      gainOut.connect(postFxDry);
      postFxDry.connect(userGain);
      if (reverbConvolver && reverbWet) {
        gainOut.connect(reverbConvolver);
        reverbConvolver.connect(reverbWet);
        reverbWet.connect(userGain);
      }
      if (distortionShaper && distortionWet) {
        gainOut.connect(distortionShaper);
        distortionShaper.connect(distortionWet);
        distortionWet.connect(userGain);
      }
      if (echoDelay && echoWet) {
        gainOut.connect(echoDelay);
        echoWet.connect(userGain);
      }
      if (normGain && normLimiter) {
        userGain.connect(normGain);
        normGain.connect(normLimiter);
        normLimiter.connect(analyser);
      } else {
        userGain.connect(analyser);
      }
      analyser.connect(audioCtx.destination);
    } catch {
      analyser = null;
      // Fallback: the dry path must reach the speakers even if nothing else
      // of this stage survived.
      try {
        if (normGain && normLimiter) {
          postFxDry.connect(userGain);
          userGain.connect(normGain);
          normGain.connect(normLimiter);
          normLimiter.connect(audioCtx.destination);
        } else {
          postFxDry.connect(userGain);
          userGain.connect(audioCtx.destination);
        }
      } catch {
        // Last resort — direct. The decks were not captured yet, so this
        // still leaves them free to play on their own.
        gainOut.connect(audioCtx.destination);
      }
    }

    // ---------------------------------------------------------------------
    // The chain now reaches the speakers, so it is finally safe to capture
    // the elements. Nothing above this line can throw and orphan them.
    // ---------------------------------------------------------------------
    const d = ensureDecks();
    for (const slot of ["a", "b"] as const) {
      if (d[slot].source) continue;
      try {
        d[slot].source = audioCtx.createMediaElementSource(d[slot].el);
        mediaSourceAttached = true;
        attachedHere = true;
      } catch {
        // A deck whose element is already claimed simply stays out of the
        // graph; the other deck still works.
        d[slot].source = null;
      }
    }

    // Each deck's transition GainNode sits BEFORE the EQ stage, so the blend
    // volume is multiplied independently of the listener's master volume and
    // their EQ settings. A crossfade therefore never disturbs either.
    for (const slot of ["a", "b"] as const) {
      const deck = d[slot];
      if (!deck.source) continue;
      if (!deck.gain) {
        deck.gain = audioCtx.createGain();
        deck.gain.gain.value = 1;
      }
      try {
        deck.source.connect(deck.gain);
        connectDeckGainToChain(deck.gain);
      } catch {
        /* already connected */
      }
    }

    filterSource = d[activeDeck].source;

    if (audioCtx.state === "suspended") void audioCtx.resume();

    if (!filterSource) {
      // The chain is live but the ACTIVE deck could not be captured, so it is
      // still playing straight to the speakers — audible, just without the EQ
      // and effects. That is the honest degraded state, and returning false
      // stops the UI claiming a graph it does not have.
      return false;
    }
    graphBuildFailed = false;
    // The graph arrived after normalization was switched on (e.g. the toggle
    // ran before any user gesture): start its loop now.
    if (volumeNormalization) startNormalizationLoop();
    return true;
  } catch {
    // Everything that can throw now runs BEFORE any element is captured, so by
    // the time we get here the audio elements are still free to play straight
    // to the speakers. That is what makes closing the context the correct move
    // rather than a fatal one.
    //
    // It used to be guarded by `!mediaSourceAttached` instead, which was the
    // wrong question: that flag is sticky for the life of the page, so once ANY
    // attempt had captured an element the context was never closed again — not
    // even after a later, cleanly-failing attempt. The orphaned context then
    // kept owning the element while the module forgot it existed, which is
    // permanent silence with the progress bar still running.
    //
    // `attachedHere` asks the right question: did THIS attempt take an element?
    if (!attachedHere) {
      graphBuildFailed = true;
      try {
        if (audioCtx && audioCtx.state !== "closed") void audioCtx.close();
      } catch {
        /* ignore */
      }
      audioCtx = null;
      filterSource = null;
      eqBassNode = null;
      eqTrebleNode = null;
      eqBandNodes = EQ_BAND_FREQUENCIES.map(() => null);
      balanceNode = null;
      fxIn = null;
      bassFilter = null;
      vocalFilter = null;
      nightLow = null;
      panner = null;
      gainOut = null;
      postFxDry = null;
      reverbConvolver = null;
      reverbWet = null;
      distortionShaper = null;
      distortionWet = null;
      echoDelay = null;
      echoFeedback = null;
      echoWet = null;
      userGain = null;
      enhancerIn = null;
      enhancerComp = null;
      enhancerBass = null;
      enhancerVocal = null;
      enhancerAir = null;
      enhancerSat = null;
      enhancerLimiter = null;
      normGain = null;
      normLimiter = null;
      analyser = null;
      return false;
    }
    // An element IS captured by this or an earlier attempt: the chain may be
    // incomplete, so keep the context alive and refuse rather than tear down
    // audio that is currently reaching the speakers.
    filterSource = null;
    return false;
  }
}

/**
 * RMS level (0..1) currently flowing through the graph. Used to PROVE the
 * EQ is actually processing audio instead of guessing: if this stays at ~0
 * while music is playing, the audio element is not in the graph (or the
 * context never resumed) and the effect is a silent no-op.
 */
let levelProbe: Uint8Array<ArrayBuffer> | null = null;
export function getSignalLevel(): number {
  if (!analyser) return -1; // graph not built
  if (!levelProbe || levelProbe.length !== analyser.frequencyBinCount) {
    levelProbe = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteTimeDomainData(levelProbe as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < levelProbe.length; i++) {
    const v = (levelProbe[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / levelProbe.length);
}

/**
 * Ensure the graph exists AND the context is actually running. Browsers can
 * refuse `resume()` on the first call after a gesture, so retry across a few
 * frames — a suspended context means total silence and a useless EQ.
 */
export async function resumeGraph(attempts = 4): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (!ensureGraph()) return false;
    if (audioCtx?.state === "running") return true;
    try {
      await audioCtx?.resume();
    } catch {
      /* try again next frame */
    }
    await Promise.resolve();
  }
  return audioCtx?.state === "running";
}

/** True when the Web Audio graph exists and the audio element flows through it. */
export function isGraphReady(): boolean {
  return !!audioCtx && !!filterSource;
}

/**
 * True when the user has ANY non-default audio processing configured (EQ
 * sliders, 10-band curve, mono, balance, pitch, reverb, distortion, an effect
 * preset or normalization). Playback MUST then run through the <audio>
 * element — the YouTube IFrame cannot be tapped by Web Audio, so these
 * settings would otherwise be inaudible.
 */
export function hasAudioProcessing(): boolean {
  return (
    activeFilter !== "off" ||
    eqBass !== 0 ||
    eqTreble !== 0 ||
    eqBalance !== 0 ||
    eqMono ||
    eqBands.some((band) => band !== 0) ||
    deckPitch !== 0 ||
    deckRate !== 1 ||
    reverbMix > 0 ||
    distortionAmount > 0 ||
    echoAmount > 0 ||
    volumeGain !== 1 ||
    enhancerEnabled ||
    volumeNormalization
  );
}

/** Notified whenever the user changes an EQ value, so playback can be re-routed. */
let eqChangeListener: (() => void) | null = null;
export function onEqChange(cb: (() => void) | null): void {
  eqChangeListener = cb;
}
function notifyEqChange(): void {
  try {
    eqChangeListener?.();
  } catch {
    /* ignore */
  }
}

/**
 * Route a deck's transition gain into the downstream chain: through the
 * enhancer when it is enabled, otherwise straight to the EQ stage — the same
 * switch melo makes in `_updateRouting`. Called from every wiring site so a
 * deck attached mid-session always lands on the CURRENT route.
 */
function connectDeckGainToChain(deckGain: GainNode): void {
  if (enhancerEnabled && enhancerIn) deckGain.connect(enhancerIn);
  else if (eqBassNode) deckGain.connect(eqBassNode);
}

/**
 * Re-route every already-wired deck after the enhancer toggles. Disconnecting
 * the deck gain is safe: its ONLY downstream connection is this chain.
 */
function rerouteDecks(): void {
  const d = decks;
  if (!d || !audioCtx) return;
  for (const slot of ["a", "b"] as const) {
    const gain = d[slot].gain;
    if (!gain) continue;
    try {
      gain.disconnect();
    } catch {
      /* not connected */
    }
    connectDeckGainToChain(gain);
  }
}

// --- enhancer (melo's "High Quality" chain, renamed) ---------------------------
//
// Three engines with the same shape as melo's, described by what they do
// rather than melo's internal codenames:
//   harmonic — the most saturation (melo's hqmusic-3)
//   air      — a slight fixed high-shelf lift (melo's glyphs-7B)
//   depth    — a slight fixed low-shelf lift and firmer compression
//             (melo's fyro1.1)

export const ENHANCER_ENGINES: {
  id: EnhancerEngineId;
  label: string;
  description: string;
}[] = [
  { id: "harmonic", label: "Harmonic", description: "Warmth and presence" },
  { id: "air", label: "Air", description: "High-end detail and space" },
  { id: "depth", label: "Depth", description: "Low-end weight and control" },
];

export const ENHANCER_PRESETS: {
  id: string;
  label: string;
  vocal: number;
  air: number;
  bass: number;
}[] = [
  { id: "studio", label: "Studio", vocal: 0, air: 0, bass: 0 },
  { id: "vinyl", label: "Vinyl", vocal: 15, air: -15, bass: 25 },
  { id: "concert", label: "Concert", vocal: -10, air: 30, bass: 15 },
];

/** The enhancer's per-engine fixed character, mirroring melo's switch. */
function enhancerEngineCharacter(engine: EnhancerEngineId): {
  saturation: number;
  baseBass: number;
  baseAir: number;
  ratio: number;
} {
  switch (engine) {
    case "air":
      return { saturation: 0.2, baseBass: 0, baseAir: 2.5, ratio: 1.5 };
    case "depth":
      return { saturation: 0.2, baseBass: 3.0, baseAir: 0, ratio: 2.0 };
    case "harmonic":
    default:
      return { saturation: 0.5, baseBass: 0, baseAir: 0, ratio: 1.5 };
  }
}

/** Paint the current enhancer settings onto the nodes (no-ops without them). */
function applyEnhancerParams(): void {
  if (!enhancerComp) return;
  try {
    const char = enhancerEngineCharacter(enhancerSettings.engine);
    enhancerComp.threshold.value = -12;
    enhancerComp.knee.value = 10;
    enhancerComp.ratio.value = char.ratio;
    enhancerComp.attack.value = 0.01;
    enhancerComp.release.value = 0.1;
    if (enhancerSat) enhancerSat.curve = makeHarmonicCurve(char.saturation);
    // melo's knob scaling: ±50% on the slider → ±4 dB on the node, plus the
    // engine's fixed tilt. Clamped so extremes cannot fight the limiter.
    if (enhancerBass)
      enhancerBass.gain.value = Math.max(
        -4,
        Math.min(4, char.baseBass + enhancerSettings.bass * 0.08),
      );
    if (enhancerVocal)
      enhancerVocal.gain.value = Math.max(
        -4,
        Math.min(4, enhancerSettings.vocal * 0.08),
      );
    if (enhancerAir)
      enhancerAir.gain.value = Math.max(
        -4,
        Math.min(4, char.baseAir + enhancerSettings.air * 0.08),
      );
  } catch {
    /* context not running */
  }
}

/**
 * Enable or disable the enhancer, optionally updating its settings. When the
 * graph exists the decks are re-routed immediately; without one the state is
 * held and a later `ensureGraph()` wires it (the same contract as every other
 * setter in this file).
 */
export function setEnhancer(
  enabled: boolean,
  settings?: Partial<EnhancerSettings>,
): void {
  enhancerEnabled = enabled;
  if (settings) enhancerSettings = { ...enhancerSettings, ...settings };
  if (audioCtx && eqBassNode) {
    // The chain's hand-off to the EQ may not exist yet on a graph that was
    // built before the enhancer feature — build it now (guarded, like the
    // rest of the chain).
    if (enabled && !enhancerIn) buildEnhancerChain();
    rerouteDecks();
    if (enabled) applyEnhancerParams();
    else neutralizeEnhancerNodes();
  }
  notifyEqChange();
}

export function isEnhancerEnabled(): boolean {
  return enhancerEnabled;
}

export function getEnhancerSettings(): EnhancerSettings {
  return { ...enhancerSettings };
}

/**
 * Late-build the enhancer chain on a graph that predates it. Mirrors the
 * guarded block in `ensureGraph()`; no-ops when the chain already exists.
 */
function buildEnhancerChain(): void {
  if (!audioCtx || !eqBassNode || enhancerIn) return;
  try {
    enhancerIn = audioCtx.createGain();
    enhancerComp = audioCtx.createDynamicsCompressor();
    enhancerBass = audioCtx.createBiquadFilter();
    enhancerBass.type = "lowshelf";
    enhancerBass.frequency.value = 80;
    enhancerVocal = audioCtx.createBiquadFilter();
    enhancerVocal.type = "peaking";
    enhancerVocal.frequency.value = 2500;
    enhancerVocal.Q.value = 1.2;
    enhancerAir = audioCtx.createBiquadFilter();
    enhancerAir.type = "highshelf";
    enhancerAir.frequency.value = 9000;
    enhancerSat = audioCtx.createWaveShaper();
    enhancerSat.oversample = "2x";
    enhancerLimiter = audioCtx.createDynamicsCompressor();
    enhancerLimiter.threshold.value = -1;
    enhancerLimiter.knee.value = 0;
    enhancerLimiter.ratio.value = 20;
    enhancerLimiter.attack.value = 0.005;
    enhancerLimiter.release.value = 0.05;
    enhancerIn.connect(enhancerComp);
    enhancerComp.connect(enhancerBass);
    enhancerBass.connect(enhancerVocal);
    enhancerVocal.connect(enhancerAir);
    enhancerAir.connect(enhancerSat);
    enhancerSat.connect(enhancerLimiter);
    enhancerLimiter.connect(eqBassNode);
  } catch {
    enhancerIn = null;
    enhancerComp = null;
    enhancerBass = null;
    enhancerVocal = null;
    enhancerAir = null;
    enhancerSat = null;
    enhancerLimiter = null;
  }
}

/** Park the enhancer nodes at neutral so a disabled chain colors nothing. */
function neutralizeEnhancerNodes(): void {
  if (!audioCtx) return;
  try {
    const t = audioCtx.currentTime;
    if (enhancerBass) enhancerBass.gain.setTargetAtTime(0, t, 0.02);
    if (enhancerVocal) enhancerVocal.gain.setTargetAtTime(0, t, 0.02);
    if (enhancerAir) enhancerAir.gain.setTargetAtTime(0, t, 0.02);
  } catch {
    /* context not running */
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
  setPan(panner, 0);
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
    setPan(panner, Math.sin((ctx.currentTime - start) * ((2 * Math.PI) / 3.2)));
    rotateRaf = requestAnimationFrame(tick);
  };
  rotateRaf = requestAnimationFrame(tick);
}

/** Activate a sound effect. Returns false if Web Audio isn't available. */
export function setAudioFilter(id: AudioFilterId): boolean {
  // Do not publish the requested filter until the graph is actually built.
  // Otherwise a failed initialization leaves hasAudioProcessing() true and
  // forces every later track through an effect path that cannot work.
  if (!ensureGraph()) return false;
  activeFilter = id;

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
  notifyEqChange();
}

export function setEqTreble(db: number): void {
  eqTreble = db;
  if (eqTrebleNode) eqTrebleNode.gain.value = db;
  notifyEqChange();
}

export function setEqBalance(v: number): void {
  eqBalance = Math.min(1, Math.max(-1, v));
  if (!eqMono) setPan(balanceNode, eqBalance);
  notifyEqChange();
}

export function setEqMono(mono: boolean): void {
  eqMono = mono;
  setPan(balanceNode, mono ? 0 : eqBalance);
  notifyEqChange();
}

/** One-shot EQ presets. */
export function applyEqPreset(preset: { bass: number; treble: number }): void {
  setEqBass(preset.bass);
  setEqTreble(preset.treble);
}

// --- 10-band graphic EQ -------------------------------------------------------

/** Clamp to the band range and apply one band's gain. */
export function setEqBand(index: number, db: number): void {
  if (index < 0 || index >= EQ_BAND_FREQUENCIES.length) return;
  const clamped = Math.min(EQ_BAND_MAX_DB, Math.max(EQ_BAND_MIN_DB, db));
  eqBands[index] = clamped;
  const node = eqBandNodes[index];
  if (node) {
    try {
      node.gain.value = clamped;
    } catch {
      /* context not running */
    }
  }
  notifyEqChange();
}

/** Apply a full 10-band curve at once (persisted settings restore path). */
export function setEqBands(values: number[]): void {
  for (let i = 0; i < EQ_BAND_FREQUENCIES.length; i++) {
    setEqBand(i, values[i] ?? 0);
  }
}

/** Copy of the current band curve, for persistence and UI. */
export function getEqBands(): number[] {
  return [...eqBands];
}

/** Flatten every band back to zero (the Reset button). */
export function resetEqBands(): void {
  setEqBands(EQ_BAND_FREQUENCIES.map(() => 0));
}

// --- vibe: reverb / distortion --------------------------------------------------

/** Set the reverb wet level, 0 (dry) to 1 (a small hall). */
export function setReverbMix(mix: number): void {
  reverbMix = Math.min(1, Math.max(0, mix));
  if (reverbWet) {
    try {
      reverbWet.gain.value = reverbMix;
    } catch {
      /* context not running */
    }
  }
  notifyEqChange();
}

export function getReverbMix(): number {
  return reverbMix;
}

/** Set the distortion drive, 0 (clean) to 100 (folded). */
export function setDistortion(amount: number): void {
  distortionAmount = Math.min(100, Math.max(0, amount));
  const mix = applyDistortionMix(distortionAmount);
  try {
    if (distortionShaper) {
      distortionShaper.curve = makeDistortionCurve(distortionAmount);
    }
    if (distortionWet) distortionWet.gain.value = mix.wet;
    if (postFxDry) postFxDry.gain.value = mix.dry;
  } catch {
    /* context not running */
  }
  notifyEqChange();
}

export function getDistortion(): number {
  return distortionAmount;
}

// --- echo ---------------------------------------------------------------------

/**
 * Set the echo level, 0 (dry) to 100 (melo's maximum). The delay/feedback
 * nodes run at melo's fixed character (300 ms, 35% regen); the slider drives
 * only how much of the delayed signal mixes back in.
 */
export function setEcho(amount: number): void {
  echoAmount = Math.min(100, Math.max(0, amount));
  if (echoWet) {
    try {
      echoWet.gain.value = echoAmount / 100;
    } catch {
      /* context not running */
    }
  }
  notifyEqChange();
}

export function getEcho(): number {
  return echoAmount;
}

// --- volume gain ----------------------------------------------------------------

/**
 * The user's output gain (0..2 — the "Volume gain" slider's 0–200%), applied
 * to `userGain` where every path sums, BEFORE normalization and the limiter:
 * boosts stay guarded against clipping, and the value always describes what
 * the listener actually hears.
 */
export function setVolumeGain(gain: number): void {
  volumeGain = Math.min(2, Math.max(0, gain));
  if (userGain) {
    try {
      userGain.gain.value = volumeGain;
    } catch {
      /* context not running */
    }
  }
  notifyEqChange();
}

export function getVolumeGain(): number {
  return volumeGain;
}

// --- volume normalization -------------------------------------------------------

/**
 * Enable or disable loudness normalization. Toggling OFF parks the gain at
 * unity AND makes the limiter transparent (ratio 1, threshold 0) — "off" must
 * be the same chain as before normalization existed.
 *
 * No eager `ensureGraph()` here: a startup restore runs before any user
 * gesture, and building the context outside a gesture leaves it suspended —
 * the recorded state is painted onto the nodes the moment the graph does
 * build (`ensureGraph` starts the loop for an already-enabled preference).
 */
export function setVolumeNormalization(enabled: boolean): void {
  volumeNormalization = enabled;
  applyNormalizationNodes();
  if (enabled) {
    if (normGain && audioCtx) startNormalizationLoop();
  } else {
    stopNormalizationLoop();
  }
  notifyEqChange();
}

export function isVolumeNormalizationEnabled(): boolean {
  return volumeNormalization;
}

/** Copy the current frequency magnitudes into `out` (0-255 per bin). */
export function readFrequencyData(node: AnalyserNode, out: Uint8Array): void {
  node.getByteFrequencyData(out as Uint8Array<ArrayBuffer>);
}

// --- transitions (crossfade) --------------------------------------------------

/** Cancel any fade automation and park a deck at an exact gain immediately. */
export function setDeckGainNow(slot: "a" | "b" | "auto", value: number): void {
  const d = decks;
  if (!d) return;
  const target = slot === "auto" ? activeDeck : slot;
  const gain = d[target].gain;
  if (!gain) return;
  try {
    gain.gain.cancelScheduledValues(0);
    gain.gain.setValueAtTime(value, audioCtx?.currentTime ?? 0);
  } catch {
    /* context not running */
  }
}

/** Put every deck back to full volume — used when a transition is abandoned. */
export function resetAllDeckGains(): void {
  setDeckGainNow("a", 1);
  setDeckGainNow("b", 1);
}

/**
 * Schedule a crossfade between the two decks using an equal-power curve.
 *
 * The curve is sampled and handed to Web Audio as a `Float32Array`, so the
 * actual audio follows the same sin/cos shape the unit tests assert on rather
 * than a straight line. A linear crossfade of two uncorrelated songs audibly
 * dips about 6dB in the middle (each track at half volume), which listeners
 * hear as a surge at the moment the new song takes over.
 *
 * Automation is sample-accurate, which is also what prevents clicks: the gain
 * moves continuously rather than stepping once per `timeupdate`.
 *
 * Returns false when the graph is not ready, so the caller falls back to
 * normal playback instead of starting a fade it cannot finish.
 */
export function scheduleCrossfade(
  outgoingSlot: "a" | "b",
  incomingSlot: "a" | "b",
  seconds: number,
  curve: (t: number) => { outgoing: number; incoming: number },
): boolean {
  const d = decks;
  const ctx = audioCtx;
  if (!d || !ctx || ctx.state !== "running") return false;
  const out = d[outgoingSlot].gain;
  const inc = d[incomingSlot].gain;
  if (!out || !inc) return false;
  const duration = Math.max(0.05, Math.min(seconds, 60));
  const steps = Math.max(2, Math.min(256, Math.ceil(duration * 40)));
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const g = curve(t);
    outCurve[i] = g.outgoing;
    inCurve[i] = g.incoming;
  }
  const now = ctx.currentTime;
  try {
    out.gain.cancelScheduledValues(now);
    inc.gain.cancelScheduledValues(now);
    try {
      // Hand the SAMPLED equal-power curve to Web Audio.
      //
      // This used to be a pair of `linearRampToValueAtTime` calls between the
      // curve's first and last samples, with the arrays above computed and
      // then discarded — so the actual fade was a straight line. That is
      // exactly the linear blend the equal-power curve exists to replace, and
      // it audibly sags ~6dB at the midpoint even though `fadeGains()` (the
      // only thing the unit tests looked at) is a correct sin/cos pair. The
      // sampled curve is what reaches the graph now.
      out.gain.setValueCurveAtTime(outCurve, now, duration);
      inc.gain.setValueCurveAtTime(inCurve, now, duration);
    } catch {
      // A WebView without `setValueCurveAtTime`. Degrade to the endpoint ramp
      // rather than refusing to fade at all; cancel again first in case the
      // curve landed on one deck before the second call threw.
      out.gain.cancelScheduledValues(now);
      inc.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(outCurve[0], now);
      inc.gain.setValueAtTime(inCurve[0], now);
      out.gain.linearRampToValueAtTime(outCurve[steps - 1], now + duration);
      inc.gain.linearRampToValueAtTime(inCurve[steps - 1], now + duration);
    }
  } catch {
    return false;
  }
  return true;
}

/** Which deck is currently live. Callers need this to know exactly what a
 * swap is about to replace, so the outgoing deck can be released afterwards.
 */
export function activeDeckSlot(): "a" | "b" {
  return activeDeck;
}

/** The deck that is NOT live — the one an incoming track is loaded onto. */
export function spareDeckSlot(): "a" | "b" {
  return activeDeck === "a" ? "b" : "a";
}

/**
 * A plain-English, live dump of what the `<audio>` decks are actually doing.
 *
 * "The song just keeps buffering" has been the least diagnosable report in the
 * project, because every explanation for it lives inside a media element the
 * app never reports on: `readyState` says whether bytes arrived, `networkState`
 * says whether the fetch is still running, `error` says why it gave up, and
 * `paused` says whether anything asked it to play. None of that reaches the UI,
 * so the only thing a listener could ever see was the word "buffering" —
 * identical whether the element had never received a byte, was waiting on a
 * slow range request, or had hard-failed with `MEDIA_ERR_NETWORK`.
 *
 * This turns that into one sentence naming the actual state, so the next
 * report starts from evidence instead of a fourth guess.
 */
export function describeDecks(): string {
  if (typeof window === "undefined") return "No window (server render).";
  const d = ensureDecks();
  const label = (slot: "a" | "b", el: HTMLAudioElement): string => {
    const live = slot === activeDeck;
    const where = el.currentSrc || el.src || "(no source)";
    const short = where.length > 60 ? `${where.slice(0, 57)}...` : where;
    const buffered = (() => {
      try {
        if (el.buffered.length === 0) return "none";
        return `${el.buffered.end(el.buffered.length - 1).toFixed(1)}s`;
      } catch {
        return "?";
      }
    })();
    const err = el.error
      ? ` ERROR ${el.error.code}: ${el.error.message || "no message"}`
      : "";
    return (
      `${live ? "LIVE" : "spare"} deck ${slot}: ` +
      `${el.paused ? "paused" : "playing"} at ${el.currentTime.toFixed(1)}s, ` +
      `readyState ${el.readyState}, networkState ${el.networkState}, ` +
      `buffered ${buffered}, src ${short}${err}`
    );
  };
  const parts = [label("a", d.a.el), label("b", d.b.el)];
  const graph = audioCtx
    ? `audio graph: ${audioCtx.state}, chain built: ${gainOut ? "yes" : "no"}`
    : "audio graph: not built";
  return `${parts.join(" · ")} · ${graph}`;
}

/**
 * True when a real crossfade is possible right now: both decks are attached to
 * a RUNNING audio context. A suspended context means silence, so fading into
 * one would be worse than not fading at all.
 *
 * This now ATTEMPTS to attach a deck that is missing rather than simply
 * reporting false, so one unattached deck no longer disables crossfade for the
 * rest of the session.
 */
export function canCrossfadeNow(): boolean {
  return crossfadeReadiness().ok;
}

export type CrossfadeRefusal =
  /** The graph was never built (and may never build on this device). */
  | "no-graph"
  /** A context exists but is not running, so fading would fade to silence. */
  | "context-suspended"
  /** A deck is missing its gain/source and could not be re-attached. */
  | "deck-detached";

export type CrossfadeReadiness =
  | { ok: true }
  | { ok: false; reason: CrossfadeRefusal; detail?: string };

/**
 * WHY a crossfade is impossible right now.
 *
 * `canCrossfadeNow()` collapsed three very different failures into `false`, and
 * every one of them presented identically: normal audio, a hard cut, and a
 * couple of seconds of silence while the next stream resolved. There was
 * nothing on screen and nothing to tell a bug report apart from a browser that
 * simply cannot do it.
 *
 * Splitting the reasons is what makes this debuggable at all.
 */
export function crossfadeReadiness(): CrossfadeReadiness {
  const d = decks;
  if (!d || !audioCtx) return { ok: false, reason: "no-graph" };
  if (audioCtx.state !== "running") {
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return { ok: false, reason: "context-suspended", detail: audioCtx.state };
  }
  for (const slot of ["a", "b"] as const) {
    if (!d[slot].gain && !ensureDeckAttached(slot)) {
      return { ok: false, reason: "deck-detached", detail: slot };
    }
  }
  return d.a.gain && d.b.gain
    ? { ok: true }
    : { ok: false, reason: "deck-detached" };
}

/**
 * Tear a deck down after it has been faded out (or a transition was
 * abandoned): stop it and free the buffer.
 *
 * WITHOUT dropping the graph. `createMediaElementSource(el)` may be called AT
 * MOST ONCE per HTMLAudioElement for the lifetime of that element, and that
 * call permanently reroutes the element's audio into the returned node. This
 * function used to disconnect that node and null both source and gain, so the
 * released deck was SILENT FOREVER and `canCrossfadeNow()` — which needs a gain
 * on both decks — became permanently false. Crossfade could therefore run at
 * most once per page load, and the second crossfade of a session not only
 * failed to fade, it loaded the incoming track onto an element that could not
 * make a sound. Release the CONTENT; keep the graph wired. (The line this
 * replaces used to justify dropping the source as a memory-leak fix: the leak
 * it described was real, but the cure was permanent silence for a track.)
 * alive for the whole session — see above for why that reasoning was wrong.
 *
 */
export function releaseDeck(slot: "a" | "b"): void {
  const d = decks;
  if (!d || typeof window === "undefined") return;
  const deck = d[slot];
  if (slot === activeDeck) return; // never release the live deck
  try {
    deck.el.pause();
  } catch {
    /* ignore */
  }
  releaseAudioSource(deck.el);
  // Neutralise the transition multiplier WITHOUT unwiring the node, so this
  // deck is immediately clean if it is ever used for playback again.
  setDeckGainNow(slot, 1);
}

/**
 * Make sure a deck is attached to the shared graph with a live gain node.
 *
 * `releaseDeck` no longer orphans a deck, but this is the recovery path: if a
 * deck was ever left unattached (an element that existed before the graph was
 * built, or a half-built graph), a crossfade would otherwise be refused for the
 * rest of the session. Returns false when the deck genuinely cannot blend, so
 * the caller can fall back to normal playback instead of fading to silence.
 */
export function ensureDeckAttached(slot: "a" | "b"): boolean {
  const d = decks;
  const ctx = audioCtx;
  if (!d || !ctx || !eqBassNode) return false;
  const deck = d[slot];
  try {
    if (!deck.source) {
      deck.source = ctx.createMediaElementSource(deck.el);
      mediaSourceAttached = true;
    }
    if (!deck.gain) {
      deck.gain = ctx.createGain();
      deck.gain.gain.value = 1;
      deck.source.connect(deck.gain);
      connectDeckGainToChain(deck.gain);
    }
    return true;
  } catch {
    // InvalidStateError means this element was ALREADY captured by an earlier
    // graph whose nodes are gone. There is no legal way to re-capture it, so
    // the honest answer is that this deck cannot blend.
    return !!deck.source;
  }
}

/**
 * Return every USER-CONTROLLED engine value to its neutral default.
 *
 * The engine's settings live in module-level variables, which is exactly right
 * in the app — a hot reload must not drop the listener's EQ — and exactly
 * wrong inside one test process, where bun shares canonical module instances
 * across test FILES. A test asserting "a persisted tape speed survives
 * hydration" could otherwise inherit whatever tape state an earlier file left
 * behind, and fail on a run order it never chose.
 *
 * This goes through the PUBLIC setters rather than assigning the variables, so
 * an already-built graph receives the same neutral values (a reset that left the
 * EQ filters at their old dB would only look reset).
 *
 * Deliberately NOT reset: the AudioContext, the decks, the graph and
 * `graphBuildFailed`. One MediaElementSource per element is a spec limit, so a
 * "reset" that closed the context or re-captured a deck would make the graph
 * unrecoverable for the rest of the session — a worse defect than the ordering
 * noise this fixes. `graphBuildFailed` is a fact about the device, not user
 * state, so it stays true once it is true.
 */
export function resetAudioEngine(): void {
  setEqBass(0);
  setEqTreble(0);
  setEqBalance(0);
  setEqMono(false);
  resetEqBands();
  // 1.00x hands the rate back to preserving mode, so this clears tapeMode too.
  setTapeSpeed(1);
  setDeckPitch(0);
  setRatePreservesPitch(true);
  setReverbMix(0);
  setDistortion(0);
  setEcho(0);
  setVolumeGain(1);
  setEnhancer(false, { engine: "harmonic", vocal: 0, air: 0, bass: 0 });
  setVolumeNormalization(false);
  setAudioFilter("off");
  // The 8D orbit is a rAF loop; leaving it running would keep panning a deck
  // that is supposed to be neutral, and in a test process it outlives the test.
  stopRotation();
}
