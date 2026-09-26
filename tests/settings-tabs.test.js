import { describe, expect, test } from "bun:test";
import { compileClasses, readSource } from "./helpers/tailwind-css.js";

const settingsSource = readSource("src/components/settings/SettingsDialog.tsx");
const landingSource = readSource("src/pages/Landing.tsx");
const footerSource = readSource("src/components/landing/SiteFooter.tsx");

/** The pointer-move handler body of a component source. */
function moveHandlerOf(source) {
  return source.match(/const handlePointerMove = [\s\S]*?\n  };/)?.[0] ?? "";
}
const fullscreenSource = readSource("src/components/player/FullscreenPlayer.tsx");
const cssSource = readSource("src/index.css");

describe("settings page category tabs", () => {
  test("the full settings page opts into the two-column tab layout", () => {
    // The same markup also renders the compact dialog, where the rail has to
    // stay a horizontal chip strip, so the layout is opt-in per mode.
    expect(settingsSource).toMatch(/pageMode[\s\S]{0,600}settings-page-grid/);
    // The dialog is max-w-md; a rail plus content needs the wider panel.
    expect(settingsSource).toMatch(/settings-page-grid[\s\S]{0,400}!max-w-5xl/);
  });

  test("the rail and its chip list carry the layout hooks", () => {
    expect(settingsSource).toContain("settings-jump-rail");
    expect(settingsSource).toContain("settings-jump-list");
    expect(settingsSource).toContain("settings-jump-label");
    expect(settingsSource).toContain("settings-tab-active");
    // The marked tab is driven by state, not hardcoded, and stays in step with
    // the section being read.
    expect(settingsSource).toMatch(/setActiveSection\(id\)/);
    expect(settingsSource).toContain("IntersectionObserver");
  });

  test("the rail stops being a second card inside the panel", async () => {
    // It was 82%-opaque card + its own blur + a heavy shadow sitting on the
    // panel's 58% surface, so it read as a black hole in the settings. On wide
    // screens the panel's own glass is the surface and the rail is a list
    // inside it; the compact dialog keeps the floating bar it needs.
    const css = await compileClasses(["overflow-x-auto"]);
    // Minified: `transparent` collapses to `0 0`, and Lightning CSS keeps only
    // the `-webkit-` form of backdrop-filter (both engines honour it).
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar\{[^}]*background:0 0!important/,
    );
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar\{[^}]*backdrop-filter:none!important/,
    );
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar\{[^}]*box-shadow:none!important/,
    );
    // The sheen/tint pseudo-layers are the card chrome too. Leaving them on
    // meant a ghost box was still being clipped to the element's rounded rect
    // on top of the panel — the "corners" that made it look like a
    // mis-shaped card.
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar:before,\.settings-page-grid>\.settings-jump-bar:after\{content:none\}/,
    );
    // The radius stays explicit even with no chrome left.
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar\{[^}]*border-radius:1rem/,
    );
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar:hover\{[^}]*box-shadow:none/,
    );
    // The shouty uppercase label describes the chip strip, not a sidebar.
    expect(css).toMatch(/\.settings-page-grid \.settings-jump-label\{display:none\}/);
    // The active row matches the app's own sidebar nav, not a louder accent.
    expect(css).toMatch(
      /\.settings-jump-list>\.settings-tab-active\{[^}]*background:#ffffff12/,
    );
  });

  test("the rail becomes a sticky left column on wide screens", async () => {
    const css = await compileClasses(["overflow-x-auto", "rounded-full"]);
    expect(css).toMatch(
      /@media \(width>=1024px\)\{\.settings-page-grid\{[^}]*grid-template-columns:12\.5rem minmax\(0,1fr\)/,
    );
    // A sticky item can only travel inside its own grid area, so the rail has
    // to span the rows rather than sit in the first one. Lightning CSS folds
    // `grid-row: 2 / span 60` into the `grid-area` shorthand.
    expect(css).toMatch(/\.settings-page-grid>\.settings-jump-bar\{[^}]*grid-area:2\/1\/span 60/);
    expect(css).toMatch(/\.settings-page-grid>\.settings-jump-bar\{[^}]*align-self:start/);
    // The rail spans 60 rows, so most of them are empty. With the default
    // `align-content: normal` any spare height would be shared across all of
    // them and shove the last section down.
    expect(css).toMatch(/\.settings-page-grid\{[^}]*align-content:start/);
    // The pointer glow is absolutely positioned; a grid column would turn its
    // grid area into the containing block and squash it. The header has to be
    // excluded too: this selector outranks the header rule, so without the
    // `:not` the title is dragged into column 2 and the rail rides up under
    // it. Lightning CSS drops the universal selector.
    expect(css).toMatch(
      /\.settings-page-grid>:not\(\.settings-jump-bar\):not\(\.settings-pointer-glow\):not\(\.settings-header\)\{grid-column:2/,
    );
    expect(css).toMatch(/\.settings-page-grid>\.settings-header\{grid-column:1\/-1\}/);
    // `gap: 0 !important` on the panel is a shorthand, so the clearance between
    // rail and content is padding, not column-gap. Without it the rail sits
    // flush against the section headings.
    expect(css).toMatch(
      /\.settings-page-grid>:not\(\.settings-jump-bar\)[^}]*padding-left:2\.5rem/,
    );
    // `gap: 0 !important` is a shorthand, so the vertical air under the title
    // has to be margin on both the rail and the content column — and it has to
    // be the SAME value, or the rail and the first category stop lining up.
    expect(css).toMatch(
      /\.settings-page-grid>\.settings-jump-bar\{[^}]*margin-top:1\.75rem/,
    );
    expect(css).toMatch(
      /\.settings-page-grid>:not\(\.settings-jump-bar\)[^}]*margin-top:1\.75rem/,
    );
  });
});

