import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

/**
 * The "concert darkroom with neon blue signal" theme.
 *
 * A near-black gallery where album art and one cool accent do all the work
 * and the chrome around them stays invisible. These lock in the rules that
 * make that true, so a later change cannot quietly reintroduce a second
 * accent, a drop shadow, or a pill.
 */

const css = readSource("src/index.css");
const appShell = readSource("src/components/layout/AppShell.tsx");
const landing = readSource("src/pages/Landing.tsx");
const footer = readSource("src/components/landing/SiteFooter.tsx");

const tight = (s) => s.replace(/\s+/g, "");

describe("the stage palette", () => {
  test("the eight named tones are the ones the reference specifies", () => {
    const tokens = {
      "--color-obsidian": "#121212",
      "--color-graphite": "#303030",
      "--color-mid-gray": "#666666",
      "--color-fog": "#999999",
      "--color-silver": "#cccccc",
      "--color-bone": "#f2f2f2",
      "--color-white": "#ffffff",
      "--color-signal-blue": "#699fff",
    };
    const flat = tight(css);
    for (const [name, value] of Object.entries(tokens)) {
      expect(flat).toContain(`${name}:${value}`);
    }
  });

  test("the page background is Obsidian, not a near-black approximation", () => {
    expect(tight(css)).toContain("--background:var(--color-obsidian)");
    // The old theme was oklch blue-grey; it is gone from the token layer.
    expect(css).not.toContain("oklch(0.135 0.012 262)");
  });

  test("the type scale, spacing base and layout widths are declared", () => {
    const flat = tight(css);
    for (const token of [
      "--text-caption:12px",
      "--text-body-sm:14px",
      "--text-body:17px",
      "--text-subheading:22px",
      "--text-heading-sm:28px",
      "--text-heading:36px",
      "--text-display:60px",
      "--page-max-width:1200px",
      "--section-gap:64px",
      "--card-padding:16px",
    ]) {
      expect(flat).toContain(token);
    }
  });
});

describe("white is the action colour, blue is only a signal", () => {
  test("the primary fill is white, never the accent", () => {
    // "Do not use #699fff as a CTA background or button fill — the action
    // colour is white."
    expect(tight(css)).toContain("--primary:var(--color-white)");
    expect(tight(css)).toContain("--primary-foreground:var(--color-obsidian)");
  });

  test("the accent is pinned to the signal blue", () => {
    expect(tight(css)).toContain("--tint:105159255");
    expect(appShell).toContain('const SIGNAL_BLUE = "105 159 255"');
  });

  test("album art no longer repaints the chrome by default", () => {
    // It used to default ON, so the first thing anyone saw was a different
    // chrome hue for every song.
    expect(appShell).toContain(
      '() => localStorage.getItem("ss.trackPalettes") === "1"',
    );
  });

  test("the surface palette is not overwritten from the artwork", () => {
    // --primary is the action colour now, so rewriting it per track would
    // repaint every button in the app on every track change.
    expect(appShell).not.toContain("dynamicPaletteStyle");
    expect(appShell).not.toContain('"--primary": `rgb(');
  });

  test("the seven saturated accent swatches are gone", () => {
    expect(appShell).not.toContain("FIXED_TINTS");
    for (const swatch of ["lime", "violet", "rose", "amber", "teal"]) {
      expect(appShell).not.toContain(`${swatch}: "`);
    }
  });

  test("the signature scenes move the gray scale, never the signal", () => {
    // "Do not use multiple saturated accent colors."
    for (const scene of ["aurora", "ember", "tide"]) {
      const block = css.slice(
        css.indexOf(`html[data-scene="${scene}"]`),
        css.indexOf(`html[data-scene="${scene}"]`) + 400,
      );
      expect(block).not.toContain("--tint");
      expect(block).toContain("--background:");
    }
  });
});

