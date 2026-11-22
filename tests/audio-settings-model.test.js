import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The audio settings MODEL: typed defaults, per-field validation, and the
 * migration from the pre-panel localStorage keys.
 *
 * These run against a real happy-dom localStorage because the whole point is
 * what actually comes OUT of storage: a malformed, stale or hand-edited blob
 * must degrade to defaults per field — never leak null/undefined into a
 * slider or an audio node, and never lose a listener's existing settings to
 * the upgrade.
 */

const win = new Window({ url: "https://example.test/" });
globalThis.window = win;
globalThis.localStorage = win.localStorage;

const settings = await import(`../src/lib/audioSettings.ts?fresh=${Math.random()}`);

function clearStorage() {
  for (const key of [
    "ss.audioSettings",
    "ss.eq",
    "ss.pitch",
    "ss.rate",
    "ss.reverb",
    "ss.distortion",
    "ss.normalize",
  ]) {
    win.localStorage.removeItem(key);
  }
}

describe("the audio settings defaults", () => {
  test("every field has an explicit, valid default — nothing is null", () => {
    const d = settings.DEFAULT_AUDIO_SETTINGS;
    expect(d.speed).toBe(1);
    expect(d.speedPitch).toBe(1);
    expect(d.pitch).toBe(0);
    expect(d.keepKey).toBe(true);
    expect(d.volumeGain).toBe(100);
    expect(d.reverb).toBe(0);
    expect(d.distortion).toBe(0);
    expect(d.echo).toBe(0);
    expect(d.eqBass).toBe(0);
    expect(d.eqTreble).toBe(0);
    expect(d.eqBalance).toBe(0);
    expect(d.eqMono).toBe(false);
    expect(d.eqBands).toHaveLength(10);
    expect(d.eqBands.every((v) => v === 0)).toBe(true);
    expect(d.eqPreset).toBe("flat");
    expect(d.enhancerEnabled).toBe(false);
    expect(d.enhancerEngine).toBe("harmonic");
    expect(d.enhancerVocal).toBe(0);
    expect(d.enhancerAir).toBe(0);
    expect(d.enhancerBass).toBe(0);
    expect(d.normalize).toBe(false);
  });

  test("the band plan matches the engine: 32 Hz to 16 kHz", () => {
    expect(settings.EQ_BAND_LABELS).toEqual([
      "32", "64", "125", "250", "500", "1k", "2k", "4k", "8k", "16k",
    ]);
  });
});

