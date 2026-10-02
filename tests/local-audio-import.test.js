import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  MAX_LOCAL_FILE_BYTES,
  SUPPORTED_AUDIO_TYPES,
  deriveLocalMetadata,
  describeLocalFile,
  evaluateLocalFile,
  localEntryToPlayable,
  localTrackId,
} from "../src/lib/localAudio.ts";
import {
  offlineCacheKey,
  planEviction,
  isOfflineCacheKey,
} from "../src/lib/offlineStore.ts";

/**
 * Importing the listener's own audio.
 *
 * This is the one download path SYNQ can honestly offer: the file is already
 * theirs, so storing it reproduces nothing and needs nobody's permission.
 * The tests below pin the two things that make it trustworthy — it refuses
 * files it cannot actually play, and it never lets pinning/eviction destroy an
 * import, which cannot be re-downloaded.
 */

const file = (name, size = 1024, type = "audio/mpeg") => ({
  name,
  size,
  type,
});

describe("local file validation", () => {
  test("a normal MP3 is accepted", () => {
    expect(evaluateLocalFile(file("Song.mp3")).ok).toBe(true);
  });

  test("extensions are accepted when the browser reports no MIME type", () => {
    // Most desktop Linux picks arrive with `type: ""`. Rejecting those would
    // make the feature look broken for the very files it exists to accept.
    for (const name of [
      "a.mp3",
      "a.m4a",
      "a.flac",
      "a.wav",
      "a.ogg",
      "a.opus",
      "a.webm",
    ]) {
      expect(evaluateLocalFile(file(name, 1024, "")).ok).toBe(true);
    }
  });

  test("a non-audio file is refused, with a reason naming the file", () => {
    const verdict = evaluateLocalFile(file("holiday.mp4", 1024, "video/mp4"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/holiday\.mp4/);
  });

  test("an executable is refused even though it has a plausible size", () => {
    expect(
      evaluateLocalFile(file("track.exe", 2048, "application/x-msdownload")).ok,
    ).toBe(false);
  });

  test("an empty file is refused rather than stored as silence", () => {
    const verdict = evaluateLocalFile(file("empty.mp3", 0));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/empty/i);
  });

  test("an oversize file is refused and the limit is stated", () => {
    const verdict = evaluateLocalFile(
      file("huge.flac", MAX_LOCAL_FILE_BYTES + 1),
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/200 MB/);
  });

  test("every declared supported type is actually accepted", () => {
    for (const type of SUPPORTED_AUDIO_TYPES) {
      expect(evaluateLocalFile(file("x", 1024, type)).ok).toBe(true);
    }
  });
});

describe("metadata derived from a filename", () => {
  test("Artist - Title is split, the way every file manager writes it", () => {
    expect(deriveLocalMetadata("Boards of Canada - Roygbiv.mp3")).toEqual({
      title: "Roygbiv",
      artistName: "Boards of Canada",
    });
  });

  test("a plain filename becomes the title, not a bogus artist", () => {
    // Guessing an artist here would show the same string twice on the row.
    expect(deriveLocalMetadata("track01.mp3")).toEqual({
      title: "track01",
      artistName: "Unknown artist",
    });
  });

  test("a leading track number is stripped as noise", () => {
    expect(deriveLocalMetadata("07 - Song.mp3").title).toBe("Song");
  });

  test("underscores become spaces", () => {
    expect(deriveLocalMetadata("My_Song_Name.mp3").title).toBe("My Song Name");
  });

  test("a dangling separator does not produce a blank title", () => {
    // "Song - .mp3" must not render as an empty row.
    const meta = deriveLocalMetadata("Song - .mp3");
    expect(meta.title.length).toBeGreaterThan(0);
  });

  test("a name with no extension still yields a title", () => {
    expect(deriveLocalMetadata("Untitled thing").title).toBe("Untitled thing");
  });

  test("an empty name falls back rather than rendering blank", () => {
    expect(deriveLocalMetadata(".mp3").title.length).toBeGreaterThan(0);
  });
});

