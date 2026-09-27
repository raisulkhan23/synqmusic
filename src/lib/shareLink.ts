/**
 * Shareable deep links for a single track.
 *
 * The share button used to produce `/search?q=<title> <artist>`, which dumped
 * the recipient on a search box with the query pre-filled: they still had to
 * press search and pick the right row, and a badly tagged track came back as
 * the wrong song entirely. A link to a song should just play that song.
 *
 * The URL carries the track's own id in the path, plus the metadata playback
 * needs in the query string. The metadata has to travel with the link rather
 * than be looked up: remote tracks exist in nobody's saved library, so there
 * is nothing server-side to resolve an id against for a first-time visitor.
 *
 *   /t/<trackId>?n=<title>&a=<artist>&c=<cover>&d=<duration>
 *
 * Short keys, because this ends up in a chat app and gets truncated.
 */

import type { Playable } from "@/lib/playable";

export const TRACK_PATH = "/t";

export type TrackLink = {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
};

/**
 * The id to put in a link. `youtubeId` is preferred because it is the id
 * playback actually needs; a liked-remote track's own `id` can be a database
 * row id that means nothing to the player.
 */
export function shareableId(track: Playable): string {
  return track.youtubeId || track.id;
}

/** The absolute URL to share for a track. */
export function buildTrackShareUrl(origin: string, track: Playable): string {
  const id = shareableId(track);
  const params = new URLSearchParams();
  params.set("n", track.title);
  // The raw artist string can hold several artists; the display layer already
  // reduces it, so keep the full value rather than guessing here.
  if (track.artistName) params.set("a", track.artistName);
  if (track.coverUrl) params.set("c", track.coverUrl);
  if (Number.isFinite(track.duration) && track.duration > 0) {
    params.set("d", String(Math.round(track.duration)));
  }
  return `${origin.replace(/\/$/, "")}${TRACK_PATH}/${encodeURIComponent(id)}?${params.toString()}`;
}

/** Short, human-readable text for the share sheet. */
export function buildTrackShareText(track: Playable): {
  title: string;
  text: string;
} {
  const artist = firstArtist(track.artistName);
  return {
    title: `${track.title} — ${artist}`,
    text: `Listen to ${track.title} by ${artist} on SYNQ`,
  };
}

/** The first artist in a possibly multi-artist string. */
export function firstArtist(artistName: string): string {
  const first = artistName.split(",")[0]?.trim();
  return first || artistName.trim() || "SYNQ";
}

function finiteOr(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse a `/t/:id` link back into a playable track.
 *
 * Returns null when the path has no id, or when the link carries no title —
 * a link with an id and nothing else would produce a nameless, unplayable row
 * in the queue, which is worse than showing the not-found state.
 */
export function parseTrackLink(
  id: string | undefined,
  params: URLSearchParams,
): TrackLink | null {
  if (!id) return null;
  const title = (params.get("n") ?? "").trim();
  if (!title) return null;
  const duration = finiteOr(params.get("d"), 0);
  return {
    id,
    title,
    artist: (params.get("a") ?? "").trim() || "Unknown artist",
    coverUrl: (params.get("c") ?? "").trim(),
    duration,
  };
}

/** Rebuild a playable from a parsed link. */
export function trackLinkToPlayable(link: TrackLink): Playable {
  return {
    id: link.id,
    title: link.title,
    artistName: link.artist,
    albumName: "Single",
    coverUrl: link.coverUrl,
    // The engine resolves the stream from the id, so this is a placeholder
    // that is only used when the direct stream path is unavailable.
    audioUrl: `https://youtu.be/${link.id}`,
    duration: link.duration,
    source: "youtube",
    youtubeId: link.id,
  };
}
