// ---------------------------------------------------------------------------
// Offline storage: the parts you can reason about without a browser.
//
// Everything in this file is PURE — no IndexedDB, no fetch, no navigator — so
// the decisions that actually matter (may this track be stored at all? will it
// fit? is this a valid cache key?) are unit testable. The IndexedDB plumbing
// lives in `offlineAudio.ts`.
//
// ---------------------------------------------------------------------------
// WHY DOWNLOADS ARE GATED BY LICENCE, NOT BY CONVENIENCE
// ---------------------------------------------------------------------------
// SYNQ resolves audio from YouTube. Those streams are NOT licensed for
// redistribution: writing one to a listener's disk is a copy of someone else's
// copyrighted recording, which is why SYNQ has never offered a download button
// and why the service worker explicitly refuses to cache audio ranges.
//
// There is exactly one source in this app that IS licensed for offline
// storage: Jamendo, a Creative Commons platform whose API publishes a
// per-track `audiodownload_allowed` flag. An artist can withdraw download
// rights for an individual track, so the flag is checked per track and a
// track that is not cleared is simply never offered a download.
//
// The consequence is deliberate and worth stating plainly: a YouTube track in
// SYNQ cannot be downloaded, and no amount of local caching changes that. What
// the offline layer buys is (a) the app opens and is fully browsable with no
// network, and (b) rights-cleared audio genuinely plays with the network off.
// ---------------------------------------------------------------------------

/** localStorage convention shared by every other SYNQ preference. */
export const OFFLINE_ENABLED_KEY = "ss.offlineMode";

/** Downloaded tracks, mirrored out of IndexedDB so the list can render
 *  synchronously. IndexedDB holds the bytes; this holds the index. */
export const OFFLINE_INDEX_KEY = "ss.offlineIndex";

/** One row of the downloads index. */
export interface OfflineEntry {
  /** Cache key — see {@link offlineCacheKey}. Stable across sessions. */
  key: string;
  /** The track's own id, so a downloaded row can be matched to a queue entry. */
  trackId: string;
  title: string;
  artistName: string;
  coverUrl: string;
  /** Seconds. Carried so the UI can size a row without the network. */
  duration: number;
  /** Bytes actually stored, measured after the write — not the estimate. */
  bytes: number;
  /** Epoch ms the entry was written. Drives the "clear oldest" eviction. */
  savedAt: number;
  /** Where the bytes came from, so the UI can name the source of a track. */
  source: string;
  /**
   * The Creative Commons licence URL this track was downloaded under.
   *
   * Attribution is a LICENCE CONDITION, not a courtesy: an offline copy of a
   * CC track that cannot be traced back to its licence is a licence
   * violation. It is stored, shown in the downloads list, and required.
   */
  licenseUrl: string;
}

/**
 * Whether a given audio source may be written to local storage at all.
 *
 * This is a rights question, not a technical one, and it is answered from
 * data the provider supplies rather than from anything SYNQ decides.
 */
export interface DownloadEligibility {
  eligible: boolean;
  /** Why not, when `eligible` is false. Written for the listener, not logs. */
  reason?: string;
}

/**
 * The one rule: only audio the provider has cleared for download.
 *
 * `downloadAllowed` comes straight from the upstream `audiodownload_allowed`
 * field, which an artist can set to false for any individual track. A missing
 * flag is treated as NOT cleared — defaulting the other way would store
 * tracks whose artist never agreed to it.
 */
export function evaluateDownloadEligibility(input: {
  downloadAllowed: boolean;
  licenseUrl: string;
}): DownloadEligibility {
  if (!input.downloadAllowed) {
    return {
      eligible: false,
      reason:
        "This track's artist hasn't allowed downloads, so SYNQ won't store a copy.",
    };
  }
  // A cleared download with no licence to cite is not usable: the attribution
  // a CC download requires would have nowhere to point.
  if (!input.licenseUrl.trim()) {
    return {
      eligible: false,
      reason:
        "This track has no licence attached, so there's no attribution to store it under.",
    };
  }
  return { eligible: true };
}

/**
 * The cache key for a downloaded track.
 *
 * Keyed on the TRACK id rather than the audio URL on purpose. Stream URLs are
 * signed and expire; keying on one would silently orphan a stored file the
 * moment its signature rolled over. The track id is stable for the life of
 * the track.
 *
 * Validated rather than interpolated: the key becomes a Cache Storage URL, and
 * an unescaped id could otherwise address a path the app never meant to write.
 */
