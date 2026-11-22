// ---------------------------------------------------------------------------
// The audio customization model — one typed, validated shape for every
// setting the Audio panel shows, with explicit defaults and a migration path
// from the pre-panel localStorage keys.
//
// Why this module exists: the EQ-family settings used to live as scattered
// component-local `useState` blobs seeded from four different localStorage
// keys (`ss.eq`, `ss.pitch`, `ss.reverb`, `ss.distortion`, `ss.normalize`).
// A missing field silently rendered as "zero", nothing re-read the storage
// when another surface changed a value, and the panel and the engine could
// drift apart without anything noticing. Every surface now reads and writes
// ONE object of THIS type; the engine keeps its own module state exactly as
// before, and the store applies these values through the engine's setters.
//
// Persistence contract:
//   `ss.audioSettings` — a versioned JSON blob, the source of truth.
//   `ss.eq` / `ss.pitch` / `ss.reverb` / `ss.distortion` / `ss.normalize`
//     — legacy keys, read once by the migration, never written again.
//   `ss.rate` — stays owned by the player store (it is the playback-speed
//     display the HUD syncs against); the model mirrors it but never writes it.
//
// Ranges are melo's, ported verbatim:
//   speed / speed (pitch): 0.5–2.0 step 0.05 · pitch: ±12 semitones step 1
//   volume gain: 0–200% · FX: 0–100% · EQ shelves and bands: ±12 dB
//   enhancer knobs: ±50% · sleep: melo's presets plus SYNQ's queue mode
// ---------------------------------------------------------------------------

export const SPEED_MIN = 0.5;
export const SPEED_MAX = 2;
export const SPEED_STEP = 0.05;
export const PITCH_MIN = -12;
export const PITCH_MAX = 12;
export const VOLUME_GAIN_MIN = 0; // percent
export const VOLUME_GAIN_MAX = 200;
export const FX_MIN = 0;
export const FX_MAX = 100;
export const EQ_MIN_DB = -12;
export const EQ_MAX_DB = 12;
export const ENHANCER_MIN = -50;
export const ENHANCER_MAX = 50;

export type EnhancerEngine = "harmonic" | "air" | "depth";

export const EQ_BAND_LABELS = [
  "32",
  "64",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
] as const;

/** The EQ presets SYNQ ships (label + bass/treble shelf gains, in dB). */
export const EQ_PRESETS: { id: string; label: string; bass: number; treble: number }[] = [
  { id: "flat", label: "Flat", bass: 0, treble: 0 },
  { id: "bass-boost", label: "Bass Boost", bass: 10, treble: 0 },
  { id: "treble-boost", label: "Treble Boost", bass: 0, treble: 8 },
  { id: "vocal", label: "Vocal", bass: -3, treble: 5 },
  { id: "rock", label: "Rock", bass: 5, treble: 4 },
  { id: "pop", label: "Pop", bass: 3, treble: 3 },
  { id: "classical", label: "Classical", bass: 1, treble: 2 },
  { id: "electronic", label: "Electronic", bass: 8, treble: 3 },
];

/** The persistent audio settings — everything the Audio panel shows. */
export interface AudioSettings {
  /** "Speed": pitch-preserving playback rate. 1 = off. */
  speed: number;
  /** Tape-style "Speed (pitch)" rate that moves the key. 1 = off. */
  speedPitch: number;
  /** Semitone shift riding on the tape speed. 0 = off. */
  pitch: number;
  /** "Speed keeps the key" — whether the Speed slider preserves pitch. */
  keepKey: boolean;
  /** Output gain in percent, 100 = unity. Applied pre-limiter. */
  volumeGain: number;
  /** Reverb wet level, 0–100. */
  reverb: number;
  /** Distortion drive, 0–100. */
  distortion: number;
  /** Echo wet level, 0–100. */
  echo: number;
  /** Bass shelf (low shelf), dB. */
  eqBass: number;
  /** Treble shelf (high shelf), dB. */
  eqTreble: number;
  /** Stereo balance, -1 (left) .. 1 (right). */
  eqBalance: number;
  /** Collapse to mono. */
  eqMono: boolean;
  /** The 10 peaking bands, dB, 32 Hz → 16 kHz. */
  eqBands: number[];
  /** Which EQ preset is active — "custom" once any slider moves. */
  eqPreset: string;
  /** The enhancer chain toggle + its knobs. */
  enhancerEnabled: boolean;
  enhancerEngine: EnhancerEngine;
  enhancerVocal: number;
  enhancerAir: number;
  enhancerBass: number;
  /** Loudness normalization (the live RMS loop). */
  normalize: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  speed: 1,
  speedPitch: 1,
  pitch: 0,
  keepKey: true,
  volumeGain: 100,
  reverb: 0,
  distortion: 0,
  echo: 0,
  eqBass: 0,
  eqTreble: 0,
  eqBalance: 0,
  eqMono: false,
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreset: "flat",
  enhancerEnabled: false,
  enhancerEngine: "harmonic",
  enhancerVocal: 0,
  enhancerAir: 0,
  enhancerBass: 0,
  normalize: false,
};

