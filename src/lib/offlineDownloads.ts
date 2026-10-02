// ---------------------------------------------------------------------------
// Download orchestration: the flow from "the listener tapped Download" to
// bytes on disk.
//
// The interesting decisions — is this allowed, does it fit, what do we evict —
// are delegated to `offlineStore.ts` so they stay testable. This module is the
// IO around them, plus the status store the UI subscribes to.
//
// ---------------------------------------------------------------------------
// WHY STATUS IS AN EXTERNAL STORE, NOT useState
// ---------------------------------------------------------------------------
// A download outlives the component that started it. Tapping Download on a
// playlist navigates away; the download must keep running and the downloads
// list must show it when the listener comes back. Holding progress in a
// component's state would cancel the download by unmounting it, so this
// follows the same external-store pattern `pwa.ts` uses for service worker
// updates.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import {
  DEFAULT_DOWNLOAD_CAP_BYTES,
  DOWNLOAD_CAP_KEY,
  evaluateDownloadEligibility,
  fitsInQuota,
  offlineCacheKey,
  planEviction,
  resolveDownloadCap,
  type OfflineEntry,
} from "./offlineStore";
import {
  browserRemainingBytes,
  isPersisted,
  offlineSupported,
  readIndex,
  readMirror,
  removeDownload,
  requestPersistence,
  saveDownload,
  totalDownloadedBytes,
} from "./offlineAudio";
// The raw key, compared above. Imported from the store module so this file and
// the writer cannot drift apart.
import { OFFLINE_INDEX_KEY } from "./offlineStore";

/** Per-track status. `error` carries a listener-facing reason. */
export type DownloadStatus = "idle" | "downloading" | "done" | "error";

export interface DownloadState {
  /** trackId → status. */
  status: Record<string, DownloadStatus>;
  /** trackId → message, set only alongside `error`. */
  messages: Record<string, string>;
  /**
   * Bumped on EVERY change.
   *
   * The download index lives in localStorage, which is not reactive. Consumers
   * that need "which tracks are on this device right now" must re-read it when
   * the set changes, and this is the value that tells them so — without it the
   * only change signal would be the object identity of `status`, which does
   * not change when a download is deleted from elsewhere.
   */
  revision: number;
}

let state: DownloadState = { status: {}, messages: {}, revision: 0 };
const listeners = new Set<() => void>();

function emit(next: Partial<DownloadState>): void {
  state = { ...state, ...next, revision: state.revision + 1 };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
const getServerSnapshot = (): DownloadState => ({
  status: {},
  messages: {},
  revision: 0,
});

/** Status for every in-flight or recently finished download. */
export function useDownloads(): DownloadState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * The track ids currently on this device.
 *
 * Reads the SYNCHRONOUS localStorage mirror rather than the IndexedDB index,
 * because this backs a badge in the queue: awaiting a database open to decide
 * whether to draw a small icon would make every queue row render twice.
 *
 * Subscribes to the download store so a track downloaded while the queue is
 * open starts showing its badge without a reload.
 */
let cachedIndexRaw: string | null = null;
let cachedTrackIds: Set<string> = new Set();

/**
 * The downloaded track ids, cached by the raw index text.
 *
 * Keyed on the RAW localStorage string rather than on the store's revision,
 * because the index can be changed by code that never touches this store —
 * the Settings panel's remove and remove-all both do. Comparing the text means
 * any writer invalidates the cache, with no bookkeeping to keep in sync; and
 * because an unchanged text returns the SAME Set instance, React sees a stable
 * value and does not re-render on every pass.
 */
function downloadedIdsSnapshot(): Set<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OFFLINE_INDEX_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedIndexRaw) {
    cachedIndexRaw = raw;
    cachedTrackIds = new Set(readMirror().map((entry) => entry.trackId));
  }
  return cachedTrackIds;
}

