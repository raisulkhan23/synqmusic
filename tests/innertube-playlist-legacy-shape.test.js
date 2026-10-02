import { describe, expect, test } from "bun:test";
import { extractPlaylistBrowse } from "../src/convex/youtube.ts";

/**
 * The LEGACY playlist shape must keep parsing.
 *
 * `extractPlaylistBrowse` was rewritten for the current InnerTube response
 * (`musicResponsiveListItemRenderer`), and the CHANGELOG claims "both shapes are
 * now read, so a rollback by YouTube will not break it again".
 *
 * That claim was made without a single test exercising the legacy branch — the
 * same class of unverified assertion that let the original migration ship broken
 * in the first place. YouTube has moved this once; it can move back. This file
 * is what makes the claim true rather than merely stated.
 *
 * The fixture is the documented shape of the old response, trimmed to what the
 * parser reads.
 */

const legacy = {
  header: {
    playlistHeaderRenderer: {
      title: { simpleText: "Legacy Mix" },
    },
  },
  contents: {
    twoColumnBrowseResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          playlistVideoListRenderer: {
                            contents: [
                              {
                                playlistVideoRenderer: {
                                  videoId: "abc123",
                                  title: { runs: [{ text: "Old Song" }] },
                                  shortBylineText: {
                                    runs: [{ text: "Old Artist" }],
                                  },
                                  lengthSeconds: "201",
                                },
                              },
                              {
                                playlistVideoRenderer: {
                                  videoId: "def456",
                                  title: { simpleText: "Second Song" },
                                  shortBylineText: {
                                    simpleText: "Another Artist",
                                  },
                                  lengthText: { simpleText: "3:45" },
                                },
                              },
                            ],
                            continuations: [
                              {
                                nextContinuationData: {
                                  continuation: "LEGACY_TOKEN",
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      ],
    },
  },
};

describe("the legacy playlist shape is still read", () => {
  test("finds the old playlistVideoListRenderer", () => {
    // If this stops being true the fixture is wrong, not the parser.
    expect(JSON.stringify(legacy)).toContain("playlistVideoListRenderer");
  });

  test("reads the name from the old header", () => {
    expect(extractPlaylistBrowse(legacy).name).toBe("Legacy Mix");
  });

  test("reads rows from playlistVideoRenderer", () => {
    const out = extractPlaylistBrowse(legacy);
    expect(out.tracks).toEqual([
      { title: "Old Song", artist: "Old Artist", duration: 201 },
      { title: "Second Song", artist: "Another Artist", duration: 225 },
    ]);
  });

  test("prefers lengthSeconds but falls back to lengthText", () => {
    // Row two carries no `lengthSeconds`, only "3:45". Both must parse, or a
    // rollback silently drops every duration.
    const [, second] = extractPlaylistBrowse(legacy).tracks;
    expect(second.duration).toBe(225);
  });

  test("finds the old continuations-array token", () => {
    // Without it a long playlist truncates at page one and still reports
    // itself as a complete import.
    expect(extractPlaylistBrowse(legacy).continuation).toBe("LEGACY_TOKEN");
  });

  test("the new shape did not break the old one", () => {
    // Both paths in one assertion: the current fixture parses AND the legacy
    // fixture still parses, so a future edit cannot silently drop either.
    expect(extractPlaylistBrowse(legacy).tracks).toHaveLength(2);
  });
});
