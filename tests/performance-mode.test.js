import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const cssSource = readSource("src/index.css");
const storeSource = readSource("src/store/player.ts");
const shellSource = readSource("src/components/layout/AppShell.tsx");
const fullscreenSource = readSource("src/components/player/FullscreenPlayer.tsx");
const settingsSource = readSource("src/components/settings/SettingsDialog.tsx");

/** Everything under the `html.perf-lite` block, so a rule added anywhere in
 *  it is covered by the same assertions. */
const perfBlock = (() => {
  const start = cssSource.indexOf("html.perf-lite");
  expect(start).toBeGreaterThan(-1);
  return cssSource.slice(start, cssSource.indexOf(".hide-scrollbar", start));
})();

/** `html.perf-lite` rules that hide or neutralise one specific selector. */
const selectorsInBlock = [...perfBlock.matchAll(/html\.perf-lite ([^{,]+)/g)].map((m) =>
  m[1].trim(),
);

describe("performance mode is a real, persisted switch", () => {
  test("the store owns the flag and persists it", () => {
    expect(storeSource).toMatch(/performanceMode: boolean;/);
    expect(storeSource).toMatch(/togglePerformanceMode: \(\) => void;/);
    expect(storeSource).toMatch(/readBool\("ss\.performanceMode", false\)/);
    expect(storeSource).toMatch(/localStorage\.setItem\("ss\.performanceMode"/);
  });

  test("the shell turns it into one class on <html>", () => {
    expect(shellSource).toMatch(
      /document\.documentElement\.classList\.toggle\("perf-lite", performanceMode\)/,
    );
  });

  test("it is reachable in settings and survives a visual reset", () => {
    expect(settingsSource).toMatch(/label="Performance mode"/);
    expect(settingsSource).toMatch(/on=\{performanceMode\}/);
    expect(settingsSource).toMatch(/togglePerformanceMode\(\);/);
    // "Reset visual preferences" must not silently leave the heavy mode on.
    expect(settingsSource).toMatch(/if \(performanceMode\) togglePerformanceMode\(\);/);
    expect(settingsSource).toMatch(/localStorage\.setItem\("ss\.performanceMode", "0"\)/);
  });
});

describe("performance mode removes the expensive layers", () => {
  test("animations and transitions are off everywhere", () => {
    expect(perfBlock).toMatch(/animation: none !important/);
    expect(perfBlock).toMatch(/transition: none !important/);
  });

  test("every backdrop-filter is dropped", () => {
    // A backdrop read-back plus blur, per panel, per frame, is the single
    // most expensive thing this app draws.
    expect(perfBlock).toMatch(/backdrop-filter: none !important/);
    for (const selector of [
      ".liquid-glass",
      ".glass",
      ".glass-card",
      ".mobile-player",
      ".settings-jump-bar",
      ".settings-jump-glass",
    ]) {
      expect(selectorsInBlock).toContain(selector);
    }
  });

  test("the heavy decorative layers are hidden", () => {
    expect(perfBlock).toMatch(/display: none !important/);
    for (const selector of [
      ".aurora-orb",
      ".ambient-grid",
      ".pointer-glow",
      ".cursor-trail-layer",
      ".click-ripple",
    ]) {
      expect(selectorsInBlock).toContain(selector);
    }
  });

  test("the moving glass sheen is removed, not just paused", () => {
    // `animation: none` would freeze the 420% gradient band on one frame,
    // which reads as a flat tint across every panel.
    expect(perfBlock).toMatch(/\.liquid-glass::before[\s\S]*content: none !important/);
  });

  test("the full-screen wallpaper blur is dropped", () => {
    expect(perfBlock).toMatch(/filter: none !important/);
    expect(shellSource).toContain("perf-wallpaper-blur");
    expect(fullscreenSource).toContain("perf-wallpaper-blur");
  });
});

describe("performance mode also stops the work, not just the painting", () => {
  test("the shell stops handling pointer events for the effect layer", () => {
    // CSS alone would leave a rAF loop and five style writes per frame running
    // for a layer nobody can see.
    expect(shellSource).toMatch(/const pointerFx = pointerEffects && !performanceMode;/);
    expect(shellSource).not.toMatch(/if \(!pointerEffects \|\| event\.pointerType === "touch"\) return;/);
    expect(shellSource).toMatch(/if \(!pointerFx \|\| !rippleLayerRef\.current\) return;/);
    expect(shellSource).toMatch(/if \(performanceMode\) cursorTrailRef\.current\?\.stop\(\);/);
  });

  test("the fullscreen player does the same", () => {
    expect(fullscreenSource).toMatch(/const pointerFx = pointerEffects && !performanceMode;/);
    expect(fullscreenSource).toMatch(
      /if \(!pointerFx \|\| event\.pointerType === "touch" \|\| !rippleLayerRef\.current\) return;/,
    );
  });
});