export function offlineCacheKey(trackId: string): string {
  return `/__offline__/track/${encodeURIComponent(trackId)}`;
}

/** A key this module wrote. Anything else is rejected before it is read. */
export function isOfflineCacheKey(key: string): boolean {
  return (
    typeof key === "string" &&
    key.startsWith("/__offline__/track/") &&
    key.length > "/__offline__/track/".length
  );
}

/**
 * Whether a new download still fits.
 *
 * `headroom` is the smaller of the browser's own remaining quota and SYNQ's
 * self-imposed cap, because a listener who has allowed 4 GB of site data
 * should still not be able to fill it entirely with music by accident.
 *
 * Returns a plain reason string instead of a boolean so the caller can show
 * the listener WHICH limit they hit — "this device is out of space" and "you
 * reached SYNQ's limit" call for different actions.
 */
export function fitsInQuota(input: {
  bytes: number;
  usedBytes: number;
  browserRemaining: number | null;
  appCapBytes: number;
}): { fits: boolean; reason?: string } {
  const { bytes, usedBytes, browserRemaining, appCapBytes } = input;
  if (!(bytes > 0)) {
    return { fits: false, reason: "That file came back empty." };
  }
  const appRemaining = Math.max(0, appCapBytes - usedBytes);
  if (bytes > appRemaining) {
    return {
      fits: false,
      reason:
        "That would push you past SYNQ's download limit. Remove something you've already downloaded.",
    };
  }
  if (browserRemaining !== null && bytes > browserRemaining) {
    return {
      fits: false,
      reason: "Your device is out of storage. Free some space and try again.",
    };
  }
  return { fits: true };
}

/** Default cap on total downloaded audio. Roughly 60 tracks at 5 MB. */
export const DEFAULT_DOWNLOAD_CAP_BYTES = 300 * 1024 * 1024;

/**
 * Decide what to evict so a new download fits.
 *
 * Oldest first, by `savedAt`, and NEVER the entry the download is replacing:
 * re-downloading a track you already have should swap one file for another
 * rather than evicting a neighbour and then evicting itself.
 */
export function planEviction(input: {
  entries: OfflineEntry[];
  needBytes: number;
  usedBytes: number;
  appCapBytes: number;
  /** The key being (re)written. It is exempt, and is already counted above. */
  keepKey?: string;
}): { evict: OfflineEntry[]; freedBytes: number } {
  const { entries, needBytes, usedBytes, appCapBytes, keepKey } = input;
  const evict: OfflineEntry[] = [];
  let freed = 0;
  let projected = usedBytes;

  const candidates = entries
    .filter((e) => e.key !== keepKey)
    .sort((a, b) => a.savedAt - b.savedAt);

  for (const entry of candidates) {
    if (projected + needBytes <= appCapBytes) break;
    evict.push(entry);
    freed += entry.bytes;
    projected -= entry.bytes;
  }
  return { evict, freedBytes: freed };
}

/** Human-readable size for a download row. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * Guard the downloads index read back out of localStorage.
 *
 * localStorage is user-writable and survives across app versions, so this is
 * untrusted input: one malformed row must not blank the whole downloads list.
 * Bad rows are dropped, not repaired — a row missing its cache key cannot be
 * matched to bytes on disk, and guessing would delete the wrong file.
 */
export function parseOfflineIndex(raw: string | null): OfflineEntry[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: OfflineEntry[] = [];
  for (const row of parsed as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const { key, trackId, title, artistName, bytes, savedAt } = row;
    if (typeof key !== "string" || !isOfflineCacheKey(key)) continue;
    if (typeof trackId !== "string" || !trackId) continue;
    if (typeof title !== "string") continue;
    if (typeof artistName !== "string") continue;
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      continue;
    }
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) continue;
    out.push({
      key,
      trackId,
      title,
      artistName,
      coverUrl: typeof row.coverUrl === "string" ? row.coverUrl : "",
      duration:
        typeof row.duration === "number" && Number.isFinite(row.duration)
          ? row.duration
          : 0,
      bytes,
      savedAt,
      source: typeof row.source === "string" ? row.source : "unknown",
      licenseUrl: typeof row.licenseUrl === "string" ? row.licenseUrl : "",
    });
  }
  return out;
}
