import { describe, expect, test } from "bun:test";
import { compileClasses, readSource } from "./helpers/tailwind-css.js";

const settingsSource = readSource("src/components/settings/SettingsDialog.tsx");
const landingSource = readSource("src/pages/Landing.tsx");
const footerSource = readSource("src/components/landing/SiteFooter.tsx");
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
    // The measure survives only as a fallback for a move that arrives before
    // any pointer-enter; the steady state reads the cached rect.
    expect(moveHandler).toContain(
      "surfaceBoundsRef.current ?? event.currentTarget.getBoundingClientRect()",
    );
    expect(fullscreenSource).toMatch(
      /const handlePointerEnter[\s\S]{0,400}getBoundingClientRect\(\)/,
    );
  });

  test("trail motes are written once per frame, not once per event", () => {
    expect(fullscreenSource).toMatch(/trailFrameRef\.current = requestAnimationFrame/);
    expect(fullscreenSource).toMatch(
      /cancelAnimationFrame\(trailFrameRef\.current\)/,
    );
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

  test("fullscreen motes ease faster so the cursor does not read as lagging", async () => {
    const css = await compileClasses(["cursor-trail-layer"]);
    // The layer class is in the selector so this outranks the per-mote
    // `:nth-child(2..5)` durations further down the file.
    expect(css).toMatch(
      /\.cursor-trail-layer \.cursor-trail-snap:nth-child\(n\)\{[^}]*transition-duration:40ms,40ms,\.16s/,
    );
    expect(fullscreenSource).toContain("cursor-trail cursor-trail-snap");
  });
});