describe("keyboard shortcuts are desktop only", () => {
  test("no shortcuts tab, panel or divider below lg", () => {
    // A phone in landscape is wider than the `md` breakpoint, so `md` is not
    // a "mobile" cutoff. All three pieces of the feature are gated at `lg` so
    // they can never drift apart again — a hidden panel behind a visible tab
    // (or a divider left with nothing to separate) is what a partial gate
    // produces.
    expect(settingsSource).toContain('label === "Shortcuts" && "hidden lg:inline-flex"');
    expect(settingsSource).toMatch(/<section className="hidden flex-col gap-2 lg:flex">/);
    expect(settingsSource).not.toMatch(/<section className="hidden flex-col gap-2 sm:flex">/);
    // The divider belongs to the shortcuts block.
    expect(settingsSource).toContain('<Separator className="hidden bg-white/[0.07] lg:block" />');
    expect(settingsSource).not.toContain(
      '<Separator className="hidden bg-white/[0.07] sm:block" />',
    );
  });

  test("the landing shortcuts showcase is desktop only, with no dead anchor", () => {
    const section = landingSource.match(/<section id="shortcuts"[^>]*>/)?.[0] ?? "";
    expect(section).toContain("lg:block");
    expect(section).toContain("hidden");
    // The footer entry was removed earlier, so nothing can jump to a section
    // that is not rendered on a phone.
    expect(landingSource).not.toContain('href="#shortcuts"');
    expect(footerSource).not.toContain("#shortcuts");
  });
});

