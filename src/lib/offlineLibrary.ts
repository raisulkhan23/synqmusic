// ---------------------------------------------------------------------------
// The offline library snapshot.
//
// An offline mode that only works for audio is not much of an offline mode:
// without a network, Convex is unreachable, so every liked song and playlist
// page renders empty and the app looks broken rather than offline.
//
// This module keeps a small, bounded copy of the listener's OWN library —
// likes, playlists, and the queue — in localStorage, written whenever the
// signed-in session has them in memory. Those three are exactly the surfaces
// that must not look broken offline, and they are all data SYNQ already holds
// client-side, so nothing new is being persisted.
//
// ---------------------------------------------------------------------------
// WHY THIS IS BOUNDED, AND WHY IT IS VALIDATED
// ---------------------------------------------------------------------------
// localStorage is ~5 MB and synchronous. An unbounded snapshot of a large
// library is the classic way to turn "offline mode" into a blank page: the
// quota write throws on the NEXT save, the handler that threw is the one that
// writes likes, and the listener silently loses the ability to like anything.
//
// So: capped entry count, newest-first trim, and every read parsed defensively.
// A malformed row is DROPPED, never rendered — a half-written snapshot should
// show a smaller library, not a library of `undefined`.
// ---------------------------------------------------------------------------

import type { OfflineEntry } from "./offlineStore";
import type { Playable } from "./playable";

const LIKES_KEY = "ss.offlineLikes";
const PLAYLISTS_KEY = "ss.offlinePlaylists";

/** Most liked songs kept. Beyond this the oldest are trimmed. */
export const MAX_OFFLINE_LIKES = 500;

/** Most playlists kept. */
export const MAX_OFFLINE_PLAYLISTS = 100;

/** One liked row, as persisted. */
export interface OfflineLike {
  trackId: string;
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
  youtubeId?: string;
  /**
   * Which provider the like came from, as stored by the server
   * ("youtube", "spotify", …). The Liked page renders a provider badge from
   * it, so a snapshot that dropped it would make every offline row look
   * like a YouTube row regardless of where it actually came from.
   */
  source?: string;
}

/** One playlist, as persisted. Mirrors the Convex shape closely enough to
 *  render the list and its tracks without the network. */
export interface OfflinePlaylist {
  id: string;
  name: string;
  description?: string;
  trackIds: string[];
  trackSnapshots?: OfflineLike[];
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A full quota must never break a like. The snapshot is a convenience for
    // offline use, not the source of truth, so failing to write is acceptable
    // and silent by design — the caller is mid-interaction on a network page.
  }
}

