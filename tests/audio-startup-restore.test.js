import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The STARTUP restore path, executed against the real player store.
 *
 * This is the test that pins the ordering the first implementation got
 * wrong: the audio settings store constructs (and applies its persisted
 * model to the engine) when player.ts imports it, and `wireAudio()` runs
 * inside the player store factory. If ANYTHING in that later code path
 * writes the deck rate through the preserving `setDeckRate` — as the old
 * `setDeckRate(initialRate)` did — a persisted tape-speed silently converts
 * back to preserving on every restart, and the next panel open persists the
 * conversion.
 *
 * The runtime test drives `hydrateAudioSettings()` — the exact call
 * `wireAudio` makes — against storage seeded BEFORE it, which is the same
 * contract whether the surrounding module registry is fresh or shared with
 * other test files (bun shares canonical instances across files in one
 * process, so seeding before import alone proves nothing there).
 */

const win = new Window({ url: "https://example.test/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.localStorage = win.localStorage;
globalThis.navigator = win.navigator;
globalThis.HTMLElement = win.HTMLElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
globalThis.Event = win.Event;
globalThis.Audio = win.Audio;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

// A previous test file can leave a 300ms debounced save armed in
// lib/audioSettings. It reads `localStorage` when it FIRES, so it would land in
// THIS window's storage after the fixture below is seeded and replace the tape
// speed with that file's defaults — the flake this test used to show on a slow
// first run. Cancel it before seeding so the starting state is ours.
const { cancelPendingAudioSettingsSave } = await import(
  "../src/lib/audioSettings.ts"
);
cancelPendingAudioSettingsSave();

// A persisted TAPE speed (Speed (pitch) owns the rate) — the exact shape the
// startup bug used to destroy.
win.localStorage.setItem(
  "ss.audioSettings",
  JSON.stringify({ speed: 1, speedPitch: 0.85, pitch: 0 }),
);
win.localStorage.setItem("ss.rate", "0.85");

const { usePlayerStore } = await import("../src/store/player.ts");
const {
  useAudioSettingsStore,
  hydrateAudioSettings,
  noteExternalSpeed,
} = await import("../src/store/audioSettings.ts");
const engine = await import("../src/lib/audio.ts");

// Start from a NEUTRAL engine. bun shares canonical module instances across
// test FILES in one process, so without this the tape/EQ state an earlier file
// left behind decides this test's starting point and it can fail on a run
// order it never chose.
engine.resetAudioEngine();

describe("the speed model survives full startup", () => {
  test("wireAudio's hydration leaves a persisted tape speed owning the rate", () => {
    hydrateAudioSettings();
    const a = useAudioSettingsStore.getState().audio;
    expect(a.speedPitch).toBe(0.85);
    expect(a.speed).toBe(1);
    // The ENGINE holds the tape mode too — the thing a listener hears.
    expect(engine.getTapeSpeed()).toBe(0.85);
    expect(engine.getSpeed()).toBe(1);
    // And the wiring did not quietly persist a conversion back to preserving.
    expect(JSON.parse(win.localStorage.getItem("ss.audioSettings")).speedPitch).toBe(0.85);
  });

  test("a later preserving speed change (fullscreen dropdown path) still syncs both stores", async () => {
    usePlayerStore.getState().setRate(1.25);
    expect(usePlayerStore.getState().rate).toBe(1.25);
    const a = useAudioSettingsStore.getState().audio;
    expect(a.speed).toBe(1.25);
    expect(a.speedPitch).toBe(1);
    // The blob save is debounced ~300 ms; ss.rate is synchronous.
    await new Promise((r) => setTimeout(r, 450));
    expect(JSON.parse(win.localStorage.getItem("ss.audioSettings")).speed).toBe(1.25);
    expect(win.localStorage.getItem("ss.rate")).toBe("1.25");
    void noteExternalSpeed;
  });
});
