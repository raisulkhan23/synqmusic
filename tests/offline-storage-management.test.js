import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";

import {
  DEFAULT_DOWNLOAD_CAP_BYTES,
  DOWNLOAD_CAP_CHOICES,
  formatBytes,
  isOfflineCacheKey,
  offlineCacheKey,
  parseOfflineIndex,
  planEviction,
  resolveDownloadCap,
} from "../src/lib/offlineStore.ts";
import {
  readOfflinePlaylists,
  trimNewest,
  writeOfflinePlaylists,
} from "../src/lib/offlineLibrary.ts";

/**
 * Offline storage management.
 *
 * Three behaviours that only matter once someone actually relies on this:
 * a pinned download must survive eviction, a chosen limit must be honoured
 * (and must fail SAFE when corrupt), and a playlist snapshot must not render
 * blank rows.
 */

const CC = "https://creativecommons.org/licenses/by/4.0/";

function entry(trackId, bytes, savedAt, extra = {}) {
  return {
    key: offlineCacheKey(trackId),
    trackId,
    title: `t-${trackId}`,
    artistName: "a",
    coverUrl: "",
    duration: 100,
    bytes,
    savedAt,
    source: "jamendo",
    licenseUrl: CC,
    ...extra,
  };
}

describe("pinned downloads survive eviction", () => {
  test("a pin is never chosen for removal", () => {
    const plan = planEviction({
      entries: [
        entry("pinned", 500, 100, { pinned: true }),
        entry("b", 300, 200),
        entry("c", 300, 300),
      ],
      needBytes: 600,
      usedBytes: 1100,
      appCapBytes: 1000,
    });
    expect(plan.evict.map((e) => e.trackId)).not.toContain("pinned");
    // The newest unpinned entries still get removed; a pin must not shield the
    // entries BEHIND it, or one pin would block all eviction.
    expect(plan.evict.map((e) => e.trackId)).toEqual(["b", "c"]);
  });

  test("when pins are what blocks the download, that is reported", () => {
    // The caller needs to know the space was NOT made, so it can say
    // "unpin something" instead of firing a write that will fail.
    const plan = planEviction({
      entries: [entry("p", 900, 100, { pinned: true })],
      needBytes: 500,
      usedBytes: 900,
      appCapBytes: 1000,
    });
    expect(plan.evict).toEqual([]);
    expect(plan.blockedByPins).toBe(true);
  });

  test("blockedByPins is false when there was enough room anyway", () => {
    const plan = planEviction({
      entries: [entry("p", 100, 100, { pinned: true })],
      needBytes: 100,
      usedBytes: 100,
      appCapBytes: 1000,
    });
    expect(plan.blockedByPins).toBe(false);
  });

  test("re-downloading a track does not evict that same track", () => {
    // Evicting the target would delete the file and then fail to replace it.
    const plan = planEviction({
      entries: [entry("target", 600, 100), entry("b", 600, 200)],
      needBytes: 600,
      usedBytes: 1200,
      appCapBytes: 1000,
      keepTrackId: "target",
    });
    expect(plan.evict.map((e) => e.trackId)).toEqual(["b"]);
  });

  test("a pin round-trips through the index parser", () => {
    const raw = JSON.stringify([
      entry("a", 1, 1, { pinned: true }),
      entry("b", 1, 2),
    ]);
    const parsed = parseOfflineIndex(raw);
    expect(parsed.find((e) => e.trackId === "a").pinned).toBe(true);
    expect(parsed.find((e) => e.trackId === "b").pinned).toBeUndefined();
  });

  test("a corrupt pin value is NOT read as a pin", () => {
    // Failing open here would tell the listener a file was protected while
    // leaving it evictable — the worst of both.
    for (const value of ["true", 1, null, "yes", {}]) {
      const raw = JSON.stringify([entry("a", 1, 1, { pinned: value })]);
      expect(parseOfflineIndex(raw)[0].pinned).toBeUndefined();
    }
  });
});

