import { describe, expect, test } from "bun:test";
import { compileClasses, readSource } from "./helpers/tailwind-css.js";

const cssSource = readSource("src/index.css");
const shellSource = readSource("src/components/layout/AppShell.tsx");
const fullscreenSource = readSource("src/components/player/FullscreenPlayer.tsx");
const settingsSource = readSource("src/components/settings/SettingsDialog.tsx");

/** Every `.cursor-trail` rule, joined, so a rule added anywhere in the file is
 *  covered by the same assertions. */
const trailRules = (cssSource.match(/\.cursor-trail[^{]*\{[^}]*\}/g) ?? []).join("\n");
const pointerRules = (cssSource.match(/\.pointer-glow[^{]*\{[^}]*\}/g) ?? []).join("\n");

describe("cursor trail stays on the compositor", () => {
  test("motes are positioned with transform, never left/top", () => {
    // `left`/`top` are layout properties: transitioning them re-ran layout for
    // five elements on every pointer frame, which is what made the trail feel
    // like it was dragging behind the pointer.
    expect(trailRules).not.toMatch(/transition:[^;}]*\bleft\b/);
    expect(trailRules).not.toMatch(/transition:[^;}]*\btop\b/);
    expect(trailRules).toMatch(/transition:\s*transform 120ms/);
    expect(cssSource).toMatch(/will-change: transform/);
  });

  test("no per-frame blur filters or oversized shadows on the motes", () => {
    // Both were re-rasterised for each of the five motes on every frame. The
    // radial gradient already fades to transparent, so the look survives.
    expect(trailRules).not.toMatch(/filter: blur/);
    expect(trailRules).not.toMatch(/0 0 28px 6px/);
  });

  test("the trail layer is isolated from the rest of the page", () => {
    expect(cssSource).toMatch(/\.cursor-trail-layer \{[^}]*contain: layout paint/);
  });

  test("both pointer handlers write transform, not layout properties", () => {
    for (const [name, source] of [
      ["AppShell", shellSource],
      ["FullscreenPlayer", fullscreenSource],
    ]) {
      const motes = source.match(/for \(const mote of cursorTrailRefs\.current\)[\s\S]*?\n    \}/)?.[0]
        ?? source.match(/for \(let index = 0; index < cursorTrailRefs\.current\.length[\s\S]*?\n        \}/)?.[0]
        ?? "";
      expect(motes, name).not.toBe("");
      expect(motes, name).toContain("mote.style.transform");
      expect(motes, name).not.toContain("mote.style.left");
      expect(motes, name).not.toContain("mote.style.top");
    }
  });

  test("the shell caches its surface bounds instead of measuring per move", () => {
    expect(shellSource).toContain("shellBoundsRef");
    const handler = shellSource.match(/const handlePointerMove = [\s\S]*?\n  };/)?.[0];
    expect(handler).toBeDefined();
    // Exactly one measure in the handler, and it is guarded by the cache.
    // Counted on the call itself — the explanatory comment above it also
    // mentions `getBoundingClientRect()`.
    const measures = handler.match(/event\.currentTarget\.getBoundingClientRect\(\)/g) ?? [];
    expect(measures.length).toBe(1);
    expect(handler).toMatch(/if \(shellBoundsRef\.current === null\)/);
    // Re-measured on enter and invalidated on resize, so the cache cannot go
    // stale under a stationary cursor.
    expect(shellSource).toMatch(/const handlePointerEnter[\s\S]{0,400}getBoundingClientRect\(\)/);
    expect(shellSource).toContain('window.addEventListener("resize", invalidateBounds)');
  });

  test("no pointer surface measures its bounds on every move", () => {
    // The settings panel carries five blurred sheets, so a forced layout read
    // per pointer move there was the same cost the shell had.
    const move = settingsSource.match(/onPointerMove=\{\(event\) => \{[\s\S]*?\n        \}\}/)?.[0];
    expect(move).toBeDefined();
    expect(move).toMatch(/if \(surfaceBoundsRef\.current === null\)/);
    expect(move).not.toMatch(
      /const rect = event\.currentTarget\.getBoundingClientRect\(\)/,
    );
    expect(settingsSource).toContain('window.addEventListener("resize", invalidateBounds)');
    expect(settingsSource).toMatch(
      /onPointerEnter=\{\(event\) => \{[\s\S]{0,400}getBoundingClientRect\(\)/,
    );
  });
});

describe("the cursor glow does not repaint the viewport", () => {
  test("it is a fixed-size disc moved by transform", () => {
    // It used to be a viewport-sized gradient re-centred on every pointer
    // event, blended with `mix-blend-mode: screen` — a full-screen repaint and
    // re-blend per event, on top of everything else.
    expect(pointerRules).toMatch(/width: 640px !important/);
    expect(pointerRules).toMatch(/height: 640px !important/);
    expect(pointerRules).toMatch(/transform: translate3d\(/);
    expect(pointerRules).toMatch(/closest-side/);
    expect(pointerRules).not.toMatch(/circle at var\(--pointer-x/);
    expect(pointerRules).toMatch(/will-change: transform/);
  });
});

describe("backdrop-filter budget", () => {
  test("no glass surface keeps a brightness() pass", async () => {
    // Every extra colour operation in a backdrop-filter is another pass over
    // the read-back backdrop, on every frame it changes.
    const css = await compileClasses(["liquid-glass"]);
    const filters = [...css.matchAll(/backdrop-filter:blur\([^)]*\)/g)].map((match) => match[0]);
    expect(filters.length).toBeGreaterThan(0);
    for (const filter of filters) {
      expect(filter).not.toContain("brightness(");
    }
  });

  test("blur radii are bounded", async () => {
    const css = await compileClasses(["liquid-glass", "settings-liquid-glass"]);
    const radii = [...css.matchAll(/backdrop-filter:blur\((\d+)px\)/g)].map((match) =>
      Number(match[1]),
    );
    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      expect(radius).toBeLessThanOrEqual(24);
    }
  });
});
