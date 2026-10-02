import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { extractPlaylistBrowse } from "../src/convex/youtube.ts";

/**
 * Playlist import, against the REAL response YouTube returns today.
 *
 * "I get errors cloning my playlist from YT Music and Spotify" turned out to be
 * a silent upstream API migration, not a bug in the UI, the route, or the
 * account:
 *
 *   - `playlistVideoListRenderer` — the renderer the parser was written
 *     against — **no longer appears anywhere in the response**. Zero
 *     occurrences.
 *   - `musicResponsiveListItemRenderer` — 100 of them, inside a
 *     `musicPlaylistShelfRenderer` — is what comes back now.
 *   - The header moved too: `musicResponsiveHeaderRenderer`, not
 *     `playlistHeaderRenderer`.
 *
 * The parser therefore found an empty list, produced zero rows, and the action
 * reported "That playlist looks private, empty, or unavailable" — which is what
 * every single listener saw, and which was, for all of them, simply untrue.
 *
 * The fixture is a trimmed slice of a REAL 200 response captured from
 * `youtubei/v1/browse` for playlist `PLMC9KNkIncKtGvr2kFRuXBVmBev6cAJ2u`.
 * A hand-written mock could not have caught this: the whole failure was that
 * the real keys differ from the assumed ones.
 */

const fixture = JSON.parse(
  readFileSync("tests/fixtures/innertube-music-playlist.json", "utf8"),
);

describe("playlist import against the current InnerTube shape", () => {
  test("the captured response really has no playlistVideoListRenderer", () => {
    // Guards the fixture itself. If someone regenerates it from a stale cache
    // this fails, rather than the tests below quietly testing the old shape.
    const raw = JSON.stringify(fixture);
    expect(raw).toContain("musicResponsiveListItemRenderer");
    expect(raw).not.toContain("playlistVideoListRenderer");
  });

  test("reads the playlist name from the new header", () => {
    const out = extractPlaylistBrowse(fixture);
    expect(out.name).toBe("Best Pop Music Videos - Top Pop Hits Playlist");
  });

  test("reads tracks instead of returning none", () => {
    // THE regression: this was zero, and zero became "looks private".
    const out = extractPlaylistBrowse(fixture);
    expect(out.tracks.length).toBe(3);
    expect(out.tracks.length).toBeGreaterThan(0);
  });

  test("reads title, artist and duration off each row", () => {
    const [first, second] = extractPlaylistBrowse(fixture).tracks;
    expect(first).toEqual({
      title: "APT.",
      artist: "ROSÉ, Bruno Mars",
      duration: 174,
    });
    expect(second.artist).toBe("Justin Bieber");
    expect(typeof second.duration).toBe("number");
    expect(second.duration).toBeGreaterThan(0);
  });

  test("separator runs are not mistaken for artists", () => {
    // The artist column is one run PER ARTIST plus " & " separators of their
    // own. Naively joining every run produced "ROSÉ, &, Bruno Mars" — an
    // artist string that matches nothing on YouTube, so the track could never
    // be found later.
    for (const track of extractPlaylistBrowse(fixture).tracks) {
      expect(track.artist).not.toMatch(/&\s*$/);
      expect(track.artist).not.toMatch(/[&|]\s*,/);
      expect(track.artist).not.toMatch(/^[,&\s]/);
      expect(track.artist).not.toMatch(/,\s*&/);
    }
  });

  test("finds the continuation so long playlists page instead of truncating", () => {
    // Without a token, a 250-track playlist imported as its first 100 with
    // `partial: false` — reported to the listener as a complete import.
    const out = extractPlaylistBrowse(fixture);
    expect(typeof out.continuation).toBe("string");
    expect(out.continuation.length).toBeGreaterThan(20);
  });

  test("an empty or unrecognised response still returns no tracks", () => {
    // The honest-failure path must survive: a shape we cannot read has to say
    // so rather than invent rows.
    expect(extractPlaylistBrowse({}).tracks).toEqual([]);
    expect(extractPlaylistBrowse({ contents: [] }).tracks).toEqual([]);
  });
});
