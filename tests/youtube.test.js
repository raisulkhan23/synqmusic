import { describe, expect, test } from "bun:test";
import { parseMusicListItem } from "../src/convex/youtube";

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

  test("falls back to the first metadata run when no type is present", () => {
    expect(parseMusicListItem(renderer(["Phonk Artist", "3:45"]))).toMatchObject({
      artist: "Phonk Artist",
      kind: "song",
    });
  });
});
