import { describe, expect, test } from "bun:test";
import {
  buildTrackShareText,
  buildTrackShareUrl,
  firstArtist,
  parseTrackLink,
  shareableId,
  trackLinkToPlayable,
  TRACK_PATH,
} from "../src/lib/shareLink";
import { readSource } from "./helpers/tailwind-css.js";

const mainSource = readSource("src/main.tsx");
const fullscreenSource = readSource(
  "src/components/player/FullscreenPlayer.tsx",
);

const track = {
  id: "row-id-42",
  title: "Weightless",
  artistName: "Marconi Union, Someone Else",
  albumName: "Ambient Transmissions",
  coverUrl: "https://img.example/cover.jpg",
  audioUrl: "https://youtu.be/videoid123",
  duration: 481,
  source: "youtube",
  youtubeId: "videoid123",
};

const parse = (url) => {
  const u = new URL(url);
  const prefix = `https://site.example${TRACK_PATH}/`;
  expect(
    u.origin +
      u.pathname.startsWith(prefix.slice(0, prefix.indexOf("/t/") + 3)),
  ).toBeTruthy();
  const id = decodeURIComponent(
    u.pathname.slice(u.pathname.lastIndexOf("/") + 1),
  );
  return { id, params: u.searchParams };
};

describe("a shared track link points at the track, not at a search box", () => {
  test("the id goes in the path, the metadata in the query", () => {
    // The old link was `/search?q=<title> <artist>`: the recipient landed on a
    // search box with the query pre-filled and still had to run the search and
    // pick the right row.
    const url = buildTrackShareUrl("https://site.example", track);
    expect(url.startsWith(`https://site.example${TRACK_PATH}/`)).toBe(true);
    expect(url).not.toContain("/search");

    const { id, params } = parse(url);
    expect(id).toBe("videoid123");
    expect(params.get("n")).toBe("Weightless");
    expect(params.get("a")).toBe("Marconi Union, Someone Else");
    expect(params.get("c")).toBe("https://img.example/cover.jpg");
    expect(params.get("d")).toBe("481");
  });

  test("the link round-trips back to a playable track", () => {
    // This is the whole contract: what is shared must be what plays.
    const { id, params } = parse(
      buildTrackShareUrl("https://site.example", track),
    );
    const parsed = parseTrackLink(id, params);
    expect(parsed).not.toBeNull();
    const playable = trackLinkToPlayable(parsed);
    expect(playable.title).toBe(track.title);
    expect(playable.artistName).toBe(track.artistName);
    expect(playable.coverUrl).toBe(track.coverUrl);
    expect(playable.duration).toBe(481);
    // The engine resolves the stream from the id, so that has to be the one
    // that travelled in the link, not the database row id.
    expect(playable.youtubeId).toBe("videoid123");
  });

  test("playback uses the youtube id, not the row id", () => {
    // A liked remote track's own `id` can be a database row id that means
    // nothing to the player, so a link built from it could not be played.
    expect(shareableId(track)).toBe("videoid123");
    expect(shareableId({ ...track, youtubeId: undefined })).toBe("row-id-42");
  });

  test("titles with awkward characters survive the round trip", () => {
    const awkward = {
      ...track,
      title: 'Track #1 — 100% "Live" & more?',
      artistName: "Sigur Rós / Jónsi",
    };
    const { id, params } = parse(
      buildTrackShareUrl("https://site.example", awkward),
    );
    expect(parseTrackLink(id, params)?.title).toBe(awkward.title);
    expect(parseTrackLink(id, params)?.artist).toBe(awkward.artistName);
  });

  test("a trailing slash on the origin does not double up", () => {
    expect(buildTrackShareUrl("https://site.example/", track)).toMatch(
      /^https:\/\/site\.example\/t\//,
    );
  });
});

describe("a malformed link is refused rather than half-played", () => {
  test("no id, or no title, yields null", () => {
    // An id with no title would put a nameless unplayable row in the queue,
    // which is worse than showing the "link is incomplete" state.
    const good = new URLSearchParams({ n: "Weightless" });
    expect(parseTrackLink(undefined, good)).toBeNull();
    expect(parseTrackLink("", good)).toBeNull();
    expect(parseTrackLink("videoid123", new URLSearchParams())).toBeNull();
    expect(
      parseTrackLink("videoid123", new URLSearchParams({ n: "   " })),
    ).toBeNull();
  });

  test("nonsense metadata falls back instead of producing NaN", () => {
    const parsed = parseTrackLink(
      "videoid123",
      new URLSearchParams({ n: "Weightless", d: "not-a-number" }),
    );
    expect(parsed?.duration).toBe(0);
    // No artist, no cover: placeholders rather than undefined leaking into
    // the player and rendering as "undefined".
    const bare = parseTrackLink("x", new URLSearchParams({ n: "Song" }));
    expect(bare?.artist).toBe("Unknown artist");
    expect(bare?.coverUrl).toBe("");
  });

  test("share text names the first artist, not the whole list", () => {
    expect(firstArtist("Marconi Union, Someone Else")).toBe("Marconi Union");
    expect(firstArtist("Sigur Rós")).toBe("Sigur Rós");
    expect(firstArtist("")).toBe("SYNQ");
    const { title, text } = buildTrackShareText(track);
    expect(title).toBe("Weightless — Marconi Union");
    expect(text).toContain("Marconi Union");
  });
});

describe("the share button and the route cannot disagree", () => {
  test("the share button builds the link from the shared module", () => {
    // The old inline template in the component is what made this drift; both
    // sides now go through one module.
    expect(fullscreenSource).toMatch(
      /buildTrackShareUrl\(\s*window\.location\.origin,\s*current,?\s*\)/,
    );
    expect(fullscreenSource).toMatch(/buildTrackShareText\(current\)/);
    expect(fullscreenSource).not.toContain("/search?q=");
  });

  test("the route is public so a link works for a first-time visitor", () => {
    expect(mainSource).toMatch(
      /<Route path="\/t\/:trackId" element=\{<TrackLink \/>\} \/>/,
    );
    // It must sit OUTSIDE the RequireAuth group, or sharing to someone who
    // has no account would bounce them to sign-up with no way back.
    const route = mainSource.slice(
      mainSource.indexOf('path="/t/:trackId"'),
      mainSource.indexOf('path="/dashboard"'),
    );
    expect(route).not.toContain("RequireAuth");
  });
});