describe("normalizeAudioSettings", () => {
  test("unknown, null and non-object input all become the defaults", () => {
    for (const bad of [undefined, null, 42, "x", [], {}]) {
      const out = settings.normalizeAudioSettings(bad);
      expect(out.speed).toBe(1);
      expect(out.volumeGain).toBe(100);
      expect(out.eqBands).toHaveLength(10);
      expect(out.eqMono).toBe(false);
    }
  });

  test("every numeric field is clamped to its documented range", () => {
    const out = settings.normalizeAudioSettings({
      speedPitch: -4,
      pitch: 99,
      volumeGain: 1000,
      reverb: 500,
      distortion: -20,
      echo: 42,
      eqBass: 50,
      eqTreble: -99,
      eqBalance: 7,
      enhancerVocal: 300,
      enhancerAir: -300,
      enhancerBass: 51,
    });
    // speedPitch is non-default here, so the mutual-exclusion invariant
    // forces speed to 1 — its clamp is asserted separately below.
    expect(out.speedPitch).toBe(settings.SPEED_MIN);
    expect(out.speed).toBe(1);
    expect(out.pitch).toBe(settings.PITCH_MAX);
    expect(out.volumeGain).toBe(settings.VOLUME_GAIN_MAX);
    expect(out.reverb).toBe(settings.FX_MAX);
    expect(out.distortion).toBe(settings.FX_MIN);
    expect(out.echo).toBe(42);
    expect(out.eqBass).toBe(settings.EQ_MAX_DB);
    expect(out.eqTreble).toBe(settings.EQ_MIN_DB);
    expect(out.eqBalance).toBe(1);
    expect(out.enhancerVocal).toBe(settings.ENHANCER_MAX);
    expect(out.enhancerAir).toBe(settings.ENHANCER_MIN);
    expect(out.enhancerBass).toBe(settings.ENHANCER_MAX);
    // The Speed clamp on its own (no tape speed to exclude it).
    expect(settings.normalizeAudioSettings({ speed: 9 }).speed).toBe(settings.SPEED_MAX);
    expect(settings.normalizeAudioSettings({ speed: -9 }).speed).toBe(settings.SPEED_MIN);
  });

  test("non-numeric values degrade to defaults, not NaN", () => {
    const out = settings.normalizeAudioSettings({
      speed: "fast",
      pitch: null,
      volumeGain: NaN,
      eqBass: {},
    });
    expect(out.speed).toBe(1);
    expect(out.pitch).toBe(0);
    expect(out.volumeGain).toBe(100);
    expect(out.eqBass).toBe(0);
  });

  test("a short, long or malformed band list still yields exactly 10 numbers", () => {
    expect(settings.normalizeAudioSettings({ eqBands: [3, 4] }).eqBands).toEqual([
      3, 4, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(
      settings.normalizeAudioSettings({ eqBands: "flat" }).eqBands,
    ).toHaveLength(10);
    const long = settings.normalizeAudioSettings({
      eqBands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
    expect(long.eqBands).toHaveLength(10);
    expect(long.eqBands[9]).toBe(10);
  });

  test("an unknown enhancer engine falls back to the default", () => {
    expect(settings.normalizeAudioSettings({ enhancerEngine: "hqmusic-3" }).enhancerEngine).toBe(
      "harmonic",
    );
    expect(settings.normalizeAudioSettings({ enhancerEngine: "air" }).enhancerEngine).toBe("air");
  });
});

describe("the migration from the legacy per-key blobs", () => {
  test("an existing EQ curve, pitch, vibe settings and normalize flag survive", () => {
    clearStorage();
    win.localStorage.setItem(
      "ss.eq",
      JSON.stringify({ bass: 6, treble: -3, balance: 0.4, mono: true, bands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
    );
    win.localStorage.setItem("ss.pitch", JSON.stringify({ semitones: -2, preserve: true }));
    win.localStorage.setItem("ss.rate", "1.15");
    win.localStorage.setItem("ss.reverb", "35");
    win.localStorage.setItem("ss.distortion", "20");
    win.localStorage.setItem("ss.normalize", "1");

    const loaded = settings.loadAudioSettings();
    expect(loaded.eqBass).toBe(6);
    expect(loaded.eqTreble).toBe(-3);
    expect(loaded.eqBalance).toBe(0.4);
    expect(loaded.eqMono).toBe(true);
    expect(loaded.eqBands[3]).toBe(4);
    expect(loaded.pitch).toBe(-2);
    // A preserving rate migrates into the "Speed" setting; the tape slider
    // reads 1.00x, as melo's mutual exclusion demands.
    expect(loaded.speed).toBe(1.15);
    expect(loaded.speedPitch).toBe(1);
    expect(loaded.keepKey).toBe(true);
    expect(loaded.reverb).toBe(35);
    expect(loaded.distortion).toBe(20);
    expect(loaded.normalize).toBe(true);
  });

  test("a tape-style preserve:false rate becomes the Speed (pitch) setting", () => {
    clearStorage();
    win.localStorage.setItem("ss.pitch", JSON.stringify({ semitones: 0, preserve: false }));
    win.localStorage.setItem("ss.rate", "0.82");
    const loaded = settings.loadAudioSettings();
    expect(loaded.speedPitch).toBe(0.82);
    expect(loaded.speed).toBe(1);
    expect(loaded.keepKey).toBe(false);
  });

  test("ss.rate alone (a pre-pitch session) still migrates its speed", () => {
    clearStorage();
    win.localStorage.setItem("ss.rate", "1.15");
    const loaded = settings.loadAudioSettings();
    expect(loaded.speed).toBe(1.15);
    expect(loaded.speedPitch).toBe(1);
    expect(loaded.keepKey).toBe(true);
  });

  test("a corrupt blob carrying both speeds resolves to the tape reading", () => {
    clearStorage();
    win.localStorage.setItem(
      "ss.audioSettings",
      JSON.stringify({ speed: 1.3, speedPitch: 0.85 }),
    );
    const loaded = settings.loadAudioSettings();
    // The model's invariant: exactly one speed is non-1.0, and tape wins —
    // matching what the engine would actually play.
    expect(loaded.speedPitch).toBe(0.85);
    expect(loaded.speed).toBe(1);
  });

  test("malformed legacy JSON does not throw or wipe other keys' values", () => {
    clearStorage();
    win.localStorage.setItem("ss.eq", "{not json");
    win.localStorage.setItem("ss.pitch", "also{bad");
    win.localStorage.setItem("ss.reverb", "60");
    const loaded = settings.loadAudioSettings();
    expect(loaded.reverb).toBe(60);
    expect(loaded.eqBass).toBe(0);
    expect(loaded.pitch).toBe(0);
  });

  test("a valid versioned blob wins over the legacy keys", () => {
    clearStorage();
    win.localStorage.setItem(
      "ss.audioSettings",
      JSON.stringify({ volumeGain: 150, echo: 25, eqBands: [5, 0, 0, 0, 0, 0, 0, 0, 0, 0] }),
    );
    win.localStorage.setItem("ss.reverb", "99");
    const loaded = settings.loadAudioSettings();
    expect(loaded.volumeGain).toBe(150);
    expect(loaded.echo).toBe(25);
    expect(loaded.eqBands[0]).toBe(5);
    // The legacy key is NOT read once the blob exists.
    expect(loaded.reverb).toBe(0);
  });

  test("no storage at all yields the untouched defaults", () => {
    clearStorage();
    const loaded = settings.loadAudioSettings();
    expect(loaded).toEqual(settings.DEFAULT_AUDIO_SETTINGS);
    // And not the same object — mutating the result must not touch defaults.
    loaded.eqBands[0] = 9;
    expect(settings.DEFAULT_AUDIO_SETTINGS.eqBands[0]).toBe(0);
  });
});

describe("persistence round-trip", () => {
  test("a saved blob reads back as an equivalent settings object", async () => {
    clearStorage();
    settings.saveAudioSettings({
      ...settings.DEFAULT_AUDIO_SETTINGS,
      speedPitch: 1.25,
      speed: 1,
      echo: 15,
      enhancerEnabled: true,
      enhancerEngine: "depth",
    });
    // Debounced ~300 ms — wait past it.
    await new Promise((r) => setTimeout(r, 450));
    const loaded = settings.loadAudioSettings();
    expect(loaded.speedPitch).toBe(1.25);
    expect(loaded.speed).toBe(1);
    expect(loaded.echo).toBe(15);
    expect(loaded.enhancerEnabled).toBe(true);
    expect(loaded.enhancerEngine).toBe("depth");
  });
});

describe("value label formatters", () => {
  test("speeds always show two decimals, pitch keeps its sign, dB keeps +", () => {
    expect(settings.formatSpeed(1)).toBe("1.00x");
    expect(settings.formatSpeed(0.82)).toBe("0.82x");
    expect(settings.formatPitch(3)).toBe("+3 st");
    expect(settings.formatPitch(0)).toBe("0 st");
    expect(settings.formatPitch(-4)).toBe("-4 st");
    expect(settings.formatDb(4)).toBe("+4 dB");
    expect(settings.formatDb(0)).toBe("0 dB");
    expect(settings.formatPercent(200)).toBe("200%");
    expect(settings.formatPercent(100)).toBe("100%");
  });
});
