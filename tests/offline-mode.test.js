import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  evaluateDownloadEligibility,
  fitsInQuota,
  formatBytes,
  isOfflineCacheKey,
  offlineCacheKey,
  parseOfflineIndex,
  planEviction,
} from "../src/lib/offlineStore.ts";
import {
  offlineLikeToPlayable,
  readOfflineLikes,
  trimNewest,
  writeOfflineLikes,
} from "../src/lib/offlineLibrary.ts";

/**
 * Offline mode.
 *
 * The rules under test are the ones that make the feature honest rather than
 * merely functional: a track is stored only when its rights holder cleared it,
 * a malformed snapshot must not blank the app, and an app update must not
 * silently delete everything the listener downloaded.
 */

const CC = "https://creativecommons.org/licenses/by-nc/4.0/";

describe("offline eligibility", () => {
  test("a track the artist cleared may be stored", () => {
    expect(
      evaluateDownloadEligibility({
        downloadAllowed: true,
        licenseUrl: CC,
      }).eligible,
    ).toBe(true);
  });

  test("a track the artist did NOT clear is refused", () => {
    const result = evaluateDownloadEligibility({
      downloadAllowed: false,
      licenseUrl: CC,
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/hasn't allowed downloads/i);
  });

  test("a missing flag is treated as NOT cleared, never as permission", () => {
    // Failing closed is the whole point: defaulting the other way would store
    // copies of tracks whose artist never agreed to them.
    expect(
      evaluateDownloadEligibility({
        downloadAllowed: undefined,
        licenseUrl: CC,
      }).eligible,
    ).toBe(false);
  });

  test("a cleared track with no licence has nothing to attribute", () => {
    const result = evaluateDownloadEligibility({
      downloadAllowed: true,
      licenseUrl: "   ",
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/licence/i);
  });

  test("every refusal carries a reason the listener can act on", () => {
    for (const input of [
      { downloadAllowed: false, licenseUrl: CC },
      { downloadAllowed: true, licenseUrl: "" },
    ]) {
      const result = evaluateDownloadEligibility(input);
      expect(result.eligible).toBe(false);
      expect(result.reason && result.reason.length).toBeGreaterThan(10);
    }
  });
});

describe("offline cache keys", () => {
  test("key on the track id, so an expiring stream URL cannot orphan a file", () => {
    const key = offlineCacheKey("abc123");
    expect(key).toContain("abc123");
    // Same track, different URL -> same key. The property that matters.
    expect(offlineCacheKey("abc123")).toBe(offlineCacheKey("abc123"));
  });

  test("a hostile id cannot escape the key namespace", () => {
    const key = offlineCacheKey("../../etc/passwd");
    // `..` survives encoding, but the path SEPARATOR does not — and the
    // separator is what would let a key address a directory above the
    // namespace. The whole id collapses to one path component under the
    // prefix, so the key cannot traverse anywhere.
    expect(key.split("/")).toHaveLength(4);
    expect(key.startsWith("/__offline__/track/")).toBe(true);
    expect(isOfflineCacheKey(key)).toBe(true);
  });

  test("keys this module did not write are rejected", () => {
    expect(isOfflineCacheKey("/assets/index.js")).toBe(false);
    expect(isOfflineCacheKey("/__offline__/track/")).toBe(false);
    expect(isOfflineCacheKey("")).toBe(false);
  });
});

describe("offline quota", () => {
  const cap = 1000;

  test("a file that fits is allowed", () => {
    expect(
      fitsInQuota({
        bytes: 100,
        usedBytes: 500,
        browserRemaining: 5000,
        appCapBytes: cap,
      }).fits,
    ).toBe(true);
  });

  test("SYNQ's own cap and the browser's limit are told apart", () => {
    // They need different advice, which is why this returns a reason.
    expect(
      fitsInQuota({
        bytes: 600,
        usedBytes: 500,
        browserRemaining: 5000,
        appCapBytes: cap,
      }).reason,
    ).toMatch(/SYNQ's download limit/i);
    expect(
      fitsInQuota({
        bytes: 600,
        usedBytes: 0,
        browserRemaining: 100,
        appCapBytes: 1e9,
      }).reason,
    ).toMatch(/out of storage/i);
  });

  test("an empty file is refused rather than stored", () => {
    expect(
      fitsInQuota({
        bytes: 0,
        usedBytes: 0,
        browserRemaining: null,
        appCapBytes: cap,
      }).fits,
    ).toBe(false);
  });

  test("an unknown browser quota does not block a download", () => {
    // `null` means "the browser won't say". Refusing on that would disable
    // downloads entirely in browsers that hide the Storage API.
    expect(
      fitsInQuota({
        bytes: 100,
        usedBytes: 0,
        browserRemaining: null,
        appCapBytes: cap,
      }).fits,
    ).toBe(true);
  });
});

/** A minimal index row. */
function entry(trackId, bytes, savedAt, key) {
  return {
    key: key ?? offlineCacheKey(trackId),
    trackId,
    title: `t-${trackId}`,
    artistName: "a",
    coverUrl: "",
    duration: 100,
    bytes,
    savedAt,
    source: "jamendo",
    licenseUrl: CC,
  };
}

describe("offline eviction", () => {
  test("the oldest downloads go first", () => {
    const plan = planEviction({
      entries: [
        entry("a", 400, 300),
        entry("b", 400, 100),
        entry("c", 400, 200),
      ],
      needBytes: 500,
      usedBytes: 1200,
      appCapBytes: 1000,
    });
    expect(plan.evict.map((e) => e.trackId)).toEqual(["b", "c"]);
    expect(plan.freedBytes).toBe(800);
  });

  test("re-downloading a track never evicts itself", () => {
    // The worst outcome here is evicting the neighbours AND then failing on
    // the track the listener was actually trying to save.
    const target = entry("a", 600, 100);
    const plan = planEviction({
      entries: [target, entry("b", 600, 200)],
      needBytes: 600,
      usedBytes: 1200,
      appCapBytes: 1000,
      keepKey: target.key,
    });
    expect(plan.evict.map((e) => e.trackId)).toEqual(["b"]);
    expect(plan.evict.map((e) => e.key)).not.toContain(target.key);
  });

  test("nothing is evicted when there is already room", () => {
    const plan = planEviction({
      entries: [entry("a", 100, 100)],
      needBytes: 100,
      usedBytes: 100,
      appCapBytes: 1000,
    });
    expect(plan.evict).toEqual([]);
  });
});

describe("offline byte formatting", () => {
  test("sizes a track the way a person reads it", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(52 * 1024)).toBe("52 KB");
    expect(formatBytes(-1)).toBe("0 MB");
  });
});

describe("the downloads index is validated on read", () => {
  test("a corrupt index reads as empty instead of throwing", () => {
    expect(parseOfflineIndex("{not json")).toEqual([]);
    expect(parseOfflineIndex(null)).toEqual([]);
    expect(parseOfflineIndex('{"a":1}')).toEqual([]);
  });

  test("one malformed row does not discard the good ones", () => {
    // This is the property that stops a half-written snapshot from blanking
    // the whole downloads list.
    const good = entry("a", 100, 1);
    const raw = JSON.stringify([good, { key: "nope", trackId: "" }]);
    const parsed = parseOfflineIndex(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trackId).toBe("a");
  });

  test("a row with no cache key is dropped, not repaired", () => {
    const raw = JSON.stringify([{ ...entry("a", 1, 1), key: "/assets/x.js" }]);
    expect(parseOfflineIndex(raw)).toEqual([]);
  });
});

describe("the offline library snapshot", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  test("likes round-trip through storage", () => {
    writeOfflineLikes([
      {
        trackId: "t1",
        title: "Song",
        artistName: "Artist",
        coverUrl: "c",
        duration: 10,
        youtubeId: "y1",
        source: "youtube",
      },
    ]);
    const read = readOfflineLikes();
    expect(read).toHaveLength(1);
    expect(read[0].title).toBe("Song");
    expect(read[0].youtubeId).toBe("y1");
  });

  test("a row without a title is dropped, not rendered blank", () => {
    store.clear();
    store.set(
      "ss.offlineLikes",
      JSON.stringify([
        { trackId: "ok", title: "Kept" },
        { trackId: "no-title" },
        { title: "no-id" },
      ]),
    );
    const read = readOfflineLikes();
    expect(read).toHaveLength(1);
    expect(read[0].trackId).toBe("ok");
  });

  test("the snapshot is bounded, newest first", () => {
    expect(trimNewest([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(trimNewest([1, 2], 5)).toEqual([1, 2]);
  });

  test("a stored like becomes a playable with the right YouTube id", () => {
    const playable = offlineLikeToPlayable({
      trackId: "t1",
      title: "Song",
      artistName: "Artist",
      coverUrl: "",
      duration: 10,
      youtubeId: "y1",
    });
    expect(playable.youtubeId).toBe("y1");
    // "stream" is the placeholder that tells the player to resolve it — and
    // the offline branch intercepts before any resolution is attempted.
    expect(playable.audioUrl).toBe("stream");
  });

  test("a like with no stored YouTube id falls back to the track id", () => {
    const playable = offlineLikeToPlayable({
      trackId: "t1",
      title: "Song",
      artistName: "",
      coverUrl: "",
      duration: 0,
    });
    expect(playable.youtubeId).toBe("t1");
  });
});

describe("the service worker leaves downloads alone", () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

  test("synq-audio is in the protected list", () => {
    // REGRESSION GUARD. The activate handler deletes every `synq-*` cache that
    // is not one of its own. `synq-audio` is the downloads cache and was swept
    // up by that filter, so EVERY app update silently deleted every
    // downloaded track — a feature that looked perfect until the first
    // release shipped.
    expect(sw).toMatch(/PROTECTED_CACHES\s*=\s*\[[^\]]*"synq-audio"/);
  });

  test("the sweep consults the protected list", () => {
    expect(sw).toMatch(/!PROTECTED_CACHES\.includes\(n\)/);
  });

  test("the worker never caches the downloads namespace", () => {
    expect(sw).toMatch(/BYPASS_PATHS\s*=\s*\[[\s\S]{0,400}?"\/__offline__\/"/);
  });

  test("no comment still claims music cannot work offline", () => {
    // The old header asserted the app had no offline audio. That is no longer
    // true, and leaving it would mislead the next person to work on this.
    expect(sw).not.toMatch(/deliberately does NOT try to make music work/i);
  });
});
