import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The audio settings STORE, executed against the real zustand instance and
 * the real engine module.
 *
 * The store is the contract that keeps the Audio panel, the settings page
 * and the engine from drifting apart: every action clamps, applies to the
 * engine, and persists. These tests pin exactly that — the store's mirror
 * and the engine's state must agree after every action, a reset must land
 * everything back on the defaults IN THE ENGINE too, and a speed change made
 * behind the store's back (the fullscreen dropdown path) must be visible
 * through noteExternalSpeed / syncFromEngine.
 */

const win = new Window({ url: "https://example.test/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.navigator = win.navigator;
globalThis.localStorage = win.localStorage;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
globalThis.Event = win.Event;
globalThis.Audio = win.Audio;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// A persisted blob BEFORE the store module evaluates — this is the startup
// hydration path (wireAudio calls hydrateAudioSettings, but the store
// constructs and loads at import time either way).
win.localStorage.setItem(
  "ss.audioSettings",
  JSON.stringify({
    speed: 1.3,
    volumeGain: 150,
    reverb: 20,
    echo: 10,
    eqBass: 4,
    eqBands: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    enhancerEnabled: true,
    enhancerEngine: "depth",
    normalize: true,
  }),
);

const { useAudioSettingsStore, hydrateAudioSettings, noteExternalSpeed, syncFromEngine } =
  await import("../src/store/audioSettings.ts");
const engine = await import("../src/lib/audio.ts");

function flushSave() {
  return new Promise((r) => setTimeout(r, 420));
}

describe("startup hydration", () => {
  test("the persisted blob reaches the store AND the engine", () => {
    const a = useAudioSettingsStore.getState().audio;
    expect(a.speed).toBe(1.3);
    expect(a.volumeGain).toBe(150);
    expect(a.reverb).toBe(20);
    expect(a.echo).toBe(10);
    expect(a.eqBass).toBe(4);
    expect(a.eqBands[2]).toBe(3);
    expect(a.enhancerEnabled).toBe(true);
    expect(a.enhancerEngine).toBe("depth");
    expect(a.normalize).toBe(true);

    // The engine received the same values (tape speed is 1 here, so the
    // preserving Speed owns the rate).
    expect(engine.getSpeed()).toBe(1.3);
    expect(engine.getVolumeGain()).toBe(1.5);
    expect(engine.getReverbMix()).toBeCloseTo(0.2, 5);
    expect(engine.getEcho()).toBe(10);
    expect(engine.getEqBands()[2]).toBe(3);
    expect(engine.isEnhancerEnabled()).toBe(true);
    expect(engine.getEnhancerSettings().engine).toBe("depth");
    expect(engine.isVolumeNormalizationEnabled()).toBe(true);
  });

  test("hydrateAudioSettings is safe to call again", () => {
    expect(() => hydrateAudioSettings()).not.toThrow();
    expect(useAudioSettingsStore.getState().audio.speed).toBe(1.3);
  });
});

describe("actions apply to the engine and persist", () => {
  test("setEcho", async () => {
    useAudioSettingsStore.getState().setEcho(45);
    expect(useAudioSettingsStore.getState().audio.echo).toBe(45);
    expect(engine.getEcho()).toBe(45);
    await flushSave();
    expect(JSON.parse(win.localStorage.getItem("ss.audioSettings")).echo).toBe(45);
    useAudioSettingsStore.getState().setEcho(0);
  });

  test("setVolumeGain stores percent but applies a 0–2 multiplier", () => {
    useAudioSettingsStore.getState().setVolumeGain(200);
    expect(useAudioSettingsStore.getState().audio.volumeGain).toBe(200);
    expect(engine.getVolumeGain()).toBe(2);
    useAudioSettingsStore.getState().setVolumeGain(100);
    expect(engine.getVolumeGain()).toBe(1);
  });

  test("setSpeedPitch takes the tape path, Speed reads 1.00x", () => {
    useAudioSettingsStore.getState().setSpeedPitch(0.85);
    expect(useAudioSettingsStore.getState().audio.speedPitch).toBe(0.85);
    expect(useAudioSettingsStore.getState().audio.speed).toBe(1);
    expect(engine.getTapeSpeed()).toBe(0.85);
    expect(engine.getSpeed()).toBe(1);
    expect(engine.getAudio().preservesPitch).toBe(false);
    useAudioSettingsStore.getState().setSpeedPitch(1);
  });

  test("setSpeed takes the preserving path, Speed (pitch) reads 1.00x", () => {
    useAudioSettingsStore.getState().setSpeed(1.4);
    expect(useAudioSettingsStore.getState().audio.speed).toBe(1.4);
    expect(useAudioSettingsStore.getState().audio.speedPitch).toBe(1);
    expect(engine.getSpeed()).toBe(1.4);
    expect(engine.getTapeSpeed()).toBe(1);
    expect(engine.getAudio().preservesPitch).toBe(true);
    useAudioSettingsStore.getState().setSpeed(1);
  });

  test("setEqBand clamps through the model and marks the preset custom", () => {
    useAudioSettingsStore.getState().setEqBand(0, 99);
    expect(useAudioSettingsStore.getState().audio.eqBands[0]).toBe(12);
    expect(useAudioSettingsStore.getState().audio.eqPreset).toBe("custom");
    expect(engine.getEqBands()[0]).toBe(12);
    useAudioSettingsStore.getState().resetEqBands();
    expect(useAudioSettingsStore.getState().audio.eqBands.every((v) => v === 0)).toBe(true);
    expect(engine.getEqBands().every((v) => v === 0)).toBe(true);
  });

  test("setEqPreset applies the shelf values", () => {
    useAudioSettingsStore.getState().setEqPreset("bass-boost");
    const a = useAudioSettingsStore.getState().audio;
    expect(a.eqPreset).toBe("bass-boost");
    expect(a.eqBass).toBe(10);
    expect(engine.getEqBands !== undefined).toBe(true);
    useAudioSettingsStore.getState().setEqPreset("flat");
    expect(useAudioSettingsStore.getState().audio.eqBass).toBe(0);
  });

  test("enhancer actions compose toggle + engine + knobs", () => {
    const s = useAudioSettingsStore.getState();
    s.setEnhancerEnabled(true);
    s.setEnhancerEngine("air");
    s.setEnhancerParam("vocal", 30);
    s.setEnhancerParam("air", -20);
    s.setEnhancerParam("bass", 51);
    const a = useAudioSettingsStore.getState().audio;
    expect(a.enhancerEnabled).toBe(true);
    expect(a.enhancerEngine).toBe("air");
    expect(a.enhancerVocal).toBe(30);
    expect(a.enhancerAir).toBe(-20);
    expect(a.enhancerBass).toBe(50); // clamped to the ±50 knob range
    const es = engine.getEnhancerSettings();
    expect(es.engine).toBe("air");
    expect(es.vocal).toBe(30);
    useAudioSettingsStore.getState().setEnhancerPreset("vinyl");
    expect(useAudioSettingsStore.getState().audio.enhancerBass).toBe(25);
    useAudioSettingsStore.getState().setEnhancerEnabled(false);
  });

  test("the modified dot follows real changes and clears on reset", () => {
    // Start from a known-clean slate — earlier tests in this file changed
    // settings (and the hydrated blob began non-default).
    useAudioSettingsStore.getState().resetAll();
    expect(useAudioSettingsStore.getState().modified).toBe(false);
    useAudioSettingsStore.getState().setReverb(30);
    expect(useAudioSettingsStore.getState().modified).toBe(true);
    useAudioSettingsStore.getState().setReverb(0);
    expect(useAudioSettingsStore.getState().modified).toBe(false);
  });
});

describe("resetAll restores engine defaults, not just UI values", () => {
  test("after poisoning every setting, reset lands the engine back at defaults", async () => {
    const s = useAudioSettingsStore.getState();
    s.setSpeed(1.5);
    s.setSpeedPitch(1.5);
    s.setPitch(5);
    s.setVolumeGain(200);
    s.setReverb(80);
    s.setDistortion(70);
    s.setEcho(60);
    s.setEqBass(10);
    s.setEqBand(0, 8);
    s.setEnhancerEnabled(true);
    s.setNormalize(true);
    expect(engine.hasAudioProcessing()).toBe(true);

    s.resetAll();
    await flushSave();

    const a = useAudioSettingsStore.getState().audio;
    expect(a.speed).toBe(1);
    expect(a.speedPitch).toBe(1);
    expect(a.pitch).toBe(0);
    expect(a.volumeGain).toBe(100);
    expect(a.reverb).toBe(0);
    expect(a.distortion).toBe(0);
    expect(a.echo).toBe(0);
    expect(a.eqBass).toBe(0);
    expect(a.eqBands.every((v) => v === 0)).toBe(true);
    expect(a.enhancerEnabled).toBe(false);
    expect(a.normalize).toBe(false);
    expect(useAudioSettingsStore.getState().modified).toBe(false);

    // The ENGINE is back at defaults too — the thing a reset is for.
    expect(engine.getSpeed()).toBe(1);
    expect(engine.getTapeSpeed()).toBe(1);
    expect(engine.getDeckPitch()).toBe(0);
    expect(engine.getVolumeGain()).toBe(1);
    expect(engine.getReverbMix()).toBe(0);
    expect(engine.getDistortion()).toBe(0);
    expect(engine.getEcho()).toBe(0);
    expect(engine.getEqBands().every((v) => v === 0)).toBe(true);
    expect(engine.isEnhancerEnabled()).toBe(false);
    expect(engine.isVolumeNormalizationEnabled()).toBe(false);
    expect(engine.hasAudioProcessing()).toBe(false);
    expect(
      JSON.parse(win.localStorage.getItem("ss.audioSettings")).reverb,
    ).toBe(0);
  });
});

describe("the fullscreen-dropdown speed path stays in sync", () => {
  test("noteExternalSpeed moves ownership to the preserving Speed", () => {
    noteExternalSpeed(1.25);
    const a = useAudioSettingsStore.getState().audio;
    expect(a.speed).toBe(1.25);
    expect(a.speedPitch).toBe(1);
    noteExternalSpeed(1);
    expect(useAudioSettingsStore.getState().audio.speed).toBe(1);
  });

  test("syncFromEngine closes drift made behind the store's back", () => {
    // Simulate a surface that talks straight to the engine.
    engine.setReverbMix(0.5);
    engine.setEcho(33);
    engine.setDeckPitch(4);
    expect(useAudioSettingsStore.getState().audio.reverb).toBe(0); // stale

    syncFromEngine();
    const a = useAudioSettingsStore.getState().audio;
    expect(a.reverb).toBe(50);
    expect(a.echo).toBe(33);
    expect(a.pitch).toBe(4);

    // And back to a clean slate for later assertions.
    engine.setReverbMix(0);
    engine.setEcho(0);
    engine.setDeckPitch(0);
    syncFromEngine();
    expect(useAudioSettingsStore.getState().audio.reverb).toBe(0);
    expect(useAudioSettingsStore.getState().audio.echo).toBe(0);
    expect(useAudioSettingsStore.getState().audio.pitch).toBe(0);
  });
});
