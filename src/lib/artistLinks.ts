import { cleanArtistName, type YtItem } from "@/lib/youtube";

/**
 * Artist and album routing.
 *
 * SYNQ has no artist table and no album table — there is no stable id for
 * either, only the display strings that came back with a track. These helpers
 * therefore route on those real names, which is the same thing the app already
 * does when it links an artist into a search (`artistSearchQuery`). Nothing
 * here invents an identifier: if a name is missing, there is no link.
 */

/** Fold an album title to something two spellings of the same album match on. */
export function normaliseAlbumName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/\((?:deluxe|expanded|remastered)[^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(album|ep|explicit|single)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** `/artist/Rick Astley` — a real name or nothing. */
export function artistPath(artist: string | null | undefined): string | null {
  const name = artist?.trim();
  if (!name || name === "Unknown artist") return null;
  return `/artist/${encodeURIComponent(name)}`;
}

/** `/album/<artist>/<album>` — both halves must be real. */
export function albumPath(
  artist: string | null | undefined,
  album: string | null | undefined,
): string | null {
  const artistName = artist?.trim();
  const albumName = album?.trim();
  if (!artistName || !albumName) return null;
  if (artistName === "Unknown artist" || albumName === "Single") return null;
  return `/album/${encodeURIComponent(artistName)}/${encodeURIComponent(albumName)}`;
}

/**
 * Split an album route back into its two names.
 *
 * Returns null for anything that is not a usable pair, so a hand-typed or
 * truncated URL produces an honest empty state rather than a search for
 * "undefined".
 */
export function parseAlbumRoute(
  artistParam: string | undefined,
  albumParam: string | undefined,
): { artist: string; album: string } | null {
  const artist = decodeURIComponent(artistParam ?? "").trim();
  const album = decodeURIComponent(albumParam ?? "").trim();
  if (!artist || !album) return null;
  if (artist === "Unknown artist" || album === "Single") return null;
  return { artist, album };
}

/** An album the app actually has tracks for. */
export interface AlbumGroup {
  album: string;
  artist: string;
  items: YtItem[];
  /** Newest first is not known here — callers order by their own rule. */
}

/**
 * Group tracks into the albums they really report.
 *
 * Only tracks whose source supplied an album name are grouped. A track with no
 * album is dropped rather than filed under a placeholder, which is what keeps
 * an album page from silently showing a made-up tracklist.
 */
export function groupByAlbum(items: YtItem[]): AlbumGroup[] {
  const groups = new Map<string, AlbumGroup>();
  for (const item of items) {
    const album = item.album?.trim();
    if (!album) continue;
    const artist = cleanArtistName(item.artist, item.title);
    const key = `${artistKeyOf(artist)}|${normaliseAlbumName(album)}`;
    const existing = groups.get(key);
    if (existing) {
      if (!existing.items.some((entry) => entry.id === item.id)) {
        existing.items.push(item);
      }
      continue;
    }
    groups.set(key, { album, artist, items: [item] });
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

function artistKeyOf(artist: string): string {
  return artist.toLowerCase();
}

/**
 * Do these two items really belong to the same album?
 *
 * Used to filter search results down to the requested album. A missing album
 * on the result is NOT treated as a match: the album page shows only tracks it
 * can actually place.
 */
export function matchesAlbum(item: YtItem, album: string): boolean {
  const itemAlbum = normaliseAlbumName(item.album);
  if (!itemAlbum) return false;
  return itemAlbum === normaliseAlbumName(album);
}

/**
 * Deduplicate a tracklist for display, keeping the first occurrence.
 * Shared with the queue's own duplicate rule so a page and the player agree.
 */
export function uniqueTracks(items: YtItem[]): YtItem[] {
  const seen = new Set<string>();
  const out: YtItem[] = [];
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}