/** Storage key for the versioned blob. */
export const AUDIO_SETTINGS_KEY = "ss.audioSettings";

const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  Math.round(clamp(v, min, max, fallback));

/** Validate one stored band list into exactly 10 clamped numbers. */
function normalizeBands(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_AUDIO_SETTINGS.eqBands];
  return EQ_BAND_LABELS.map((_, i) =>
    clampInt(raw[i], EQ_MIN_DB, EQ_MAX_DB, 0),
  );
}

const ENHANCER_ENGINES: EnhancerEngine[] = ["harmonic", "air", "depth"];

/**
 * Coerce ANY value into a valid `AudioSettings` — unknown, malformed, stale,
 * hand-edited or future-shaped input all degrades to defaults per field
 * rather than leaking `null`/`undefined` into a slider or an audio node.
 */
export function normalizeAudioSettings(raw: unknown): AudioSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const engine = src.enhancerEngine;
  const out: AudioSettings = {
    speed: clamp(src.speed, SPEED_MIN, SPEED_MAX, DEFAULT_AUDIO_SETTINGS.speed),
    speedPitch: clamp(
      src.speedPitch,
      SPEED_MIN,
      SPEED_MAX,
      DEFAULT_AUDIO_SETTINGS.speedPitch,
    ),
    pitch: clampInt(src.pitch, PITCH_MIN, PITCH_MAX, DEFAULT_AUDIO_SETTINGS.pitch),
    keepKey: src.keepKey !== false,
    volumeGain: clampInt(
      src.volumeGain,
      VOLUME_GAIN_MIN,
      VOLUME_GAIN_MAX,
      DEFAULT_AUDIO_SETTINGS.volumeGain,
    ),
    reverb: clampInt(src.reverb, FX_MIN, FX_MAX, DEFAULT_AUDIO_SETTINGS.reverb),
    distortion: clampInt(
      src.distortion,
      FX_MIN,
      FX_MAX,
      DEFAULT_AUDIO_SETTINGS.distortion,
    ),
    echo: clampInt(src.echo, FX_MIN, FX_MAX, DEFAULT_AUDIO_SETTINGS.echo),
    eqBass: clamp(src.eqBass, EQ_MIN_DB, EQ_MAX_DB, DEFAULT_AUDIO_SETTINGS.eqBass),
    eqTreble: clamp(
      src.eqTreble,
      EQ_MIN_DB,
      EQ_MAX_DB,
      DEFAULT_AUDIO_SETTINGS.eqTreble,
    ),
    eqBalance: clamp(src.eqBalance, -1, 1, DEFAULT_AUDIO_SETTINGS.eqBalance),
    eqMono: src.eqMono === true,
    eqBands: normalizeBands(src.eqBands),
    eqPreset: typeof src.eqPreset === "string" ? src.eqPreset : "flat",
    enhancerEnabled: src.enhancerEnabled === true,
    enhancerEngine:
      typeof engine === "string" && ENHANCER_ENGINES.includes(engine as EnhancerEngine)
        ? (engine as EnhancerEngine)
        : DEFAULT_AUDIO_SETTINGS.enhancerEngine,
    enhancerVocal: clampInt(
      src.enhancerVocal,
      ENHANCER_MIN,
      ENHANCER_MAX,
      DEFAULT_AUDIO_SETTINGS.enhancerVocal,
    ),
    enhancerAir: clampInt(
      src.enhancerAir,
      ENHANCER_MIN,
      ENHANCER_MAX,
      DEFAULT_AUDIO_SETTINGS.enhancerAir,
    ),
    enhancerBass: clampInt(
      src.enhancerBass,
      ENHANCER_MIN,
      ENHANCER_MAX,
      DEFAULT_AUDIO_SETTINGS.enhancerBass,
    ),
    normalize: src.normalize === true,
  };
  // The model's own invariant, enforced against ANY input: exactly one of the
  // two speed settings may be non-1.0 (melo's mutual exclusion). A hand-edited
  // or corrupt blob carrying both would otherwise render two non-default
  // sliders while the engine honors only the tape one.
  if (out.speedPitch !== 1) out.speed = 1;
  return out;
}

/**
 * The legacy keys the panel's predecessor used, in their own shapes. Read
 * ONCE by `loadAudioSettings` when no versioned blob exists yet, so a
 * listener's existing EQ curve, pitch and vibe settings survive the upgrade.
 */
