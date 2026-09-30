import { describe, expect, test } from "bun:test";
import {
  fallbackNotice,
  fallbackQueryFor,
  matchScore,
  pickJamendoFallback,
} from "../src/lib/playbackFallback.ts";

/**
 * Cross-provider playback fallback.
 *
 * The failure this exists for: a listener whose blocker stops YouTube AND
 * whose stream rescue is bot-checked from our datacenter IP. Measured live —
 * `youtube.resolveStream` returns `url: null`. For that listener there was no
 * working playback path at all.
 *
 * The rule that matters most here is the one about NOT playing the wrong song.
 * A fallback that silently substitutes something else is worse than one that
 * admits defeat, because the listener hears music and concludes the app works.
 */

const yt = (over = {}) => ({
  id: "yt-1",
  title: "Hyperballad",
  artistName: "Björk",
  duration: 312,
  audioUrl: "",
  youtubeId: "yt-1",
  source: "youtube",
  ...over,
});

const jam = (over = {}) => ({
  jamendoId: "111",
  title: "Hyperballad",
  artistName: "Björk",
  albumName: "",
  coverUrl: "",
  audioUrl: "https://prod-1.storage.jamendo.com/?trackid=111",
  duration: 312,
  licenseUrl: "",
  tags: [],
  shareUrl: "",
  ...over,
});

describe("the search query drops the credit list", () => {
  test("only the first artist is used", () => {
    // "A, B & C" pasted into a search reliably finds nothing.
    expect(fallbackQueryFor(yt({ artistName: "Björk, Someone & Other" }))).toBe(
      "Hyperballad Björk",
    );
  });

  test("a missing artist does not leave a trailing space", () => {
    expect(fallbackQueryFor(yt({ artistName: "" }))).toBe("Hyperballad");
  });
});

describe("matching is lenient about the artist, strict about the song", () => {
  test("the same song scores highest", () => {
    expect(
      matchScore(
        { title: "Hyperballad", artist: "Björk" },
        { title: "Hyperballad", artist: "Björk" },
      ),
    ).toBe(1);
  });

  test("artist spelling differences do not disqualify a real match", () => {
    // A YouTube upload and a Jamendo release spell the credit differently
    // all the time. Being strict here throws away the only playable option.
    const s = matchScore(
      { title: "Hyperballad", artist: "Björk" },
      { title: "Hyperballad", artist: "Bjork" },
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  test("feat noise is stripped before comparing", () => {
    const s = matchScore(
      { title: "Army of Me", artist: "Björk" },
      { title: "Army of Me (feat. Someone)", artist: "Björk" },
    );
    expect(s).toBeGreaterThanOrEqual(0.5);
  });

  test("a different song scores zero and is never chosen", () => {
    expect(
      matchScore(
        { title: "Hyperballad", artist: "Björk" },
        { title: "All Is Full of Love", artist: "Björk" },
      ),
    ).toBe(0);
  });
});

describe("a fallback never plays the wrong song", () => {
  test("it picks the real match", () => {
    const picked = pickJamendoFallback(yt(), [
      jam({ jamendoId: "999", title: "Unrelated Song" }),
      jam(),
    ]);
    expect(picked?.jamendoId).toBe("111");
  });

  test("it returns null rather than the top result when nothing matches", () => {
    // THE important case. Playing "Unrelated Song" would sound like success
    // while being completely wrong.
    const picked = pickJamendoFallback(yt(), [
      jam({ jamendoId: "999", title: "Unrelated Song" }),
      jam({ jamendoId: "888", title: "Different Track" }),
    ]);
    expect(picked).toBeNull();
  });

  test("an empty candidate list is null, not a crash", () => {
    expect(pickJamendoFallback(yt(), [])).toBeNull();
  });

  test("a zero-duration candidate is never chosen", () => {
    // A row with no length cannot be played or seeked, and would hang the
    // player exactly like the failure we are rescuing from.
    const picked = pickJamendoFallback(yt(), [jam({ duration: 0 })]);
    expect(picked).toBeNull();
  });

  test("a title-only match is enough when the artist does not line up", () => {
    const picked = pickJamendoFallback(yt(), [
      jam({ artistName: "Björk Guðmundsdóttir" }),
    ]);
    expect(picked?.jamendoId).toBe("111");
  });
});

describe("the listener is told what happened", () => {
  test("swapping to Jamendo says so", () => {
    expect(fallbackNotice(yt(), { source: "jamendo" })).toContain("Jamendo");
  });

  test("swapping back to YouTube says so", () => {
    expect(fallbackNotice({ source: "jamendo" }, yt())).toContain("YouTube");
  });

  test("it never claims the original would have played", () => {
    // The whole point is honesty: the original source did not work here.
    expect(fallbackNotice(yt(), { source: "jamendo" })).toMatch(/couldn/i);
  });
});
