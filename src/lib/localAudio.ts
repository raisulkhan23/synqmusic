// ---------------------------------------------------------------------------
// Importing audio the listener already owns.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// SYNQ streams from YouTube and cannot legally store those recordings, so
// "download this for offline" was never something the app could offer for the
// catalogue. But a listener's OWN files have no such problem: they already hold
// the copy, and putting it in the app is not a new reproduction of anything.
//
// For owned audio this is also simply BETTER than streaming: there is no
// resolver to fail, no bot block, no buffering, no region gate. The file is
// already here. That makes it the one download path worth having.
//
// ---------------------------------------------------------------------------
// WHAT IS DELIBERATELY NOT HERE
// ---------------------------------------------------------------------------
// Nothing in this module fetches anything. It takes a `File` the listener
// picked from their own device and decides whether it can be stored and what to
// call it. There is no URL parsing, no remote fetch, and no provider
// integration — because a path that resolves a web address into an audio file
// is a ripper regardless of how it is dressed up, and the whole point of this
// module is that it is not one.
//
// Everything here is PURE, so the decisions that are easy to get wrong (an
// unplayable file accepted, a title mangled into noise, two files colliding
// onto one id) are testable without a browser or a file system.
// ---------------------------------------------------------------------------

import type { Playable } from "./playable";

/** What the browser can actually decode. Kept narrow on purpose: accepting a
 *  format the <audio> element cannot play produces a download that never
 *  sounds, which reads as a broken player. */
export const SUPPORTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/x-flac",
  "audio/webm",
] as const;

/** Extension fallback, for the many browsers that report an empty `type` for a
 *  picked file — especially on desktop Linux. */
const SUPPORTED_EXTENSIONS = [
  "mp3",
  "m4a",
  "mp4",
  "aac",
  "ogg",
  "oga",
  "opus",
  "wav",
  "flac",
  "webm",
] as const;

/**
 * Per-file ceiling.
 *
 * A 2 GB import would be stored whole, evict everything else on the way in,
 * and take minutes to copy during which the UI looks hung. 200 MB comfortably
 * holds a 20-minute lossless track and stops a mis-picked video file.
 */
export const MAX_LOCAL_FILE_BYTES = 200 * 1024 * 1024;

export interface LocalFileInfo {
  name: string;
  size: number;
  type: string;
}

/**
 * Whether a picked file may be imported.
 *
 * Returns a reason rather than a boolean, because "not audio" and "too big"
 * need different answers and the listener is standing right there holding the
 * file. The check is on the EXTENSION as well as the reported MIME type: a
 * large share of real-world picks arrive with `type: ""`, and rejecting those
 * would make the feature look broken for the exact files it exists to accept.
 */
export function evaluateLocalFile(file: LocalFileInfo): {
  ok: boolean;
  reason?: string;
} {
  const name = (file.name ?? "").trim();
  const type = (file.type ?? "").toLowerCase();

  if (!name) {
    return {
      ok: false,
      reason: "That file has no name, so it can't be stored.",
    };
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, reason: `"${name}" is empty.` };
  }

  if (file.size > MAX_LOCAL_FILE_BYTES) {
    return {
      ok: false,
      reason: `"${name}" is larger than ${Math.round(
        MAX_LOCAL_FILE_BYTES / (1024 * 1024),
      )} MB. Import a smaller file.`,
    };
  }

  const ext = name.includes(".")
    ? name.slice(name.lastIndexOf(".") + 1).toLowerCase()
    : "";
  const typeOk = SUPPORTED_AUDIO_TYPES.includes(
    type as (typeof SUPPORTED_AUDIO_TYPES)[number],
  );
  const extOk = SUPPORTED_EXTENSIONS.includes(
    ext as (typeof SUPPORTED_EXTENSIONS)[number],
  );

  // A declared audio type is trusted even with an odd extension, because the
  // browser is reporting what it will actually decode. Otherwise the extension
  // decides, which is the only signal many picks carry.
  if (!typeOk && !(extOk && (!type || type === "application/octet-stream"))) {
    return {
      ok: false,
      reason: `"${name}" isn't an audio file SYNQ can play.`,
    };
  }

  return { ok: true };
}

/**
 * Derive a title and artist from a filename.
 *
 * "Artist - Title.mp3" is the convention every ripper, store and file manager
 * has used for twenty years, so it is worth honouring — but it is a guess, and
 * the result has to look reasonable when the guess is wrong. A file called
 * "track01.mp3" therefore becomes the title "track01", NOT the artist
 * "track01" with an empty title.
 */
export function deriveLocalMetadata(filename: string): {
  title: string;
  artistName: string;
} {
  const withoutExt = filename.replace(/\.[^.]+$/, "");
  // Underscores are how a filename says "space"; leading track numbers are
  // noise the listener did not name.
  const cleaned = withoutExt
    .replace(/[_]+/g, " ")
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, "")
    .trim();

  const base = cleaned || withoutExt.trim() || "Untitled";
  const separator = base.indexOf(" - ");
  if (separator > 0) {
    const artist = base.slice(0, separator).trim();
    const title = base.slice(separator + 3).trim();
    // Both halves must be non-empty, or "Song - .mp3" would produce a blank
    // title and render as an empty row.
    if (artist && title) return { title, artistName: artist };
  }
  return { title: base, artistName: "Unknown artist" };
}

/**
 * A stable id for an imported file.
 *
 * Namespaced and derived from name + size + lastModified so that re-importing
 * the same file replaces its entry instead of creating a duplicate, while two
 * genuinely different files that happen to share a name stay separate.
 *
 * The result is passed through `encodeURIComponent` at the cache-key layer, so
 * nothing here needs to be filesystem-safe.
 */
export function localTrackId(input: {
  name: string;
  size: number;
  lastModified?: number;
}): string {
  const stamp = Number.isFinite(input.lastModified) ? input.lastModified : 0;
  return `local:${input.name}:${input.size}:${stamp}`;
}

/**
 * Turn an imported file's stored row into a Playable.
 *
 * `audioUrl` is the "stream" placeholder, which is NOT a URL — it is the flag
 * the player reads as "resolve this". For a local track the offline branch
 * intercepts first and finds the bytes on disk, so the resolver is never
 * reached and no network is touched. There is deliberately no `youtubeId`: an
 * imported file has no video, and inventing one would hand the resolver
 * something to look up.
 */
export function localEntryToPlayable(entry: {
  trackId: string;
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
}): Playable {
  return {
    id: entry.trackId,
    title: entry.title,
    artistName: entry.artistName,
    // An imported file carries no album metadata; inventing "Single" would be
    // a fabricated value, the same mistake the YouTube path already removed.
    albumName: "",
    coverUrl: entry.coverUrl,
    audioUrl: "stream",
    duration: entry.duration,
    source: "local",
  };
}

/** Human-readable size for the import list. Mirrors the downloads panel. */
export function describeLocalFile(file: LocalFileInfo): string {
  const mb = file.size / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}
