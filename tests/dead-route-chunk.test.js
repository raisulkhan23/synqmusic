import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const main = readSource("src/main.tsx");

const between = (start, end) => {
  const a = main.indexOf(start);
  const b = main.indexOf(end, a);
  expect(a).toBeGreaterThan(-1);
  return main.slice(a, b);
};

describe("a route chunk that never arrives cannot strand the listener", () => {
  test("every route uses the recovering lazy loader, not bare lazy()", () => {
    // THE bug: the URL changed to /artist/... and the page sat on "Loading..."
    // forever, while a hard refresh of that same URL rendered it perfectly.
    // Vite stamps pre-bundled deps with ?v=<hash>; a dev-server restart
    // re-optimises and issues a new hash, so a tab open across the restart
    // requests route chunks against deps the server no longer serves. Bare
    // `lazy()` has no timeout and no recovery, so React stays in Suspense
    // indefinitely.
    const bare = main.match(/= lazy\(\(\) => import\(/g) ?? [];
    expect(bare).toHaveLength(0);
    const routes = main.match(/= lazyRoute\(\(\) => import\(/g) ?? [];
    expect(routes.length).toBeGreaterThanOrEqual(19);
  });

  test("the loader races a timeout, because a dead chunk never settles", () => {
    // A rejection alone is not enough: the request that never arrives is the
    // common case, and only a timer can end it.
    const block = between(
      "function lazyRoute",
      "// Lazy load route components",
    );
    expect(block).toContain("Promise.race");
    expect(block).toContain("ROUTE_CHUNK_TIMEOUT_MS");
    expect(block).toMatch(
      /reject\(new Error\(`Route "\$\{name\}" never loaded`\)\)/,
    );
  });

  test("recovery reloads once, cache-busted, keeping the current URL", () => {
    const block = between(
      "function recoverFromDeadChunk",
      "function lazyRoute",
    );
    expect(block).toContain("window.location.replace(url.toString())");
    expect(block).toContain('url.searchParams.set("_cb"');
    // `assign` would drop the artist the listener was trying to open.
    expect(block).not.toContain("window.location.assign(");
  });

  test("recovery is rate-limited so a broken chunk cannot loop forever", () => {
    // This is the only thing standing between a fix and an infinite reload.
    const block = between(
      "function recoverFromDeadChunk",
      "function lazyRoute",
    );
    expect(block).toContain("CHUNK_RELOAD_COOLDOWN_MS");
    expect(block).toMatch(
      /now - last < CHUNK_RELOAD_COOLDOWN_MS\) return false/,
    );
    // The guard is recorded BEFORE the reload is issued.
    expect(block.indexOf("sessionStorage.setItem")).toBeLessThan(
      block.indexOf("location.replace"),
    );
  });

  test("blocked storage disables recovery instead of risking a loop", () => {
    const block = between(
      "function recoverFromDeadChunk",
      "function lazyRoute",
    );
    expect(block).toMatch(/catch \{\s*return false;/);
  });

  test("a recovered chunk stays pending so no error card flashes on the way out", () => {
    // Resolving would swap the loading state for an error card for a frame
    // before the reload lands, which reads as a second, separate failure.
    const block = between(
      "function lazyRoute",
      "// Lazy load route components",
    );
    expect(block).toContain("return new Promise<never>(() => {})");
  });

  test("the error boundary still catches a chunk that cannot be recovered", () => {
    // If the reload is refused, the listener gets the recovery card rather
    // than an infinite spinner — the two paths must both be covered.
    const block = between(
      "function lazyRoute",
      "// Lazy load route components",
    );
    expect(block).toMatch(
      /if \(recoverFromDeadChunk\(\)\)[^\n]*\n\s*throw error/,
    );
    expect(main).toContain("This page didn&apos;t load");
  });
});
