import { create } from "zustand";

import {
  applyEqPreset,
  getDeckPitch,
  getDistortion,
  getEcho,
  getEnhancerSettings,
  getEqBands,
  getRatePreservesPitch,
  getReverbMix,
  getSpeed,
  getTapeSpeed,
  getVolumeGain,
  isEnhancerEnabled,
  isVolumeNormalizationEnabled,
  resetEqBands,
  setDeckPitch,
  setDeckRate,
  setDistortion,
  setEcho,
  setEqBalance,
  setEqBand,
  setEqBands,
  setEqBass,
  setEqMono,
  setEqTreble,
  setEnhancer,
  setRatePreservesPitch,
  setReverbMix,
  setTapeSpeed,
  setVolumeGain,
  setVolumeNormalization,
  type EnhancerEngineId,
} from "@/lib/audio";
import {
  DEFAULT_AUDIO_SETTINGS,
  EQ_PRESETS,
  loadAudioSettings,
  normalizeAudioSettings,
  saveAudioSettings,
  type AudioSettings,
} from "@/lib/audioSettings";
import { ENHANCER_PRESETS } from "@/lib/audio";

/** Enhancer knob key → the model field that stores it. */
const ENHANCER_FIELD: Record<"vocal" | "air" | "bass", keyof AudioSettings> = {
  vocal: "enhancerVocal",
  air: "enhancerAir",
  bass: "enhancerBass",
};

/**
 * The one store behind every audio-customization surface (the Audio panel,
 * the settings page's Audio section, the fullscreen speed/effects controls).
 *
 * Each action does the same three things in the same order: clamp, apply to
 * the engine, persist. The engine — not this store — is the arbiter of what
 * is audible; the store mirrors what the engine accepted so the UI can never
 * show a value the audio did not receive. Values that the engine records even
 * before a graph exists (every setter here does) are painted onto the nodes
 * the moment `ensureGraph()` builds one, so a startup restore is safe.
 *
 * Playback speed's HUD-side bookkeeping (`rate` in the player store, the
 * `ss.rate` key, the YouTube engine's rate sync) stays in the player store;
 * the panel calls both stores. They are deliberately not merged: the player
 * store is 6k lines of playback machinery and this slice wants none of it.
 */
interface AudioSettingsStore {
  audio: AudioSettings;
  /** True while ANY setting differs from its default (melo's modified dot). */
  modified: boolean;

  setSpeed(v: number): void;
  setSpeedPitch(v: number): void;
  setPitch(v: number): void;
  setVolumeGain(v: number): void;
  setReverb(v: number): void;
  setDistortion(v: number): void;
  setEcho(v: number): void;
  setEqBass(v: number): void;
  setEqTreble(v: number): void;
  setEqBalance(v: number): void;
  setEqMono(v: boolean): void;
  setEqBand(index: number, v: number): void;
  setEqPreset(id: string): void;
  resetEqBands(): void;
  setEnhancerEnabled(v: boolean): void;
  setEnhancerEngine(id: EnhancerEngineId): void;
  setEnhancerParam(key: "vocal" | "air" | "bass", v: number): void;
  setEnhancerPreset(id: string): void;
  setNormalize(v: boolean): void;
  setKeepKey(v: boolean): void;
  /** Restore every setting to its default and apply the result. */
  resetAll(): void;
}

const isModified = (a: AudioSettings): boolean => {
  const d = DEFAULT_AUDIO_SETTINGS;
  return (
    a.speed !== d.speed ||
    a.speedPitch !== d.speedPitch ||
    a.pitch !== d.pitch ||
    a.keepKey !== d.keepKey ||
    a.volumeGain !== d.volumeGain ||
    a.reverb !== d.reverb ||
    a.distortion !== d.distortion ||
    a.echo !== d.echo ||
    a.eqBass !== d.eqBass ||
    a.eqTreble !== d.eqTreble ||
    a.eqBalance !== d.eqBalance ||
    a.eqMono !== d.eqMono ||
    a.eqBands.some((band) => band !== 0) ||
    a.eqPreset !== d.eqPreset ||
    a.enhancerEnabled !== d.enhancerEnabled ||
    a.enhancerEngine !== d.enhancerEngine ||
    a.enhancerVocal !== d.enhancerVocal ||
    a.enhancerAir !== d.enhancerAir ||
    a.enhancerBass !== d.enhancerBass ||
    a.normalize !== d.normalize
  );
};

