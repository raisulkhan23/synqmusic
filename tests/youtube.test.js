import { describe, expect, test } from "bun:test";
import {
  dedupeMusicItems,
  isLyricVideoTrack,
  parseMusicListItem,
} from "../src/convex/youtube";

function column(...runs) {
  return {
    musicResponsiveListItemFlexColumnRenderer: {
      text: { runs: runs.map((text) => ({ text })) },
    },
  };
}

function renderer(meta) {
  return {
    playlistItemData: { videoId: "video-1" },
    flexColumns: [column("Test Track"), column(...meta), column("3:45")],
  };
}

describe("supplemental lyric-video filtering", () => {
  const item = (overrides = {}) => ({
    id: "lyric-1",
    title: "Khusir Anek Range | Achena Atithi | Lyrical Video Song",
    artist: "Rp Creation",
    duration: 245,
    thumbnail: "",
    ...overrides,
  });

  test("accepts the attached lo-fi music-video shape", () => {
    expect(
      isLyricVideoTrack(
        {
          id: "lofi-1",
          title: "This’ll Kill Me Yet | Mahe Mahe Tobo | LoFi Version | NURE AL MISKAT | MUSIC VIDEO",
          artist: "NURE AL MISKAT",
          duration: 304,
          thumbnail: "",
        },
        "This’ll Kill Me Yet",
      ),
    ).toBe(true);
  });

  test("accepts the attached Bengali lyric-video shape", () => {
    expect(isLyricVideoTrack(item(), "Khusir Anek Range Achena Atithi")).toBe(true);
  });

  test("does not treat a generic version label as music evidence", () => {
    expect(
      isLyricVideoTrack(
        item({ title: "Khusir Anek Range Achena Atithi Version", artist: "Random Uploads" }),
        "Khusir Anek Range Achena Atithi",
      ),
    ).toBe(false);
  });

  test("rejects a random video even when it mentions music", () => {
    expect(
      isLyricVideoTrack(
        item({ title: "My reaction to this song", artist: "Vlog Channel" }),
        "Khusir Anek Range Achena Atithi",
      ),
    ).toBe(false);
  });

  test("rejects mixes, interviews, and unknown-length results", () => {
    expect(isLyricVideoTrack(item({ duration: 3600 }), "Khusir Anek Range")).toBe(false);
    expect(isLyricVideoTrack(item({ title: "Song interview", duration: 245 }), "Khusir Anek Range")).toBe(false);
    expect(isLyricVideoTrack(item({ duration: 0 }), "Khusir Anek Range")).toBe(false);
  });

  test("deduplicates ids and normalized title/artist pairs", () => {
    expect(
      dedupeMusicItems([
        item(),
        item({ id: "lyric-2" }),
        item({ id: "lyric-3", title: "  Khusir   Anek Range | Achena Atithi | Lyrical Video Song  " }),
      ]).map((entry) => entry.id),
    ).toEqual(["lyric-1"]);
  });
});

describe("parseMusicListItem", () => {
  test("uses the artist after a Song metadata run", () => {
    expect(parseMusicListItem(renderer(["Song", " • ", "Daft Punk", " • ", "3:45"]))).toMatchObject({
      id: "video-1",
      title: "Test Track",
      artist: "Daft Punk",
      duration: 225,
      kind: "song",
    });
  });

  test("keeps playlists classified as non-song rows", () => {
    expect(parseMusicListItem(renderer(["Playlist", "Daft Punk", "3:45"]))).toMatchObject({
      artist: "Daft Punk",
      kind: "other",
    });
  });

  test("does not promote an untyped row into the primary song results", () => {
    expect(parseMusicListItem(renderer(["Phonk Artist", "3:45"]))).toMatchObject({
      artist: "Phonk Artist",
      kind: "other",
    });
  });
});
