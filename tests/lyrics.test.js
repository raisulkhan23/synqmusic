import { describe, expect, test } from "bun:test";
import { readSource } from "./helpers/tailwind-css.js";

const lyricsSource = readSource("src/convex/lyrics.ts");
const schemaSource = readSource("src/convex/schema.ts");
const playerSource = readSource("src/components/player/FullscreenPlayer.tsx");

describe("lyrics lookup matches more songs", () => {
  test("titles are normalised instead of searched verbatim", () => {
    // The catalogue shape is "Artist - Title (Remaster) [feat. X]", and a
    // verbatim search for that finds nothing in any provider.
    expect(lyricsSource).toMatch(/export function cleanTitle\(title: string\): string/);
    expect(lyricsSource).toMatch(/export function cleanArtist\(artist: string\): string/);
    expect(lyricsSource).toContain('out.replace(/\\((?:[^()]*)\\)/g, " ")');
    expect(lyricsSource).toContain('out.replace(/\\[(?:[^\\][]*)\\]/g, " ")');
    expect(lyricsSource).toMatch(/FEATURED/);
    expect(lyricsSource).toMatch(/VERSION_WORDS/);
  });

  test("every plausible pair is tried, most literal first", () => {
    const body = lyricsSource.slice(lyricsSource.indexOf("export function buildCandidates"));
    const fn = body.slice(0, body.indexOf("\n}"));
    expect(fn).toMatch(/tidy\(title\), artist: tidy\(artist\)/);
    expect(fn).toMatch(/title: cleanT, artist: cleanA/);
    // A title-only lookup rescues a track whose artist field is wrong.
    expect(fn).toMatch(/title: cleanT, artist: ""/);
    expect(fn).toMatch(/const seen = new Set<string>\(\)/);
  });

  test("a title that is only decoration never searches for nothing", () => {
    const body = lyricsSource.slice(lyricsSource.indexOf("export function cleanTitle"));
    const fn = body.slice(0, body.indexOf("\n}"));
    expect(fn).toMatch(/return out\.length >= 2 \? out : tidy\(title\)/);
  });

  test("search results are ranked instead of taken first-come", () => {
    expect(lyricsSource).toMatch(/function similarity\(a: string, b: string\): number/);
    expect(lyricsSource).toMatch(/function rank\(results: LrcRecord\[\], candidate: Candidate/);
    expect(lyricsSource).toMatch(/if \(score > bestScore\)/);
    // A live/acoustic cut is a worse answer than the studio recording, and a
    // duration that is 20s out is usually a different song entirely.
    expect(lyricsSource).toMatch(/score -= 12/);
    expect(lyricsSource).toMatch(/score -= 10/);
  });

  test("synced and plain lyrics are read from one request, with fallbacks", () => {
    // One `/api/get` call returns both LRC and plain text; a second provider
    // covers the songs the first has never heard of.
    expect(lyricsSource).toMatch(/syncedLyrics|plainLyrics/);
    expect(lyricsSource).toMatch(/lyrics\.ovh/);
    expect(lyricsSource).toMatch(/AbortSignal\.timeout/);
  });

  test("a miss is cached too, so a song with no lyrics is only looked up once", () => {
    expect(lyricsSource).toMatch(/CACHE_TTL_MS = 1000 \* 60 \* 60 \* 24 \* 30/);
    expect(lyricsSource).toMatch(/LOOKUP_BUDGET_MS/);
    expect(schemaSource).toMatch(/lyricsCache/);
    expect(schemaSource).toMatch(/byKey/);
  });

  test("the client tells the user when lyrics have no timings", () => {
    // Plenty of songs only exist in the plain-text database; they must still
    // render, just without auto-scroll and highlighting.
    expect(playerSource).toMatch(/No timings/);
    expect(playerSource).toMatch(/synced/);
  });
});
