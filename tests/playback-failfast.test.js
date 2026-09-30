import { describe, expect, test } from "bun:test";
import {
  giveUpNotice,
  pickJamendoFallback,
} from "../src/lib/playbackFallback.ts";
import { isFatalError } from "../src/lib/youtubePlayer.ts";
import { readSource } from "./helpers/tailwind-css.js";

/**
 * Fail fast, then auto-fallback.
 *
 * The bug that started this: playback was completely dead, with no feedback
 * at all. Two independent causes had to be fixed, and BOTH of them were
 * about failure never being reported:
 *
 *  1. `isFatalError` did not include YT error code 153. That is the code a
 *     network blocker (uBlock/AdGuard/1Blocker) produces when it stops
 *     `youtube.com/embed/*`. Not fatal meant no error surfaced, so nothing
 *     escalated and the only rescue was a 12-second watchdog.
 *  2. `loadApi()` had no `onerror` and no timeout, so a blocked
 *     `youtube.com/iframe_api` left its promise pending FOREVER — play()
 *     neither resolved nor rejected.
 *
 * The excluded-source rule matters just as much: on the self-rescue path the
 * candidate list contains the very stream that just failed, so without
 * excluding it the fallback reloads the same broken audio in an endless loop.
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

describe("a source that just failed is never chosen again", () => {
  test("the failed track is excluded from its own rescue", () => {
    // THE infinite-loop case: a Jamendo track that failed, re-matched against
    // Jamendo. The dead stream is in the candidate list and must be skipped.
    const me = {
      ...jam(),
      id: "jamendo:111",
      youtubeId: "",
      source: "jamendo",
    };
    const picked = pickJamendoFallback(
      me,
      [jam({ jamendoId: "111" })],
      [me.id],
    );
    expect(picked).toBeNull();
  });

  test("exclusion works for a raw jamendo id too", () => {
    expect(
      pickJamendoFallback(yt(), [jam({ jamendoId: "111" })], ["111"]),
    ).toBeNull();
  });

  test("it still finds another upload of the same song", () => {
    const me = {
      ...jam(),
      id: "jamendo:111",
      youtubeId: "",
      source: "jamendo",
    };
    const picked = pickJamendoFallback(
      me,
      [jam({ jamendoId: "111" }), jam({ jamendoId: "222" })],
      [me.id],
    );
    expect(picked?.jamendoId).toBe("222");
  });

  test("excluding nothing keeps the current behaviour", () => {
    expect(pickJamendoFallback(yt(), [jam()])?.jamendoId).toBe("111");
  });

  test("excluding every candidate is null, not a crash", () => {
    const picked = pickJamendoFallback(yt(), [jam()], ["111"]);
    expect(picked).toBeNull();
  });
});

describe("the blocker is named, because that is the only actionable thing", () => {
  test("a blocked provider is named so the listener can allow it", () => {
    const msg = giveUpNotice({ blockedProvider: "YouTube" });
    expect(msg).toContain("YouTube");
    expect(msg).toMatch(/block/i);
    expect(msg).toMatch(/allow/i);
  });

  test("a song nobody hosts is reported as simply unavailable", () => {
    const msg = giveUpNotice({});
    expect(msg).toMatch(/couldn/i);
  });

  test("alternatives change the message when nothing was blocked", () => {
    expect(giveUpNotice({ hasAlternatives: true })).toMatch(/every version/i);
  });

  test("the blocked message wins: it is the more useful one", () => {
    expect(
      giveUpNotice({ blockedProvider: "Jamendo", hasAlternatives: true }),
    ).toContain("Jamendo");
  });
});

describe("a blocked YouTube embed fails immediately, not after 12 seconds", () => {
  test("153 (embedding refused — what a blocker causes) is fatal", () => {
    // This was the bug. Without 153 here, no error was ever surfaced.
    expect(isFatalError(153)).toBe(true);
  });

  test("the codes that were already fatal still are", () => {
    for (const code of [2, 5, 100, 101, 150]) {
      expect(isFatalError(code)).toBe(true);
    }
  });

  test("an unknown code is not escalated into a fallback storm", () => {
    // Escalating on anything unrecognised would tear through the queue on a
    // stray state value, so the set stays explicit.
    for (const code of [-1, 0, 1, 3, 4, 12, 99]) {
      expect(isFatalError(code)).toBe(false);
    }
  });
});

describe("the wired-up player actually does this", () => {
  const playerSrc = readSource("src/store/player.ts");
  const ytSrc = readSource("src/lib/youtubePlayer.ts");
  const barSrc = readSource("src/components/player/PlayerBar.tsx");

  test("the silent watchdog is no longer 12 seconds", () => {
    // 12s of nothing is what was reported. The fatal paths short-circuit long
    // before this, so the watchdog only covers genuinely slow networks.
    expect(playerSrc).toMatch(
      /ytLoadWatchdog = setTimeout\([\s\S]{0,400}?5_000/,
    );
    expect(playerSrc).not.toMatch(
      /ytLoadWatchdog = setTimeout\([\s\S]{0,400}?12_000/,
    );
  });

  test("a blocked iframe_api request rejects instead of hanging forever", () => {
    expect(ytSrc).toContain("tag.onerror");
    expect(ytSrc).toMatch(/API_LOAD_TIMEOUT_MS/);
    expect(ytSrc).toMatch(/finish\(\s*\n?\s*new Error/);
  });

  test("a rejected play() promise is no longer swallowed on load", () => {
    // `.catch(() => undefined)` on the LOAD path was a silent dead end: no
    // element error event, no fallback, just silence.
    expect(playerSrc).toMatch(
      /audio\.play\(\)\.catch\(\(err: unknown\)[\s\S]{0,500}?reportLoadFailure\(seq, track\.id\)/,
    );
  });

  test("resuming an already-good source still swallows its rejection", () => {
    // Guard against over-correction: a NotAllowedError on resume/repeat must
    // not look like a broken source and trigger a fallback storm.
    expect(playerSrc).toContain("void audio.play().catch(() => undefined);");
  });

  test("autoplay-policy rejections are still not treated as broken sources", () => {
    // NotAllowedError means "needs a tap", not "unplayable" — escalating
    // there would swap the song for no reason.
    expect(playerSrc).toContain('name === "NotAllowedError"');
    expect(playerSrc).toContain('name === "AbortError"');
  });

  test("direct-audio tracks get a rescue instead of being dropped", () => {
    // The effect used to bail on `source !== "youtube"`, so a failed Jamendo
    // stream produced silence and not even an error toast.
    expect(barSrc).not.toMatch(
      /if \(!track \|\| track\.source !== "youtube"\) return;/,
    );
    expect(barSrc).toContain("directAudioRetried");
    expect(barSrc).toMatch(
      /if \(track\.source !== "youtube"\)[\s\S]{0,700}?void tryJamendoVersion\(track\)/,
    );
  });

  test("the blocked stream-rescue paths report failure too", () => {
    // A blocked stream host fails silently on the rescue path as well, and
    // that rescue is the last thing standing when YouTube is blocked.
    const guards = playerSrc.match(
      /watchAudioErrors\(audio, seq, track\.id\)/g,
    );
    expect(guards?.length).toBe(3);
  });

  test("the Jamendo rescue excludes the stream that just died", () => {
    expect(barSrc).toContain(
      "pickJamendoFallback(track, result.tracks, [track.id])",
    );
  });

  test("a direct-audio track is only retried once, so it cannot loop", () => {
    expect(barSrc).toContain("directAudioRetried.current.has(track.id)");
    expect(barSrc).toMatch(/directAudioRetried\.current\.size > \d+/);
  });
});