export function useDownloadedTrackIds(): Set<string> {
  // Subscribe purely for the re-render. A download finishing, failing or being
  // deleted elsewhere must repaint the rows that show its badge.
  useDownloads();
  // The cache is refreshed in a plain function rather than inline: mutating
  // module state from inside a hook is impure under concurrent rendering, and
  // the React compiler lint rejects it outright. The refresh is idempotent
  // anyway — identical index text yields the same Set instance — so it is safe
  // to call during render.
  return downloadedIdsSnapshot();
}

/** Current status of one track. */
export function useDownloadStatus(trackId: string): DownloadStatus | "idle" {
  const downloads = useDownloads();
  return downloads.status[trackId] ?? "idle";
}

/** A listener-facing outcome. `ok: false` always carries a reason. */
export type DownloadResult =
  | { ok: true; entry: OfflineEntry }
  | { ok: false; reason: string };

/** The listener's chosen download cap, resolved from storage. */
export function readDownloadCap(): number {
  try {
    return resolveDownloadCap(localStorage.getItem(DOWNLOAD_CAP_KEY));
  } catch {
    return DEFAULT_DOWNLOAD_CAP_BYTES;
  }
}

/**
 * A safe filename for the bytes SYNQ writes to disk.
 *
 * Only ever used for a file the listener exports themselves — the app's own
 * cache keys never touch the filesystem. Path separators and `..` are stripped
 * because this string ends up in a download attribute, and a title of
 * "../../etc/passwd" must not become a path.
 */
