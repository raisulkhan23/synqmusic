import { describe, expect, test } from "bun:test";
import {
  dedupeMusicItems,
  isLyricVideoTrack,
  isMusicTrack,
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

  test("rejects sports and news videos even when they are labeled as singles", () => {
    const sportsVideo = {
      id: "sports-1",
      title: "Skip China Open, No WTA Penalty? Alex Eala Ma... | Music",
      artist: "Crowd Favorite",
      duration: 221,
      thumbnail: "",
    };
    expect(isMusicTrack(sportsVideo)).toBe(false);
    expect(isPrimaryMusicResult(sportsVideo, "China Open")).toBe(false);
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

  test("accepts a matching markerless music upload during fallback search", () => {
    expect(
      isPrimaryMusicResult(
        {
          id: "music-markerless",
          title: "Weightless",
          artist: "Marconi Union",
          duration: 481,
          thumbnail: "",
        },
        "weightless marconi union",
      ),
    ).toBe(true);
  });

  test("does not reject valid songs whose titles use broad gaming or sports words", () => {
    for (const item of [
      {
        id: "army-song",
        title: "Army",
        artist: "Gaming outfit",
        duration: 204,
        thumbnail: "",
      },
      {
        id: "troop-song",
        title: "Troop",
        artist: "Army of One",
        duration: 198,
        thumbnail: "",
      },
      {
        id: "sports-song",
        title: "Sports",
        artist: "Matchbox",
        duration: 221,
        thumbnail: "",
      },
      {
        id: "highlights-song",
        title: "Highlights",
        artist: "The Newsroom",
        duration: 244,
        thumbnail: "",
      },
    ]) {
      expect(isMusicTrack(item)).toBe(true);
      expect(isPrimaryMusicResult(item, item.title)).toBe(true);
    }
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

  test("removes upload suffixes from the displayed song title", () => {
    const noisy = renderer(["Song", " • ", "Nombra101", " • ", "3:14"]);
    noisy.flexColumns[0].musicResponsiveListItemFlexColumnRenderer.text.runs[0].text =
      "Inferno Clash - Music for FlameFrags";
    expect(parseMusicListItem(noisy)).toMatchObject({ title: "Inferno Clash" });
  });

  test("replaces placeholder creator metadata instead of rendering '*'", () => {
    expect(parseMusicListItem(renderer(["Song", " • ", "*", " • ", "3:45"]))).toMatchObject({
      artist: "Unknown artist",
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