describe("flat by construction", () => {
  test("there is exactly one permitted surface effect", () => {
    // "Do not introduce drop shadows on cards or buttons — the system is flat
    // by design" and "there is no shadow stack".
    expect(tight(css)).toContain(
      "--shadow-subtle:rgb(18 18 18 / 0.1)0 0 0 1pxinset".replace(/\s/g, ""),
    );
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map(
      (m) => m[1],
    );
    for (const value of shadows) {
      const body = value.replace(/!\s*important/, "").trim();
      const ok =
        body === "" ||
        body === "none" ||
        body === "var(--shadow-subtle)" ||
        body.startsWith("inset");
      expect(ok).toBe(true);
    }
  });

  test("no surface keeps a backdrop blur", () => {
    // A backdrop-filter re-reads and blurs everything behind the panel on
    // every frame, and these classes sit on the sidebar, both bars, the player
    // and every settings surface at once.
    expect(css).not.toMatch(/backdrop-filter:\s*blur\(/);
  });

  test("no accent bloom is painted into the chrome", () => {
    // "keep the surrounding chrome achromatic". A tint used as a *fill* over
    // a large area is the violation; a tint used as a 1px keyline, a hover
    // border or a glyph colour is the sanctioned accent.
    //
    // So judge each rule as a whole, by its selector, rather than by alpha —
    // a 1px border at 0.55 and a 640px wash at 0.13 are the same number.
    const blooms = [];
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!body.includes("var(--tint)")) continue; // Fills spread colour across an area. A border or a text colour is a
      // 1px hairline and stays allowed; the reference names hairlines as the
      // correct way to define a boundary. So look at the property that
      // actually carries the tint, not just the first one in the rule.
      const carrier = /([\w-]+)\s*:\s*([^;]*var\(--tint\)[^;]*)/.exec(body);
      if (!carrier) continue;
      blooms.push({
        selector: selector.trim().replace(/\s+/g, " "),
        property: carrier[1],
        faded: /transparent/.test(carrier[2]),
      });
    }

    // Every surviving accent fill is an interaction the listener can see and
    // turn off, not decoration sitting behind the content.
    const allowed = new Set([
      ".pointer-glow",
      ".cursor-trail",
      ".click-ripple",
    ]);
    for (const bloom of blooms) {
      const isSpread = /^(background|box-shadow|filter|fill)/.test(
        bloom.property,
      );
      const isAllowed =
        !isSpread ||
        bloom.faded ||
        allowed.has(bloom.selector) ||
        // The progress bar and mobile seek track: 4px tall, brand new, and the
        // only place the accent is allowed to read as a solid fill.
        /mobile-progress-fill|\bprogress\b/.test(bloom.selector);
      expect({ ...bloom, allowed: isAllowed }).toEqual({
        ...bloom,
        allowed: true,
      });
    }

    // "No illustrations, no 3D renders, no abstract graphics" — the two
    // 34rem/42rem accent orbs were blurred discs floating behind every page.
    expect(css).not.toContain("aurora-orb");
    expect(css).not.toContain("aurora-drift");
    expect(appShell).not.toContain("aurora-orb");
  });
});

describe("squared corners", () => {
  test("the base radius is 4px", () => {
    expect(tight(css)).toContain("--radius:4px");
  });

  test("nothing in the app is a pill except the genuinely circular controls", () => {
    // The circular survivors are a scrubber's track and thumb, the two
    // indicator dots, and the carousel's arrow buttons.
    const read = readSource;
    const sources = [
      "src/components/player/PlayerBar.tsx",
      "src/components/player/QueuePanel.tsx",
      "src/components/player/FullscreenPlayer.tsx",
      "src/components/player/TransportControls.tsx",
      "src/components/layout/Sidebar.tsx",
      "src/components/settings/SettingsDialog.tsx",
      "src/pages/Home.tsx",
      "src/pages/Search.tsx",
      "src/pages/Landing.tsx",
      "src/pages/Admin.tsx",
    ];
    for (const file of sources) {
      expect(read(file)).not.toContain("rounded-full");
    }
  });

  test("the circular controls are still circular", () => {
    expect(readSource("src/components/player/SeekBar.tsx")).toContain(
      "rounded-full",
    );
  });

  test("the footer badges all use the 4px image radius", () => {
    const radii = [...footer.matchAll(/radius: "([^"]+)"/g)].map((m) => m[1]);
    expect(radii.length).toBe(4);
    for (const radius of radii) expect(radius).toBe("rounded-[4px]");
  });
});

describe("one typeface, and it whispers at display scale", () => {
  test("the second display family is gone", () => {
    // "Söhne is the only typeface across the system." Inter is the free
    // substitute the reference names, and it carries the 100 weight.
    expect(css).not.toContain("Space Grotesk");
    expect(tight(css)).toContain('--font-display:"Inter"');
  });

  test("weight 100 is actually loaded", () => {
    // The hero sits at 100; without it in the request the browser synthesises
    // a fake thin and the editorial move is lost.
    expect(css).toContain("family=Inter:wght@100");
  });

  test("the hero is set at weight 100, not 700", () => {
    const hero = landing.slice(
      landing.indexOf("<motion.h1"),
      landing.indexOf("<motion.h1") + 600,
    );
    expect(hero).toContain("font-thin");
    expect(hero).not.toContain("font-bold");
  });
});