export function safeFileName(title: string, artistName: string): string {
  const cleaned = `${artistName} - ${title}`
    // Path separators, the characters Windows rejects in filenames, and the
    // hyphen/space range. Control characters are deliberately NOT matched
    // here: the browser sanitises the download attribute itself, and a control
    // range in a source regex is invisible in a diff and easy to corrupt.
    .replace(/[\\/:*?"<>| -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned || "track"}.mp3`.slice(0, 120);
}

/**
 * Download one track to local storage.
 *
 * Refuses early and specifically, in this order, because each refusal needs
 * its own explanation:
 *
 *  1. No storage support at all.
 *  2. No rights. Never negotiable, and never inferred from the URL.
 *  3. No room. Evicts the oldest downloads if that would make room, because
 *     "storage full" with 300 MB of older downloads the listener chose is a
 *     worse answer than "we made room by removing the oldest one".
 *  4. The fetch itself, which can still fail after all of the above passed.
 */
export async function downloadTrack(input: {
  trackId: string;
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
  audioUrl: string;
  /** The provider's own download permission, and the licence to cite. */
  downloadAllowed: boolean;
  licenseUrl: string;
  source: string;
  /** Existing downloads, so eviction can be planned without a second read. */
  entries: OfflineEntry[];
  appCapBytes?: number;
  fetchImpl?: typeof fetch;
  /** Milliseconds before the fetch is abandoned. */
  timeoutMs?: number;
}): Promise<DownloadResult> {
  const {
    trackId,
    title,
    artistName,
    coverUrl,
    duration,
    audioUrl,
    downloadAllowed,
    licenseUrl,
    source,
    entries,
    appCapBytes = readDownloadCap(),
    timeoutMs = 60_000,
  } = input;
  const doFetch = input.fetchImpl ?? fetch;

  const fail = (reason: string): DownloadResult => {
    emit({
      status: { ...state.status, [trackId]: "error" },
      messages: { ...state.messages, [trackId]: reason },
    });
    return { ok: false, reason };
  };

  if (!offlineSupported()) {
    return fail(
      "This browser can't store music offline. Safari on iPhone has no support for it.",
    );
  }

  // Rights first. A quota message for a track that may not be stored is a
  // misleading thing to tell someone.
  const eligibility = evaluateDownloadEligibility({
    downloadAllowed,
    licenseUrl,
  });
  if (!eligibility.eligible) return fail(eligibility.reason!);

  if (!/^https?:\/\//i.test(audioUrl)) {
    return fail("That track has no audio file to download.");
  }

  // Requesting persistence is best-effort and happens HERE rather than at app
  // start: the browser grants it far more readily in response to a user gesture
  // that writes data.
  void requestPersistence();

  const existing = entries.filter((e) => e.trackId !== trackId);
  const usedBytes = totalDownloadedBytes(existing);
  const remaining = await browserRemainingBytes();

  emit({
    status: { ...state.status, [trackId]: "downloading" },
    messages: { ...state.messages, [trackId]: "" },
  });

  let response: Response;
  try {
    response = await doFetch(audioUrl, {
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return fail("Couldn't reach the audio. Check your connection and retry.");
  }

  if (!response.ok) {
    return fail(
      `The audio server refused the download (${response.status}). Try again later.`,
    );
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  const fits =
    declared > 0 &&
    fitsInQuota({
      bytes: declared,
      usedBytes,
      browserRemaining: remaining,
      appCapBytes,
    }).fits;

  if (declared > 0 && !fits) {
    // Evict oldest-first to make room, then re-check against what is ACTUALLY
    // still on disk rather than what the index claims: a stale index would
    // otherwise promise room that isn't there.
    const plan = planEviction({
      entries: existing,
      needBytes: declared,
      usedBytes,
      appCapBytes,
      keepTrackId: trackId,
    });
    for (const victim of plan.evict) {
      await removeDownload(victim.trackId);
    }
    const after = totalDownloadedBytes(
      (await readIndex()).filter((e) => e.trackId !== trackId),
    );
    const recheck = fitsInQuota({
      bytes: declared,
      usedBytes: after,
      browserRemaining: remaining,
      appCapBytes,
    });
    if (!recheck.fits) {
      emit({
        status: { ...state.status, [trackId]: "idle" },
      });
      // Name the actual cause when pins are what stopped it. "Storage full"
      // would send the listener to look at free space on a device that has
      // plenty, when the real answer is that they pinned something.
      const pinned = existing.filter((e) => e.pinned).length;
      if (appCapBytes !== Number.POSITIVE_INFINITY && pinned > 0) {
        return {
          ok: false,
          reason: `This needs more room than you have left, and ${pinned === 1 ? "the track you pinned is" : `the ${pinned} tracks you pinned are`} protected from automatic removal. Unpin one, or raise the download limit in Settings.`,
        };
      }
      return { ok: false, reason: recheck.reason! };
    }
  }

  // The stored size is measured, never trusted. A server that under-reports
  // content-length would otherwise let the quota arithmetic drift permanently
  // out of step with what is really on disk.
  let bytes = declared;
  let toStore = response;
  try {
    const buffer = await response.arrayBuffer();
    bytes = buffer.byteLength;
    toStore = new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "audio/mpeg",
      },
    });
    const final = fitsInQuota({
      bytes,
      usedBytes: totalDownloadedBytes(existing),
      browserRemaining: remaining,
      appCapBytes,
    });
    if (!final.fits) {
      emit({ status: { ...state.status, [trackId]: "idle" } });
      return { ok: false, reason: final.reason! };
    }
  } catch {
    return fail("Couldn't save that file. Your device may be out of space.");
  }

  const entry: OfflineEntry = {
    key: offlineCacheKey(trackId),
    trackId,
    title,
    artistName,
    coverUrl,
    duration,
    bytes,
    savedAt: Date.now(),
    source,
    licenseUrl,
  };

  try {
    await saveDownload(entry, toStore);
  } catch {
    return fail("Couldn't save that file to this device.");
  }

  emit({
    status: { ...state.status, [trackId]: "done" },
    messages: { ...state.messages, [trackId]: "" },
  });
  return { ok: true, entry };
}

/** Whether this origin's downloads are protected from automatic eviction. */
export async function downloadsArePersistent(): Promise<boolean> {
  return isPersisted();
}
