import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";
import { artistPath } from "../src/lib/artistLinks.ts";

const main = readSource("src/main.tsx");
const row = readSource("src/components/tracks/RemoteTrackRow.tsx");

describe("a stale tab heals itself instead of needing a manual refresh", () => {
  test("the bundle is force-refreshed once per session on boot", () => {
    // The dev server here drops and restarts. A tab open across a restart
    // keeps the module graph it already has, and THAT graph decides which
    // routes exist — so a route added afterwards is simply absent and its
    // links look dead until a hard refresh. This makes the refresh automatic.
    expect(main).toContain("function FreshBundleOnBoot()");
    expect(main).toContain("<FreshBundleOnBoot />");
  });

  test("the refresh happens at most once, so it can never loop", () => {
    // The single most dangerous thing about an automatic reload is a reload
    // loop. The sessionStorage flag is the guard, and it must be set BEFORE
    // the reload is issued.
    const block = main.slice(
      main.indexOf("function FreshBundleOnBoot"),
      main.indexOf("/** Hard guard so runtime errors"),
    );
    const setAt = block.indexOf("sessionStorage.setItem");
    const reloadAt = block.indexOf("location.replace");
    expect(setAt).toBeGreaterThan(-1);
    expect(reloadAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(reloadAt);
    expect(block).toContain('if (sessionStorage.getItem(KEY) === "1") return;');
  });

  test("the refresh keeps the listener on the page they were viewing", () => {
    // `assign` would drop the current route; `replace` keeps the URL and only
    // swaps the cached document.
    expect(main).toContain("window.location.replace(url.toString())");
    expect(main).not.toContain("window.location.assign(");
  });

  test("blocked storage or a blocked reload never breaks boot", () => {
    // Storage can throw in private mode, and a reload can be refused. Either
    // one must fall through to a normal load, never a blank screen.
    const block = main.slice(
      main.indexOf("function FreshBundleOnBoot"),
      main.indexOf("/** Hard guard so runtime errors"),
    );
    expect(block).toMatch(/try \{[\s\S]*?\} catch \{\s*return;/);
    expect(block).toMatch(/url\.searchParams\.set\("_cb"/);
  });
});

describe("artist links exist on every surface a listener meets one", () => {
  test("list rows link the artist, not just render it as text", () => {
    // Search results and the queue are RemoteTrackRow. The artist name here
    // was the one place with no way through to the artist page at all.
    expect(row).toContain("const artistHref = artistPath(artistName)");
    expect(row).toContain("to={artistHref}");
  });

  test("the row link never triggers the row's own play action", () => {
    expect(row).toContain("onClick={(event) => event.stopPropagation()}");
  });

  test("an unusable artist name falls back to plain text", () => {
    // artistPath returns null for "Unknown artist" and blanks, so the line
    // must still render rather than producing a link to nowhere.
    expect(row).toContain("{artistHref ? (");
    expect(row).toContain("artistName\n            )}");
    expect(artistPath("Unknown artist")).toBeNull();
    expect(artistPath("")).toBeNull();
    expect(artistPath("   ")).toBeNull();
  });
});
