import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

/**
 * Why the ⌘K hint was clipped, and where it lives now.
 *
 * `CommandPaletteHint` renders a `⌕ Search ⌘K` pill — a magnifier, the word
 * "Search" and a bordered `⌘K` badge, roughly 110px wide with its padding.
 *
 * It was originally mounted ONLY in a 72px collapsed rail, where it overflowed
 * and was sliced off; the fix introduced a width-aware `compact` form. The
 * sidebar has since been reconstructed into the reference's single labelled
 * layout (one 200px sidebar, no rail variants), so the invariant is simpler
 * now: the sidebar is wide enough for the FULL pill, mounts exactly one
 * hint, and never re-introduces a fixed-width rail that cannot fit it.
 *
 * The invariant that still matters: **the palette must be discoverable in the
 * shell, and the hint must drive the same store as the ⌘K hotkey.**
 */

const sidebar = readSource("src/components/layout/Sidebar.tsx");
const palette = readSource("src/components/core/CommandPalette.tsx");

describe("the ⌘K hint in the labelled sidebar", () => {
  test("the sidebar mounts exactly one full-width hint", () => {
    // One 200px sidebar, one mount, and it is NOT the compact icon-only
    // form — the labelled sidebar genuinely fits the full pill.
    const mounts = sidebar.match(/<CommandPaletteHint[^>]*\/>/g) ?? [];
    expect(mounts.length).toBe(1);
    expect(mounts[0]).not.toMatch(/\bcompact\b/);
  });

  test("no fixed-width rail narrower than the pill exists in the sidebar", () => {
    // The old bug: a 110px pill inside a 72px rail. The reconstructed
    // sidebar must not contain any width utility below ~110px for its own
    // container, so the clipping failure mode cannot return.
    expect(sidebar).not.toMatch(/w-\[7[0-9]px\]|w-\[6[0-9]px\]/);
  });

  test("the hint is placed above the account row, inside the sidebar", () => {
    // Discoverability: it sits in the sidebar's bottom cluster, adjacent to
    // the account menu, rather than buried in a route.
    const hintIdx = sidebar.indexOf("<CommandPaletteHint");
    const accountIdx = sidebar.indexOf("<AccountMenu");
    expect(hintIdx).toBeGreaterThan(-1);
    expect(accountIdx).toBeGreaterThan(hintIdx);
  });
});

describe("CommandPaletteHint is width-aware", () => {
  test("it takes a `compact` prop that defaults to the full pill", () => {
    expect(palette).toMatch(/compact = false/);
    // The full form has to stay the default so every other caller is
    // unaffected. The span carries a layout class, so match the element, not
    // the text.
    expect(palette).toMatch(/<span[^>]*>Search<\/span>/);
    expect(palette).toMatch(/<kbd[^>]*>\s*⌘K\s*<\/kbd>/);
  });

  test("the compact form stays a fixed square, for any future narrow mount", () => {
    expect(palette).toMatch(/if \(compact\) \{/);
    const compactBranch = palette.slice(
      palette.indexOf("if (compact) {"),
      palette.indexOf("if (compact) {") + 900,
    );
    expect(compactBranch).toMatch(/size-9/);
    expect(compactBranch).not.toMatch(/<span[^>]*>Search<\/span>/);
    expect(compactBranch).not.toMatch(/<kbd/);
  });

  test("both forms stay reachable and labelled for assistive tech", () => {
    const compactBranch = palette.slice(
      palette.indexOf("if (compact) {"),
      palette.indexOf("if (compact) {") + 900,
    );
    expect(compactBranch).toMatch(/aria-label="Open command palette"/);
    expect(compactBranch).toMatch(/title="Search \(⌘K\)"/);
  });

  test("the mount drives the same store as the ⌘K hotkey", () => {
    expect(palette).toMatch(
      /export function CommandPaletteHint[\s\S]{0,400}usePalette\(\(s\) => s\.setOpen\)/,
    );
  });
});