describe("settings section spacing", () => {
  test("category dividers have room to breathe", () => {
    // The hairline was 1px with no margin, so the last row of a category sat
    // on the line and the next header sat right under it.
    expect(cssSource).toMatch(
      /\.settings-liquid-glass > \[data-slot="separator"\] \{\s*margin-block: 1\.75rem;/,
    );
    // Same reason, at the top: the panel is `gap: 0`, so the first category
    // header sat flush against the sticky jump bar in the compact dialog.
    expect(cssSource).toMatch(
      /\.settings-liquid-glass > #settings-playback \{\s*margin-top: 1\.25rem;/,
    );
  });
});

describe("glass sheen", () => {
  test("the band is wider than the surface it sits on", async () => {
    const css = await compileClasses(["rounded-lg"]);
    // At 250% the bright core fitted inside the panel, so the gradient was
    // sliced by the panel edges and tiled (default `repeat`). Lightning CSS
    // folds size/repeat into the `background` shorthand: `0 0/420% 100%
    // no-repeat`.
    expect(css).toMatch(/\.liquid-glass:before\{[^}]*\/420% 100% no-repeat/);
    expect(css).not.toMatch(/\.liquid-glass:before\{[^}]*\/250% 100%/);
    expect(css).toMatch(/\.settings-jump-glass:before\{[^}]*\/420% 100% no-repeat/);
  });

  test("the sweep stays on the surface for the whole cycle", () => {
    // `background-position` percentages resolve against (box - image), so the
    // stops that worked for the old 250% band (120% -> -40%) sat entirely
    // off-panel once the band went to 420%: the shine was invisible for most
    // of the cycle and the panels read as flat. A 420% band is on screen
    // roughly between -3% and 102%.
    const keyframes = cssSource.match(/@keyframes glass-sheen \{[\s\S]*?\n  \}/)?.[0] ?? "";
    const stops = [...keyframes.matchAll(/background-position: (-?[\d.]+%) 0/g)].map((match) =>
      Number.parseFloat(match[1]),
    );
    expect(stops.length).toBe(2);
    for (const stop of stops) {
      expect(stop).toBeGreaterThan(-10);
      expect(stop).toBeLessThan(110);
    }
  });
});

describe("fullscreen player cursor follow", () => {
  test("pointer bounds are cached instead of measured per move", () => {
    // Measuring the fullscreen surface on every pointermove forced a layout
    // read per event on top of the video and the backdrop filters.
    expect(fullscreenSource).toContain("surfaceBoundsRef");
    const moveHandler = fullscreenSource.match(
      /const handlePointerMove = [\s\S]*?\n  };/,
    )?.[0];
    expect(moveHandler).toBeDefined();
    // The steady state reads the cached rect; the measure only happens when
    // the cache is empty.
    expect(moveHandler).toMatch(/if \(surfaceBoundsRef\.current === null\)/);
    expect(moveHandler).not.toMatch(
      /const bounds = event\.currentTarget\.getBoundingClientRect\(\)/,
    );
    expect(fullscreenSource).toMatch(
      /const handlePointerEnter[\s\S]{0,400}getBoundingClientRect\(\)/,
    );
  });

  test("per-frame trail work is delegated to the shared loop", () => {
    // The player used to run its own rAF + mote writes; both surfaces now use
    // `src/lib/cursorTrail.ts`, whose easing is unit tested in
    // tests/cursor-trail.test.js.
    expect(fullscreenSource).toContain("createCursorTrail");
    expect(moveHandlerOf(fullscreenSource)).toContain("cursorTrailRef.current?.push(");
    expect(fullscreenSource).not.toContain("trailFrameRef");
    expect(fullscreenSource).not.toContain("mote.style.");
  });

  test("the cached bounds are invalidated on resize, not only on pointer enter", () => {
    // Resizing while the cursor sits inside the player fires no pointerenter,
    // so without this the glow and trail stay offset by the size delta.
    expect(fullscreenSource).toMatch(
      /window\.addEventListener\("resize", invalidate\)/,
    );
    expect(fullscreenSource).toMatch(
      /window\.removeEventListener\("resize", invalidate\)/,
    );
  });

  test("fullscreen motes ease faster so the cursor does not read as lagging", () => {
    // The lag constants moved into `src/lib/cursorTrail.ts` when the trail
    // stopped being a CSS transition; the fullscreen set is tighter than the
    // shell's, and that ordering is asserted in tests/cursor-trail.test.js.
    expect(fullscreenSource).toContain("FULLSCREEN_TRAIL_TAUS");
    expect(fullscreenSource).not.toContain("cursor-trail-snap");
  });
});
