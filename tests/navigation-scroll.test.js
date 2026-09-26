import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { compile } from "tailwindcss";
import { transform } from "lightningcss";

const root = path.resolve(import.meta.dir, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const scrollTopSource = read("src/components/ScrollToTop.tsx");
const shellSource = read("src/components/layout/AppShell.tsx");
const footerSource = read("src/components/landing/SiteFooter.tsx");

/** Compiles candidate class names through the project's real Tailwind build and
 *  returns the emitted CSS. `build([])` emits nothing, so an empty result
 *  genuinely means "these utilities do not exist" — the license comment that
 *  `build()` always returns is filtered out by matching declarations only. */
async function compileClasses(candidates) {
  const compiler = await compile(read("src/index.css"), {
    base: root,
    loadStylesheet: async (id, baseDir) => {
      const target = id.startsWith(".")
        ? path.resolve(baseDir, id.replace(/^\.\//, ""))
        : path.join(root, "node_modules", id, "index.css");
      if (!fs.existsSync(target)) {
        return { path: target, base: path.dirname(target), content: "" };
      }
      return {
        path: target,
        base: path.dirname(target),
        content: fs.readFileSync(target, "utf8"),
      };
    },
  });
  return transform({
    filename: "out.css",
    code: Buffer.from(compiler.build(candidates)),
    minify: true,
  })
    .code.toString();
}

describe("navigation scroll reset", () => {
  test("resets the app shell scroll container, not just the document", () => {
    // `<main>` is the scroll container inside the shell, so a document-only
    // reset leaves you halfway down the next page. The two must stay in sync:
    // the component queries this attribute, AppShell must tag its element.
    expect(scrollTopSource).toContain("[data-app-scroll]");
    expect(shellSource).toMatch(/<main[\s\S]{0,200}data-app-scroll/);
  });

  test("resets immediately and again after paint", () => {
    // A single effect-time reset lost the race with the new route painting.
    expect(scrollTopSource).toContain("requestAnimationFrame");
    const scheduledFrames = scrollTopSource.match(/requestAnimationFrame/g) ?? [];
    expect(scheduledFrames.length).toBeGreaterThanOrEqual(2);
  });

  test("an in-page anchor wins over the top-of-page reset", () => {
    expect(scrollTopSource).toContain("scrollIntoView");
    expect(scrollTopSource).toMatch(/if \(!hash\) resetToTop\(\)/);
    expect(scrollTopSource).toMatch(/if \(!scrollToAnchor\(\)\) resetToTop\(\)/);
  });

  test("re-running on the same path still resets (location.key in deps)", () => {
    const deps = scrollTopSource.match(/\[pathname, search, hash, key\]/);
    expect(deps).not.toBeNull();
  });
});

describe("footer featured-on badges", () => {
  test("every badge is outlined in white", () => {
    expect(footerSource).toContain("border border-white/70");
    expect(footerSource).toContain("hover:border-white");
  });

  test("each badge declares a radius matching its own artwork", () => {
    const entries = [
      ...footerSource.matchAll(/name: "([^"]+)"[\s\S]*?radius: "([^"]+)"/g),
    ].map(([, name, radius]) => ({ name, radius }));
    expect(entries.length).toBe(4);
    for (const badge of entries) {
      expect(badge.radius).toMatch(/^rounded-(full|lg|xl)$/);
    }
    // The EasyLaunch badge is a pill; boxing it in a rectangle was the tell.
    const easyLaunch = entries.find((badge) => badge.name === "EasyLaunch");
    expect(easyLaunch?.radius).toBe("rounded-full");
  });

  test("the outline utilities actually compile to a visible keyline", async () => {
    const css = await compileClasses([
      "border",
      "border-white/70",
      "hover:border-white",
      "rounded-full",
      "rounded-lg",
      "rounded-xl",
    ]);
    // The emitted selector escapes the slash, so these are string matches:
    // `/\.border-white\/70/` would look for a bare `/` where the CSS has `\/`.
    expect(css).toMatch(/\.border\{[^}]*border-width:1px/);
    expect(css).toContain(".border-white\\/70{border-color:#ffffffb3");
    expect(css).toContain(".hover\\:border-white");
    expect(css).toMatch(/\.rounded-full\{[^}]*border-radius/);
    expect(css).toMatch(/\.rounded-lg\{[^}]*border-radius/);
    expect(css).toMatch(/\.rounded-xl\{[^}]*border-radius/);
  });
});
