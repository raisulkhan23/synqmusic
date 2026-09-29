import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const store = readSource("src/store/player.ts");
const fullscreen = readSource("src/components/player/FullscreenPlayer.tsx");
const tidal = readSource("src/convex/tidal.ts");
const importers = readSource("src/lib/importers.ts");
const sources = readSource("src/lib/sources.ts");
const importSection = readSource("src/components/settings/ImportSection.tsx");

const flatStore = store.replace(/\s+/g, " ");

describe("no artificial delay before a song plays", () => {
  test("prefetching the next track no longer waits behind a timer", () => {
    // The 250ms `setTimeout` only delayed the warm-up of the NEXT track. On a
    // quick skip that meant the following song had nothing prepared, which is
    // an audible gap. Preparation runs inline instead, after the current track
    // has already been handed to an engine.
    const start = store.indexOf("function prefetchTrack");
    const end = store.indexOf("function onTimeUpdate");
    const body = store.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The artwork warm-up is unconditional and inline — no wrapping timer.
    expect(body).toMatch(/if \(track\.coverUrl\) \{/);
    // The ONLY timer left is the 15s teardown of the throwaway <audio>, which
    // must stay: it releases the prefetched connection.
    const timers = body.match(/}, (\d[\d_,]*)\);/g) ?? [];
    expect(timers).toHaveLength(1);
    expect(timers[0]).toContain("15_000");
  });

  test("the next track's audio stream is resolved ahead of the click", () => {
    // `ytResolve` is cached per video id, so resolving the upcoming track while
    // it is still playing means the EQ / effect / rescue paths can start the
    // <audio> element on their first frame instead of waiting on a network
    // round trip the moment the listener presses next.
    const start = store.indexOf("function prefetchTrack");
    const body = store.slice(start, store.indexOf("function onTimeUpdate"));
    expect(body).toContain("void ytResolve(track.youtubeId)");
    // And it must never reject into an unhandled rejection.
    expect(body).toContain(".catch(() => undefined)");
  });

  test("prefetched direct audio buffers data, not just metadata", () => {
    // `preload: "metadata"` fetches headers only, so the first play of a
    // catalog track still had to open the connection. "auto" lets the browser
    // buffer ahead of the switch.
    const start = store.indexOf("function prefetchTrack");
    const body = store.slice(start, store.indexOf("function onTimeUpdate"));
    expect(body).toContain('audio.preload = "auto"');
  });

  test("autoplay no longer sits in up to 2.5s of silence between songs", () => {
    // This timeout is not a background guard: the previous song has ENDED, so
    // every millisecond of it is dead air. It is now under a second, and the
    // related mix that takes over on a miss is instant.
    const match = flatStore.match(/const PERSONAL_NEXT_TIMEOUT_MS = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBeLessThanOrEqual(1000);
  });

  test("the recommendation still falls through instead of stalling", () => {
    // Shortening the leash is only safe because a miss still resolves to null
    // and hands over to the related mix rather than leaving a gap.
    expect(flatStore).toMatch(
      /new Promise<null>\(\(resolve\) =>\s*setTimeout\(\(\) => resolve\(null\), PERSONAL_NEXT_TIMEOUT_MS\)/,
    );
  });

  test("the fullscreen video overlay no longer waits before its first attempt", () => {
    // The 250ms (900ms with an effect) warm-up was a frozen thumbnail on every
    // fullscreen open. `attempt` already tolerates an unmounted frame and
    // retries, so it runs on the next tick instead.
    expect(fullscreen).toContain("timer = setTimeout(attempt, 0)");
    expect(fullscreen).not.toContain("hasAudioProcessing() ? 900 : 250");
  });

  test("playback is still handed to the engine immediately", () => {
    // Guard against "removing the delay" being overdone into never starting.
    expect(flatStore).toContain("void audio.play().catch(() => undefined)");
  });
});

describe("Tidal import", () => {
  test("the Tidal importer exists and is a real Convex action", () => {
    expect(tidal).toContain("export const importPlaylist = action({");
    // Relative imports only: the Convex bundler does not resolve the `@/`
    // alias inside src/convex.
    expect(tidal).toContain('from "../lib/importModel"');
    expect(tidal).not.toContain('from "@/');
  });

  test("it uses the official v2 API and the client-credentials flow", () => {
    expect(tidal).toContain("https://openapi.tidal.com/v2");
    expect(tidal).toContain("https://auth.tidal.com/v1/oauth2/token");
    expect(tidal).toContain("grant_type=client_credentials");
  });

  test("it is a metadata source and says so, never an audio one", () => {
    // The single most dangerous lie in a music app would be implying Tidal
    // hands back playable audio. It does not.
    expect(tidal).toContain("never an audio one");
  });

  test("credentials stay on the server and never reach the browser", () => {
    expect(tidal).toContain("process.env.TIDAL_CLIENT_ID");
    expect(tidal).toContain("process.env.TIDAL_CLIENT_SECRET");
    // No client id is threaded through the action args, so it cannot be
    // exfiltrated to the client the way a browser-side key would be.
    expect(tidal).toContain("args: { playlistId: v.string() }");
  });

  test("pagination actually requests Tidal's page size", () => {
    // Tidal's own default is 20 items per page. Omitting `limit` would import
    // a twentieth of every playlist and still report success, so the constant
    // must be genuinely used, not just declared.
    expect(tidal).toContain("const PAGE_SIZE = 100");
    expect(tidal).toMatch(/limit: String\(PAGE_SIZE\)/);
  });

  test("a missing key configuration fails with an actionable code", () => {
    // Developer-portal access is approval based, so an unconfigured
    // deployment must explain itself rather than surface a raw Tidal 401.
    expect(tidal).toContain(
      'if (!clientId || !clientSecret) throw new ImportError("not-configured")',
    );
  });

  test("every provider failure maps onto a code the UI can explain", () => {
    for (const status of [401, 403, 404, 429]) {
      expect(tidal).toContain(`response.status === ${status}`);
    }
  });

  test("Tidal is advertised as a direct import that needs no user auth", () => {
    // It was `needsAuth: true` with a "not open to third-party clients" blurb,
    // which is exactly why an importer existed but was unreachable.
    expect(importers).toContain('label: "Tidal"');
    const block = importers.slice(
      importers.indexOf("tidal: {"),
      importers.indexOf("bandcamp: {"),
    );
    expect(block).toContain("needsAuth: false");
    expect(block).toContain(
      'envVars: ["TIDAL_CLIENT_ID", "TIDAL_CLIENT_SECRET"]',
    );
  });

  test("a pasted Tidal link routes to the importer, not the export hint", () => {
    expect(importSection).toContain("api.tidal.importPlaylist");
    expect(importSection).toContain('detected.service === "tidal"');
    expect(sources).toContain(
      "Tidal playlists import directly from the link above.",
    );
  });
});
