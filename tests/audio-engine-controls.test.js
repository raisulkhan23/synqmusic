import { beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The engine controls the Audio panel drives: the tape-speed model, echo,
 * volume gain and the enhancer chain.
 *
 * happy-dom has no Web Audio, so the graph never builds here — and that is
 * the point, same as in audio-features.test.js: every setter must record its
 * state BEFORE any graph exists (the startup restore runs outside any user
 * gesture), and a later successful `ensureGraph()` paints that state onto
 * the nodes. The deck elements ARE real here, so the effective playback rate
 * — the one thing a listener directly hears — is asserted on the element.
 */

let win;
let audio;

beforeAll(async () => {
  win = new Window({ url: "https://example.test/" });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.navigator = win.navigator;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = () => {};
  globalThis.Audio = win.Audio;
  audio = await import(`../src/lib/audio.ts?fresh=${Math.random()}`);
});

describe("the speed model (melo's two sliders)", () => {
  test("Speed is pitch-preserving at pitch 0", () => {
    audio.setDeckRate(1.35);
    const el = audio.getAudio();
    expect(el.playbackRate).toBeCloseTo(1.35, 5);
    expect(el.preservesPitch).toBe(true);
    expect(audio.getSpeed()).toBe(1.35);
    // The other slider reads 1.00x — melo's mutual exclusion.
    expect(audio.getTapeSpeed()).toBe(1);
    audio.setDeckRate(1);
  });

  test("Speed (pitch) takes ownership and disables preservation", () => {
    audio.setTapeSpeed(0.82);
    const el = audio.getAudio();
    expect(el.playbackRate).toBeCloseTo(0.82, 5);
    expect(el.preservesPitch).toBe(false);
    expect(audio.getTapeSpeed()).toBe(0.82);
    expect(audio.getSpeed()).toBe(1);
    audio.setTapeSpeed(1);
  });

  test("pitch rides on the rate and disables preservation (tape-style)", () => {
    audio.setDeckPitch(3);
    const el = audio.getAudio();
    // 1.0 × 2^(3/12) — a genuinely higher key.
    expect(el.playbackRate).toBeCloseTo(Math.pow(2, 3 / 12), 5);
    expect(el.preservesPitch).toBe(false);
    audio.setDeckPitch(-4);
    expect(el.playbackRate).toBeCloseTo(Math.pow(2, -4 / 12), 5);
    audio.setDeckPitch(0);
    expect(el.playbackRate).toBeCloseTo(1, 5);
    expect(el.preservesPitch).toBe(true);
  });

  test("pitch composes with the preserving Speed, as it always has", () => {
    // The fullscreen speed dropdown path: setDeckRate must keep the existing
    // rate × pitch composition rather than melo's drop-the-speed quirk.
    audio.setDeckPitch(2);
    audio.setDeckRate(1.5);
    const el = audio.getAudio();
    expect(el.playbackRate).toBeCloseTo(1.5 * Math.pow(2, 2 / 12), 5);
    expect(el.preservesPitch).toBe(false);
    audio.setDeckPitch(0);
    audio.setDeckRate(1);
  });

  test("both speed sliders clamp to 0.5–2.0", () => {
    audio.setDeckRate(9);
    expect(audio.getSpeed()).toBe(2);
    audio.setTapeSpeed(0.1);
    expect(audio.getTapeSpeed()).toBe(0.5);
    audio.setDeckRate(1);
    audio.setTapeSpeed(1);
  });

  test("keep-the-key preference is honored for the preserving speed", () => {
    audio.setRatePreservesPitch(false);
    audio.setDeckRate(1.2);
    const el = audio.getAudio();
    expect(el.preservesPitch).toBe(false);
    audio.setRatePreservesPitch(true);
    audio.setDeckRate(1);
    expect(audio.getAudio().preservesPitch).toBe(true);
  });
});

describe("echo", () => {
  test("records its level before any graph exists and clamps to 0–100", () => {
    expect(audio.getEcho()).toBe(0);
    audio.setEcho(40);
    expect(audio.getEcho()).toBe(40);
    audio.setEcho(150);
    expect(audio.getEcho()).toBe(100);
    audio.setEcho(-5);
    expect(audio.getEcho()).toBe(0);
    audio.setEcho(0);
  });

  test("a non-zero echo counts as audio processing", () => {
    audio.setEcho(30);
    expect(audio.hasAudioProcessing()).toBe(true);
    audio.setEcho(0);
    expect(audio.hasAudioProcessing()).toBe(false);
  });
});

describe("volume gain (melo's 0–200%)", () => {
  test("stores 0–2 as a multiplier, clamped", () => {
    expect(audio.getVolumeGain()).toBe(1);
    audio.setVolumeGain(2);
    expect(audio.getVolumeGain()).toBe(2);
    audio.setVolumeGain(5);
    expect(audio.getVolumeGain()).toBe(2);
    audio.setVolumeGain(0);
    expect(audio.getVolumeGain()).toBe(0);
    audio.setVolumeGain(1);
  });

  test("any non-unity gain counts as audio processing", () => {
    audio.setVolumeGain(1.5);
    expect(audio.hasAudioProcessing()).toBe(true);
    audio.setVolumeGain(1);
    expect(audio.hasAudioProcessing()).toBe(false);
  });
});

describe("the enhancer chain", () => {
  test("holds enabled state and settings without a graph", () => {
    expect(audio.isEnhancerEnabled()).toBe(false);
    audio.setEnhancer(true, { engine: "air", vocal: 20, air: -15, bass: 25 });
    expect(audio.isEnhancerEnabled()).toBe(true);
    const s = audio.getEnhancerSettings();
    expect(s.engine).toBe("air");
    expect(s.vocal).toBe(20);
    expect(s.air).toBe(-15);
    expect(s.bass).toBe(25);
    audio.setEnhancer(false);
    expect(audio.isEnhancerEnabled()).toBe(false);
  });

  test("being enabled counts as audio processing", () => {
    audio.setEnhancer(true);
    expect(audio.hasAudioProcessing()).toBe(true);
    audio.setEnhancer(false);
    expect(audio.hasAudioProcessing()).toBe(false);
  });

  test("the engine list describes three real chains and three presets", () => {
    expect(audio.ENHANCER_ENGINES.map((e) => e.id)).toEqual([
      "harmonic",
      "air",
      "depth",
    ]);
    expect(audio.ENHANCER_PRESETS.map((p) => p.id)).toEqual([
      "studio",
      "vinyl",
      "concert",
    ]);
    // melo's preset values, ported verbatim.
    expect(audio.ENHANCER_PRESETS[1]).toEqual({
      id: "vinyl",
      label: "Vinyl",
      vocal: 15,
      air: -15,
      bass: 25,
    });
  });
});

describe("speed/FX changes notify the re-route listener", () => {
  test("rate, tape speed and pitch changes fire onEqChange", () => {
    let notified = 0;
    audio.onEqChange(() => {
      notified += 1;
    });
    audio.setDeckRate(1.1);
    audio.setTapeSpeed(0.9);
    audio.setDeckPitch(2);
    audio.setEcho(10);
    audio.setVolumeGain(1.4);
    audio.setEnhancer(true);
    expect(notified).toBe(6);
    audio.onEqChange(null);
    audio.setDeckRate(1);
    audio.setTapeSpeed(1);
    audio.setDeckPitch(0);
    audio.setEcho(0);
    audio.setVolumeGain(1);
    audio.setEnhancer(false);
    expect(notified).toBe(6); // detached listener no longer fires
  });
});

describe("normalization does not demand a graph", () => {
  test("enabling holds the state without building an AudioContext", () => {
    // The startup restore runs before any user gesture; building the context
    // there leaves it suspended and the whole graph silent until luck
    // resumes it. The toggle must record and move on.
    audio.setVolumeNormalization(true);
    expect(audio.isVolumeNormalizationEnabled()).toBe(true);
    expect(audio.hasAudioProcessing()).toBe(true);
    audio.setVolumeNormalization(false);
    expect(audio.isVolumeNormalizationEnabled()).toBe(false);
    expect(audio.hasAudioProcessing()).toBe(false);
  });
});