/**
 * Read the persisted (or migrated) settings into the engine. Runs once, at
 * store construction — engine setters record state before any graph exists,
 * and the graph paints it on build, so this is safe outside a user gesture.
 */
function initialAudio(): AudioSettings {
  const loaded = loadAudioSettings();
  applyToEngine(loaded);
  return loaded;
}

/** Push a settings snapshot through the engine's setters. */
function applyToEngine(a: AudioSettings): void {
  // Exactly one of the two speed settings owns the rate (melo's mutual
  // exclusion); the other reads 1.0. The keep-the-key preference is the
  // engine's own state, changed only through setKeepKey.
  if (a.speedPitch !== 1) setTapeSpeed(a.speedPitch);
  else setDeckRate(a.speed);
  setDeckPitch(a.pitch);
  setRatePreservesPitch(a.keepKey);
  setVolumeGain(a.volumeGain / 100);
  setReverbMix(a.reverb / 100);
  setDistortion(a.distortion);
  setEcho(a.echo);
  setEqBass(a.eqBass);
  setEqTreble(a.eqTreble);
  setEqBalance(a.eqBalance);
  setEqMono(a.eqMono);
  setEqBands(a.eqBands);
  setEnhancer(a.enhancerEnabled, {
    engine: a.enhancerEngine,
    vocal: a.enhancerVocal,
    air: a.enhancerAir,
    bass: a.enhancerBass,
  });
  setVolumeNormalization(a.normalize);
}