describe("the download limit", () => {
  test("the default is used when nothing is stored", () => {
    expect(resolveDownloadCap(null)).toBe(DEFAULT_DOWNLOAD_CAP_BYTES);
  });

  test("a stored size is honoured", () => {
    expect(resolveDownloadCap(String(100 * 1024 * 1024))).toBe(
      100 * 1024 * 1024,
    );
  });

  test('"unlimited" resolves to no SYNQ ceiling', () => {
    expect(resolveDownloadCap("unlimited")).toBe(Number.POSITIVE_INFINITY);
  });

  test("a corrupt limit falls back to the default, never to unlimited", () => {
    // Failing open on a parse error would let one bad value fill the device.
    for (const bad of ["", "abc", "-5", "0", "NaN", "{}"]) {
      expect(resolveDownloadCap(bad)).toBe(DEFAULT_DOWNLOAD_CAP_BYTES);
    }
  });

  test("every offered choice is presentable and parseable", () => {
    for (const choice of DOWNLOAD_CAP_CHOICES) {
      expect(choice.label.length).toBeGreaterThan(0);
      if (choice.bytes !== null) {
        expect(choice.bytes).toBeGreaterThan(0);
        expect(resolveDownloadCap(String(choice.bytes))).toBe(choice.bytes);
      }
    }
    expect(formatBytes(DEFAULT_DOWNLOAD_CAP_BYTES)).toBe("300 MB");
  });
});

describe("offline playlist snapshots", () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });

  test("playlists round-trip with their tracks", () => {
    writeOfflinePlaylists([
      {
        id: "p1",
        name: "Road trip",
        trackIds: ["t1", "t2"],
        trackSnapshots: [
          {
            trackId: "t1",
            title: "Song",
            artistName: "Artist",
            coverUrl: "c",
            duration: 10,
          },
        ],
      },
    ]);
    const read = readOfflinePlaylists();
    expect(read).toHaveLength(1);
    expect(read[0].name).toBe("Road trip");
    expect(read[0].trackSnapshots[0].title).toBe("Song");
  });

  test("a playlist with no id or name is dropped, not rendered blank", () => {
    store.set(
      "ss.offlinePlaylists",
      JSON.stringify([
        { id: "ok", name: "Kept", trackIds: [] },
        { id: "no-name", trackIds: [] },
        { name: "no-id", trackIds: [] },
      ]),
    );
    const read = readOfflinePlaylists();
    expect(read).toHaveLength(1);
    expect(read[0].id).toBe("ok");
  });

  test("a malformed trackIds list cannot throw the page", () => {
    store.set(
      "ss.offlinePlaylists",
      JSON.stringify([{ id: "p", name: "n", trackIds: "not-an-array" }]),
    );
    const read = readOfflinePlaylists();
    expect(read).toHaveLength(1);
    expect(read[0].trackIds).toEqual([]);
  });

  test("the playlist snapshot is bounded", () => {
    expect(trimNewest([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });
});

describe("offline surfaces are wired up", () => {
  const read = (p) => readFileSync(p, "utf8");

  test("the queue marks downloaded tracks as playable offline", () => {
    const panel = read("src/components/player/QueuePanel.tsx");
    // The badge must be driven by the download index, and must re-read per
    // row so a download finishing mid-session shows up.
    expect(panel).toMatch(/useDownloadedTrackIds\(\)/);
    expect(panel).toMatch(/downloadedIds\.has\(track\.id\)/);
    expect(panel).toMatch(/Offline/);
  });

  test("playlists fall back to the snapshot, and say so", () => {
    const page = read("src/pages/Playlists.tsx");
    expect(page).toMatch(/readOfflinePlaylists\(\)/);
    expect(page).toMatch(/saved on this device/i);
  });

  test("the empty state is not shown when the query simply has not answered", () => {
    // Offline with no snapshot, the merged list is empty -- claiming "No
    // playlists yet" would tell the listener their data is gone.
    expect(read("src/pages/Playlists.tsx")).toMatch(
      /playlistsQuery !== undefined && playlistsQuery\.length === 0/,
    );
  });

  test("the snapshot is written from the signed-in shell", () => {
    const shell = read("src/components/layout/AppShell.tsx");
    expect(shell).toMatch(/writeOfflinePlaylists\(/);
    expect(shell).toMatch(/writeOfflineLikes\(/);
  });

  test("playing a non-downloaded track offline says why, without refusing", () => {
    const player = read("src/store/player.ts");
    const loadTrackAt = player.indexOf("const loadTrack = async (");
    const body = player.slice(loadTrackAt);
    expect(body).toMatch(/navigator\.onLine === false/);
    expect(body).toMatch(/isn't saved to this device/);
    // It must be a NOTE, not an early return: `navigator.onLine` is a hint and
    // is wrong on captive portals and VPNs. Refusing on it would break tracks
    // that would have played.
    const guard = body.slice(
      body.indexOf("navigator.onLine === false"),
      body.indexOf("navigator.onLine === false") + 600,
    );
    expect(guard).not.toMatch(/return;/);
  });
});
