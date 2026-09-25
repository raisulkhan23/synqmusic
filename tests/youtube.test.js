import { describe, expect, test } from "bun:test";
import {
  dedupeMusicItems,
  isCreatorUploadRelevant,
  isLyricVideoTrack,
  isPrimaryMusicResult,
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

describe("creator upload relevance", () => {
  const item = (overrides = {}) => ({
    id: "creator-1",
    title: "nombra101 official latest video",
    artist: "nombra101",
    duration: 240,
    thumbnail: "",
    ...overrides,
  });

  test("accepts a creator upload that matches the typed name", () => {
    expect(isCreatorUploadRelevant(item(), "nombra101")).toBe(true);
  });

  test("rejects unrelated videos even when they contain generic music words", () => {
    expect(
      isCreatorUploadRelevant(
        item({ title: "Random reaction and fan upload", artist: "Random Channel" }),
        "nombra101",
      ),
    ).toBe(false);
  });

  test("rejects fan, reaction, and karaoke noise unless explicitly requested", () => {
    expect(isCreatorUploadRelevant(item({ title: "nombra101 fan reaction" }), "nombra101")).toBe(false);
    expect(isCreatorUploadRelevant(item({ title: "nombra101 karaoke cover" }), "nombra101")).toBe(false);
  });
});

describe("primary music result filtering", () => {
  test("keeps a matching music result", () => {
    expect(
      isPrimaryMusicResult(
        {
          id: "music-1",
          title: "Inferno Clash - Music for FlameFrags",
          artist: "FlameFrags",
          duration: 204,
          thumbnail: "",
        },
        "inferno clash",
      ),
    ).toBe(true);
  });

  test("rejects Clash of Clans gaming results even when they match the query", () => {
    expect(
      isPrimaryMusicResult(
        {
          id: "game-1",
          title: "Introducing The Inferno Tower | Clash of Clans",
          artist: "Clash of Clans",
          duration: 512,
          thumbnail: "",
        },
        "inferno clash",
      ),
    ).toBe(false);
    expect(
      isPrimaryMusicResult(
        {
          id: "game-2",
          title: "New Max Single Inferno Tower vs All Max Troop!",
          artist: "Gaming channel",
          duration: 734,
          thumbnail: "",
        },
        "inferno clash",
      ),
    ).toBe(false);
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