export const useAudioSettingsStore = create<AudioSettingsStore>()((set, get) => {  const audio = initialAudio();
  return {
    audio,
    modified: isModified(audio),

    setSpeed(v) {
      // Mutual exclusion, as in melo: the preserving slider takes ownership
      // and the tape slider reads 1.00x again.
      const next = normalizeAudioSettings({ ...get().audio, speed: v, speedPitch: 1 });
      setDeckRate(next.speed);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setSpeedPitch(v) {
      const next = normalizeAudioSettings({ ...get().audio, speedPitch: v, speed: 1 });
      setTapeSpeed(next.speedPitch);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setPitch(v) {
      const next = normalizeAudioSettings({ ...get().audio, pitch: Math.round(v) });
      setDeckPitch(next.pitch);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setKeepKey(v) {
      const next = normalizeAudioSettings({ ...get().audio, keepKey: v });
      setRatePreservesPitch(next.keepKey);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setVolumeGain(v) {
      const next = normalizeAudioSettings({ ...get().audio, volumeGain: Math.round(v) });
      setVolumeGain(next.volumeGain / 100);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setReverb(v) {
      const next = normalizeAudioSettings({ ...get().audio, reverb: Math.round(v) });
      setReverbMix(next.reverb / 100);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setDistortion(v) {
      const next = normalizeAudioSettings({ ...get().audio, distortion: Math.round(v) });
      setDistortion(next.distortion);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEcho(v) {
      const next = normalizeAudioSettings({ ...get().audio, echo: Math.round(v) });
      setEcho(next.echo);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqBass(v) {
      const next = normalizeAudioSettings({ ...get().audio, eqBass: v });
      setEqBass(next.eqBass);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqTreble(v) {
      const next = normalizeAudioSettings({ ...get().audio, eqTreble: v });
      setEqTreble(next.eqTreble);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqBalance(v) {
      const next = normalizeAudioSettings({ ...get().audio, eqBalance: v });
      setEqBalance(next.eqBalance);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqMono(v) {
      const next = normalizeAudioSettings({ ...get().audio, eqMono: v });
      setEqMono(next.eqMono);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqBand(index, v) {
      const bands = [...get().audio.eqBands];
      bands[index] = v;
      const next = normalizeAudioSettings({ ...get().audio, eqBands: bands, eqPreset: "custom" });
      setEqBand(index, next.eqBands[index]);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEqPreset(id) {
      const preset = EQ_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      const next = normalizeAudioSettings({
        ...get().audio,
        eqBass: preset.bass,
        eqTreble: preset.treble,
        eqPreset: preset.id,
      });
      applyEqPreset({ bass: next.eqBass, treble: next.eqTreble });
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    resetEqBands() {
      const next = normalizeAudioSettings({
        ...get().audio,
        eqBands: DEFAULT_AUDIO_SETTINGS.eqBands,
        eqPreset: get().audio.eqPreset === "custom" ? "flat" : get().audio.eqPreset,
      });
      resetEqBands();
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEnhancerEnabled(v) {
      const next = normalizeAudioSettings({ ...get().audio, enhancerEnabled: v });
      setEnhancer(v);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEnhancerEngine(id) {
      const next = normalizeAudioSettings({ ...get().audio, enhancerEngine: id });
      setEnhancer(next.enhancerEnabled, { engine: next.enhancerEngine });
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEnhancerParam(key, v) {
      const field = ENHANCER_FIELD[key];
      const next = normalizeAudioSettings({ ...get().audio, [field]: Math.round(v) });
      setEnhancer(next.enhancerEnabled, { [key]: next[field] as number });
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setEnhancerPreset(id) {
      const preset = ENHANCER_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      const next = normalizeAudioSettings({
        ...get().audio,
        enhancerVocal: preset.vocal,
        enhancerAir: preset.air,
        enhancerBass: preset.bass,
      });
      setEnhancer(
        next.enhancerEnabled,
        { vocal: next.enhancerVocal, air: next.enhancerAir, bass: next.enhancerBass },
      );
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    setNormalize(v) {
      const next = normalizeAudioSettings({ ...get().audio, normalize: v });
      setVolumeNormalization(next.normalize);
      saveAudioSettings(next);
      set({ audio: next, modified: isModified(next) });
    },

    resetAll() {
      const next = normalizeAudioSettings({ ...DEFAULT_AUDIO_SETTINGS });
      applyToEngine(next);
      saveAudioSettings(next);
      set({ audio: next, modified: false });
    },
  };
});

/**
 * Load the persisted settings and apply them to the engine and the store.
 *
 * This genuinely RE-hydrates on every call (not just the first): the store's
 * construction at import already runs the same sequence, but `wireAudio`
 * calls this again as its explicit guarantee, and re-applying identical
 * values is free — engine setters are idempotent, and `saveAudioSettings`
 * is not triggered here, so a restart can never rewrite what it just read.
 * Calling it after the storage keys change externally is therefore safe and
 * correct.
 */
export function hydrateAudioSettings(): void {
  const loaded = loadAudioSettings();
  applyToEngine(loaded);
  useAudioSettingsStore.setState({ audio: loaded, modified: isModified(loaded) });
}

/**
 * Record a speed change made by a surface that talks to the player store
 * directly (the fullscreen speed dropdown): the rate itself is the same
 * number, but ownership moves to the preserving "Speed" setting — the same
 * mutual exclusion the panel's own slider actions apply. Without this, the
 * panel would reopen showing a stale speed while the decks play another.
 */
export function noteExternalSpeed(rate: number): void {
  const s = useAudioSettingsStore.getState();
  if (s.audio.speed === rate && s.audio.speedPitch === 1) return;
  const next = normalizeAudioSettings({ ...s.audio, speed: rate, speedPitch: 1 });
  saveAudioSettings(next);
  useAudioSettingsStore.setState({ audio: next, modified: isModified(next) });
}

/**
 * Sync the store's snapshot from the engine's actual state. The panel does
 * this when it opens, so the UI shows what the engine holds even if a value
 * was changed outside the store (a surface missed in the migration, a test,
 * or a future code path) — the drift the audit called out, closed the other
 * direction.
 */
export function syncFromEngine(): void {
  const s = useAudioSettingsStore.getState();
  const enhancer = getEnhancerSettings();
  const engineEcho = normalizeAudioSettings({
    ...s.audio,
    speed: getSpeed(),
    speedPitch: getTapeSpeed(),
    pitch: getDeckPitch(),
    keepKey: getRatePreservesPitch(),
    volumeGain: Math.round(getVolumeGain() * 100),
    reverb: Math.round(getReverbMix() * 100),
    distortion: getDistortion(),
    echo: getEcho(),
    eqBands: getEqBands(),
    enhancerEnabled: isEnhancerEnabled(),
    enhancerEngine: enhancer.engine,
    enhancerVocal: enhancer.vocal,
    enhancerAir: enhancer.air,
    enhancerBass: enhancer.bass,
    normalize: isVolumeNormalizationEnabled(),
  });
  useAudioSettingsStore.setState({
    audio: engineEcho,
    modified: isModified(engineEcho),
  });
}