/** Trim to the newest N entries, preserving order. */
export function trimNewest<T>(rows: T[], max: number): T[] {
  return rows.length <= max ? rows : rows.slice(0, max);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Read persisted likes. Rows missing an id or a title are dropped rather than
 * rendered, because a row with no id cannot be liked, unliked or played.
 */
export function readOfflineLikes(): OfflineLike[] {
  const parsed = readJson(LIKES_KEY);
  if (!Array.isArray(parsed)) return [];
  const out: OfflineLike[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const trackId = asString(row.trackId);
    const title = asString(row.title);
    if (!trackId || !title) continue;
    const like: OfflineLike = {
      trackId,
      title,
      artistName: asString(row.artistName),
      coverUrl: asString(row.coverUrl),
      duration:
        typeof row.duration === "number" && Number.isFinite(row.duration)
          ? row.duration
          : 0,
    };
    const youtubeId = asString(row.youtubeId);
    if (youtubeId) like.youtubeId = youtubeId;
    const source = asString(row.source);
    if (source) like.source = source;
    out.push(like);
  }
  return out;
}

export function writeOfflineLikes(likes: OfflineLike[]): void {
  writeJson(LIKES_KEY, trimNewest(likes, MAX_OFFLINE_LIKES));
}

/**
 * Turn a persisted like into a Playable.
 *
 * Mirrors what the Liked page builds for a remote like: the YouTube id is
 * carried explicitly, so playing it offline goes to the local file first
 * (see the player's load path) and only then to the network.
 */
export function offlineLikeToPlayable(like: OfflineLike): Playable {
  const youtubeId = like.youtubeId ?? like.trackId;
  return {
    id: like.trackId,
    title: like.title,
    artistName: like.artistName,
    albumName: "",
    coverUrl: like.coverUrl,
    // "stream" is the placeholder meaning "resolve this YouTube video". It is
    // what the rest of the player already expects for a remote track.
    audioUrl: "stream",
    duration: like.duration,
    source: "youtube",
    youtubeId,
  };
}

export function readOfflinePlaylists(): OfflinePlaylist[] {
  const parsed = readJson(PLAYLISTS_KEY);
  if (!Array.isArray(parsed)) return [];
  const out: OfflinePlaylist[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const id = asString(row.id);
    const name = asString(row.name);
    if (!id || !name) continue;
    const trackIds = Array.isArray(row.trackIds)
      ? row.trackIds.filter((t): t is string => typeof t === "string")
      : [];
    const playlist: OfflinePlaylist = { id, name, trackIds };
    const description = asString(row.description);
    if (description) playlist.description = description;
    if (Array.isArray(row.trackSnapshots)) {
      playlist.trackSnapshots = row.trackSnapshots
        .filter(
          (s): s is Record<string, unknown> => !!s && typeof s === "object",
        )
        .map((s) => ({
          trackId: asString(s.trackId),
          title: asString(s.title),
          artistName: asString(s.artistName),
          coverUrl: asString(s.coverUrl),
          duration:
            typeof s.duration === "number" && Number.isFinite(s.duration)
              ? s.duration
              : 0,
        }))
        .filter((s) => s.trackId && s.title);
    }
    out.push(playlist);
  }
  return out;
}

export function writeOfflinePlaylists(playlists: OfflinePlaylist[]): void {
  writeJson(PLAYLISTS_KEY, trimNewest(playlists, MAX_OFFLINE_PLAYLISTS));
}

/**
 * Snapshot the queue. The queue already persists to `ss.queue`; this mirrors
 * the same rows under its own key so an offline launch has the full shape
 * without reading a format that predates the offline code.
 */
const QUEUE_KEY = "ss.offlineQueue";

export function writeOfflineQueue(queue: Playable[]): void {
  try {
    writeJson(
      QUEUE_KEY,
      trimNewest(
        queue.map((t) => ({
          id: t.id,
          title: t.title,
          artistName: t.artistName,
          coverUrl: t.coverUrl,
          duration: t.duration,
          youtubeId: t.youtubeId ?? "",
        })),
        MAX_OFFLINE_LIKES,
      ),
    );
  } catch {
    /* storage unavailable */
  }
}

export function readOfflineQueue(): Playable[] {
  const parsed = readJson(QUEUE_KEY);
  if (!Array.isArray(parsed)) return [];
  const out: Playable[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const id = asString(row.id);
    if (!id) continue;
    const youtubeId = asString(row.youtubeId);
    out.push({
      id,
      title: asString(row.title),
      artistName: asString(row.artistName),
      albumName: "",
      coverUrl: asString(row.coverUrl),
      audioUrl: "stream",
      duration:
        typeof row.duration === "number" && Number.isFinite(row.duration)
          ? row.duration
          : 0,
      source: "youtube",
      ...(youtubeId ? { youtubeId } : {}),
    });
  }
  return out;
}

/** Drop every snapshot. Called on sign-out so the next listener on this device
 *  does not inherit the previous one's library. */
export function clearOfflineLibrary(): void {
  try {
    localStorage.removeItem(LIKES_KEY);
    localStorage.removeItem(PLAYLISTS_KEY);
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Downloads list re-exported so a page reads offline state from one module. */
export type { OfflineEntry };