function migrateLegacy(): AudioSettings | null {
  let legacy: AudioSettings | null = null;
  try {
    const eqRaw = localStorage.getItem("ss.eq");
    if (eqRaw) {
      const eq = JSON.parse(eqRaw) as {
        bass?: unknown;
        treble?: unknown;
        balance?: unknown;
        mono?: unknown;
        bands?: unknown;
      };
      legacy = normalizeAudioSettings({
        ...DEFAULT_AUDIO_SETTINGS,
        eqBass: eq.bass,
        eqTreble: eq.treble,
        eqBalance: eq.balance,
        eqMono: eq.mono === true,
        eqBands: eq.bands,
      });
    }
  } catch {
    /* malformed legacy blob — fall through to the other keys */
  }
  const pick = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  // The playback speed was persistable long before the pitch preference
  // existed, so ss.rate must migrate on its own — a session with only
  // ss.rate = 1.35 would otherwise lose its speed in the upgrade. A MISSING
  // key is not a value: Number(null) is 0, which would clamp to 0.5 and
  // silently half-speed every fresh session.
  const rateRaw = pick("ss.rate");
  const rate = rateRaw === null ? 1 : clamp(Number(rateRaw), SPEED_MIN, SPEED_MAX, 1);
  let preserve: boolean | null = null;
  const pitchRaw = pick("ss.pitch");
  if (pitchRaw) {
    try {
      const pitch = JSON.parse(pitchRaw) as { semitones?: unknown; preserve?: unknown };
      const semitones = clampInt(
        pitch.semitones,
        PITCH_MIN,
        PITCH_MAX,
        DEFAULT_AUDIO_SETTINGS.pitch,
      );
      legacy = { ...(legacy ?? DEFAULT_AUDIO_SETTINGS), pitch: semitones };
      preserve = pitch.preserve === false ? false : true;
    } catch {
      /* malformed pitch blob — keep whatever the EQ migration produced */
    }
  }
  if (rate !== 1) {
    // preserve:false meant the listener's speed choice was tape-style —
    // expressed here as the speedPitch setting carrying that rate.
    legacy = {
      ...(legacy ?? DEFAULT_AUDIO_SETTINGS),
      speed: preserve === false ? 1 : rate,
      speedPitch: preserve === false ? rate : 1,
      keepKey: preserve !== false,
    };
  } else if (preserve === false) {
    legacy = { ...(legacy ?? DEFAULT_AUDIO_SETTINGS), keepKey: false };
  }
  const reverb = Number(pick("ss.reverb"));
  if (Number.isFinite(reverb) && reverb > 0) {
    legacy = { ...(legacy ?? DEFAULT_AUDIO_SETTINGS), reverb: clampInt(reverb, FX_MIN, FX_MAX, 0) };
  }
  const distortion = Number(pick("ss.distortion"));
  if (Number.isFinite(distortion) && distortion > 0) {
    legacy = {
      ...(legacy ?? DEFAULT_AUDIO_SETTINGS),
      distortion: clampInt(distortion, FX_MIN, FX_MAX, 0),
    };
  }
  if (pick("ss.normalize") === "1") {
    legacy = { ...(legacy ?? DEFAULT_AUDIO_SETTINGS), normalize: true };
  }
  return legacy;
}

/** Load the settings, migrating the legacy keys when the blob is absent. */
export function loadAudioSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (raw) return normalizeAudioSettings(JSON.parse(raw));
  } catch {
    /* malformed blob — fall through to the legacy migration */
  }
  const migrated = migrateLegacy();
  // Piped through the validator so every field is clamped AND the band list
  // is a fresh array — a shallow default spread would hand callers the
  // DEFAULT_AUDIO_SETTINGS.eqBands reference itself, and one mutation would
  // poison the defaults for the rest of the session.
  return normalizeAudioSettings(migrated ?? DEFAULT_AUDIO_SETTINGS);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Drop a pending debounced save WITHOUT writing it.
 *
 * `saveAudioSettings` is debounced (300ms) through a module-level timer, so a
 * caller that changes settings and then hands control elsewhere leaves a write
 * armed. That write reads `localStorage` when it FIRES, not when it was
 * scheduled — so in a test process, where several test FILES share this module
 * but each installs its own window, the late write lands in the next file's
 * freshly seeded storage and replaces its fixture. Cancelling first makes the
 * next file's starting state its own.
 */
export function cancelPendingAudioSettingsSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

/**
 * Persist the settings (debounced, melo's 300 ms) so a slider drag does not
 * serialize on every input event. Writes only the versioned blob — the
 * legacy keys are never resurrected.
 */
export function saveAudioSettings(settings: AudioSettings): void {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage full or blocked — the session keeps its in-memory state */
    }
  }, 300);
}

/** `1.35x` / `0.82x` — the speed value label. */
export function formatSpeed(v: number): string {
  return `${v.toFixed(2)}x`;
}

/** `+3 st` / `0 st` / `−2 st` — the pitch value label (melo's unit). */
export function formatPitch(v: number): string {
  return `${v > 0 ? "+" : ""}${v} st`;
}

/** `+4 dB` / `0 dB` — EQ and enhancer labels keep their sign when boosted. */
export function formatDb(v: number): string {
  return `${v > 0 ? "+" : ""}${Math.round(v)} dB`;
}

/** `150%` / `100%` / `0%` — percent labels for gain, FX and enhancer knobs. */
export function formatPercent(v: number): string {
  return `${Math.round(v)}%`;
}
