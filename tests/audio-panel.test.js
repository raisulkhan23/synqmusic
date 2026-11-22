import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const panel = readSource("src/components/player/AudioSettingsPanel.tsx");
const bar = readSource("src/components/player/PlayerBar.tsx");
const settings = readSource("src/components/settings/SettingsDialog.tsx");
const store = readSource("src/store/audioSettings.ts");
const playerStore = readSource("src/store/player.ts");
const lib = readSource("src/lib/audioSettings.ts");

/**
 * The Audio panel — SYNQ's recreation of melo's audio customization card.
 *
 * Source-shape on purpose, like the other UI contracts in this suite: what
 * matters here is WHICH store the panel reads and writes (the split-brain
 * bug this panel exists to kill was invisible in any mocked render), and
 * that every control is wired to the engine-backed store rather than being
 * a decorative toggle.
 */

describe("the panel recreates melo's audio card", () => {
  test("all five sections, in melo's order, with the value-labeled slider row", () => {
    for (const label of ["Enhancer", "Speed & Pitch", "Audio FX", "Equalizer", "Sleep"]) {
      expect(panel).toContain(label);
    }
    // Section ids in melo's rail order.
    const rail = panel.slice(panel.indexOf("const SECTIONS"), panel.indexOf("function PanelSlider"));
    expect(rail).toMatch(/"enhancer"[\s\S]*"speed"[\s\S]*"fx"[\s\S]*"eq"[\s\S]*"sleep"/);
    // Label left, value right — melo's setting-item-top shape.
    expect(panel).toMatch(/justify-between[\s\S]*text-sm font-medium[\s\S]*tabular-nums/);
  });

  test("the four Speed & Pitch controls exist with melo's labels and ranges", () => {
    for (const label of ['"Speed"', '"Speed (pitch)"', '"Pitch"', '"Volume gain"']) {
      expect(panel).toContain(label);
    }
    expect(panel).toMatch(/min=\{SPEED_MIN\}[\s\S]{0,200}max=\{SPEED_MAX\}[\s\S]{0,200}step=\{SPEED_STEP\}/);
    expect(panel).toMatch(/min=\{PITCH_MIN\}[\s\S]{0,200}max=\{PITCH_MAX\}/);
    // Volume gain: melo's 0–200%.
    expect(panel).toMatch(/min=\{VOLUME_GAIN_MIN\}[\s\S]{0,200}max=\{VOLUME_GAIN_MAX\}/);
  });

  test("Audio FX is Reverb / Distortion / Echo — all real engine taps", () => {
    expect(panel).toMatch(/"Reverb"[\s\S]*"Distortion"[\s\S]*"Echo"/);
  });

  test("the Equalizer has melo's Low/Mid/High rows plus the 10-band faders", () => {
    expect(panel).toMatch(/"Low"/);
    expect(panel).toMatch(/"Mid"/);
    expect(panel).toMatch(/"High"/);
    expect(panel).toContain("10-band equalizer");
    // Mid is the 1 kHz band of the SAME curve the faders show — never a
    // second, divergent value.
    expect(panel).toMatch(/setEqBand\(5, /);
  });

  test("the header carries the modified dot and a close button", () => {
    expect(panel).toMatch(/aria-label="Close audio settings"/);
    expect(panel).toMatch(/Audio settings modified/);
  });

  test("the footer resets through the store AND the player store's rate", () => {
    expect(panel).toContain("Reset audio settings");
    expect(panel).toMatch(/resetAll\(\)/);
    expect(panel).toMatch(/setRate\(1\)/);
  });
});

describe("every panel value comes from the shared store", () => {
  test("no component-local audio state — the drift the audit called out", () => {
    // The old SettingsDialog seeded useState from four localStorage keys and
    // never re-read them. Neither surface may do that anymore.
    expect(panel).not.toMatch(/localStorage\.getItem/);
    expect(panel).not.toMatch(/useState\(\(\) => \{[\s\S]*localStorage/);
    expect(settings).not.toMatch(/localStorage\.getItem\("ss\.eq"\)/);
    expect(settings).not.toMatch(/localStorage\.getItem\("ss\.pitch"\)/);
    expect(settings).not.toMatch(/localStorage\.getItem\("ss\.reverb"\)/);
    expect(settings).not.toMatch(/localStorage\.getItem\("ss\.distortion"\)/);
    expect(settings).not.toMatch(/localStorage\.getItem\("ss\.normalize"\)/);
  });

  test("the panel reads the audio settings store and syncs on open", () => {
    expect(panel).toMatch(/useAudioSettingsStore\(\(s\) => s\.audio\)/);
    expect(panel).toMatch(/syncFromEngine\(\)/);
  });

  test("the settings page reads the same store", () => {
    expect(settings).toMatch(/useAudioSettingsStore\(\(s\) => s\.audio\)/);
  });

  test("every store action applies to the engine before persisting", () => {
    // Spot-check the three families the panel drives: speed, FX, enhancer.
    expect(store).toMatch(/setSpeed\(v\) \{[\s\S]*?setDeckRate\(next\.speed\)[\s\S]*?saveAudioSettings\(next\)/);
    expect(store).toMatch(/setEcho\(v\) \{[\s\S]*?setEcho\(next\.echo\)[\s\S]*?saveAudioSettings\(next\)/);
    expect(store).toMatch(/setEnhancerEnabled\(v\) \{[\s\S]*?setEnhancer\(v\)[\s\S]*?saveAudioSettings\(next\)/);
  });
});

describe("provider honesty", () => {
  test("a dead Web Audio graph disables processing with an explanation", () => {
    expect(panel).toMatch(/audioGraphFailed/);
    // The banner says what is wrong and what still works.
    expect(panel).toMatch(/processing[\s\S]*unavailable/i);
    expect(panel).toMatch(/disabled=\{graphFailed\}/);
    // The sleep section stays usable — a timer needs no Web Audio.
    expect(panel).toMatch(/section === "sleep" && <SleepSection \/>/);
  });

  test("startup hydration runs through the store, not per-key localStorage reads", () => {
    expect(playerStore).toMatch(/hydrateAudioSettings\(\)/);
    expect(playerStore).not.toMatch(/localStorage\.getItem\("ss\.eq"\)/);
    expect(playerStore).not.toMatch(/localStorage\.getItem\("ss\.pitch"\)/);
    // The rate stays the player store's own key (HUD bookkeeping).
    expect(playerStore).toMatch(/writeSetting\("ss\.rate"/);
  });

  test("wireAudio must never write the deck rate itself", () => {
    // The startup bug this pins: the audio settings model owns the speed
    // restore (including WHICH mode owns the rate). A bare `setDeckRate`
    // after hydration silently converts a persisted tape speed back to the
    // preserving mode on every restart. wireAudio may hydrate; it may not
    // set a rate. (setRate — the user-facing action — is the only store path
    // that writes deck rates, and it goes through noteExternalSpeed.)
    const wire = playerStore.slice(
      playerStore.indexOf("function wireAudio("),
      playerStore.indexOf("/**\n * Attach the element-level listeners"),
    );
    expect(wire).not.toMatch(/setDeckRate\(/);
    expect(wire).toMatch(/hydrateAudioSettings\(\)/);
    // The HUD's starting rate derives from the hydrated model, so the two
    // stores cannot disagree about the speed from the first frame.
    expect(playerStore).toMatch(
      /hydratedAudioModel\.speedPitch !== 1\s*\?\s*hydratedAudioModel\.speedPitch\s*:\s*hydratedAudioModel\.speed/,
    );
  });

  test("a rate change made outside the panel mirrors into the model", () => {
    expect(playerStore).toMatch(/noteExternalSpeed\(r\)/);
    expect(store).toMatch(/export function noteExternalSpeed/);
  });
});

describe("the bar trigger and sleep section", () => {
  test("the bar has an audio-settings button that opens the panel", () => {
    expect(bar).toMatch(/aria-label="Open audio settings"/);
    expect(bar).toMatch(/aria-expanded=\{audioPanelOpen\}/);
    expect(bar).toMatch(/<AudioSettingsPanel[\s\S]*open=\{audioPanelOpen\}/);
  });

  test("sleep presets arm the real timer and light by the ticking clock", () => {
    // The minute presets map over [15, 30, 45, 60] — every pill arms the
    // store's timer with real minutes.
    expect(panel).toMatch(/\[15, 30, 45, 60\]\.map\(\(m\) =>/);
    expect(panel).toMatch(/setSleepTimer\(m\)/);
    expect(panel).toMatch(/setSleepTimer\("end"\)/);
    expect(panel).toMatch(/setSleepTimer\("queue"\)/);
    expect(panel).toMatch(/setSleepTimer\(null\)/);
    // Compared against the shared countdown, never a render-time Date.now().
    expect(panel).toMatch(/sleepEndsAt - now/);
    expect(panel).not.toMatch(/Date\.now\(\)/);
  });
});

describe("the model keeps its contract", () => {
  test("melo's ranges are pinned", () => {
    expect(lib).toMatch(/SPEED_MIN = 0\.5/);
    expect(lib).toMatch(/SPEED_MAX = 2/);
    expect(lib).toMatch(/SPEED_STEP = 0\.05/);
    expect(lib).toMatch(/PITCH_MIN = -12/);
    expect(lib).toMatch(/PITCH_MAX = 12/);
    expect(lib).toMatch(/VOLUME_GAIN_MAX = 200/);
    expect(lib).toMatch(/FX_MAX = 100/);
    expect(lib).toMatch(/EQ_MAX_DB = 12/);
    expect(lib).toMatch(/ENHANCER_MAX = 50/);
  });

  test("the versioned blob key and debounced save exist, legacy keys are read-only", () => {
    expect(lib).toMatch(/AUDIO_SETTINGS_KEY = "ss\.audioSettings"/);
    expect(lib).toMatch(/setTimeout/);
    // The migration reads the legacy keys; nothing writes them anymore.
    expect(lib).toMatch(/localStorage\.getItem\("ss\.eq"\)/);
    expect(lib).not.toMatch(/setItem\("ss\.eq"/);
    expect(lib).not.toMatch(/setItem\("ss\.pitch"/);
    expect(lib).not.toMatch(/setItem\("ss\.reverb"/);
  });
});