describe("import ids", () => {
  test("the same file re-imported replaces its entry", () => {
    const a = localTrackId({ name: "s.mp3", size: 10, lastModified: 5 });
    const b = localTrackId({ name: "s.mp3", size: 10, lastModified: 5 });
    expect(a).toBe(b);
  });

  test("two different files sharing a name stay separate", () => {
    const a = localTrackId({ name: "s.mp3", size: 10, lastModified: 5 });
    const b = localTrackId({ name: "s.mp3", size: 20, lastModified: 5 });
    expect(a).not.toBe(b);
  });

  test("the id namespaces so it cannot collide with a YouTube video id", () => {
    expect(localTrackId({ name: "s.mp3", size: 1, lastModified: 1 })).toMatch(
      /^local:/,
    );
  });

  test("a hostile filename yields a valid cache key", () => {
    const id = localTrackId({
      name: "../../etc/passwd",
      size: 1,
      lastModified: 1,
    });
    const key = offlineCacheKey(id);
    expect(isOfflineCacheKey(key)).toBe(true);
    // The separator is encoded, so the key cannot traverse the namespace.
    expect(key.split("/")).toHaveLength(4);
  });

  test('a missing lastModified does not produce "undefined" in the id', () => {
    expect(localTrackId({ name: "s.mp3", size: 1 })).not.toMatch(/undefined/);
  });

  test("sizes are human readable", () => {
    expect(describeLocalFile({ name: "a", size: 5000, type: "" })).toBe("5 KB");
    expect(
      describeLocalFile({ name: "a", size: 5 * 1024 * 1024, type: "" }),
    ).toBe("5.0 MB");
  });
});

describe("an imported file makes a playable track", () => {
  const entry = {
    trackId: "local:song.mp3:10:5",
    title: "Song",
    artistName: "Artist",
    coverUrl: "",
    duration: 0,
  };

  test("it carries its own id and the local source", () => {
    const playable = localEntryToPlayable(entry);
    expect(playable.id).toBe(entry.trackId);
    expect(playable.source).toBe("local");
  });

  test("it claims no video id, so nothing is ever resolved", () => {
    // An invented youtubeId would hand the stream resolver something to look
    // up, which for a local file is always a wasted network round trip.
    expect(localEntryToPlayable(entry).youtubeId).toBeUndefined();
  });

  test('its album is empty rather than a fabricated "Single"', () => {
    expect(localEntryToPlayable(entry).albumName).toBe("");
  });
});

describe("imports are protected from eviction", () => {
  test("every import is written already pinned", () => {
    // A local import cannot be re-downloaded. Evicting one destroys the
    // listener's only copy INSIDE THE APP, and the fix is "pick the file
    // again" — so automatic eviction must never be able to do it.
    const src = readFileSync("src/lib/offlineDownloads.ts", "utf8");
    const start = src.indexOf("export async function importLocalAudioFile");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, start + 4000);
    expect(body).toMatch(/pinned: true/);
  });

  test("an import does NOT evict the listener's other files to fit", () => {
    const src = readFileSync("src/lib/offlineDownloads.ts", "utf8");
    const start = src.indexOf("export async function importLocalAudioFile");
    const body = src.slice(start, start + 4000);
    // Unlike the download path, this one must not call removeDownload.
    expect(body).not.toMatch(/removeDownload\(/);
    expect(body).not.toMatch(/planEviction\(/);
  });

  test("pinned entries are skipped by eviction", () => {
    const plan = planEviction({
      entries: [
        {
          key: offlineCacheKey("local:a"),
          trackId: "local:a",
          title: "import",
          artistName: "",
          coverUrl: "",
          duration: 0,
          bytes: 500,
          savedAt: 1,
          source: "local",
          licenseUrl: "",
          pinned: true,
        },
        {
          key: offlineCacheKey("b"),
          trackId: "b",
          title: "downloaded",
          artistName: "",
          coverUrl: "",
          duration: 0,
          bytes: 500,
          savedAt: 2,
          source: "jamendo",
          licenseUrl: "cc",
        },
      ],
      needBytes: 400,
      usedBytes: 1000,
      appCapBytes: 1000,
    });
    expect(plan.evict.map((e) => e.trackId)).toEqual(["b"]);
  });
});

describe("no ripper was built", () => {
  const src = readFileSync("src/lib/localAudio.ts", "utf8");

  test("localAudio never fetches anything", () => {
    // The module takes a File the listener picked. A path that resolves a web
    // address into an audio file is a ripper whatever it is called.
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/https?:\/\//);
  });

  test("no third-party downloader host appears anywhere in the offline layer", () => {
    for (const path of [
      "src/lib/localAudio.ts",
      "src/lib/offlineAudio.ts",
      "src/lib/offlineDownloads.ts",
      "src/lib/offlineStore.ts",
    ]) {
      const body = readFileSync(path, "utf8");
      expect(body).not.toMatch(
        /ytmp3|y2mate|ssyoutube|savefrom|yt-dlp|youtube-dl/i,
      );
    }
  });
});
