// ---------------------------------------------------------------------------
// Offline audio: actually storing the bytes.
//
// `offlineStore.ts` decides WHAT may be stored. This module does the storing:
// IndexedDB for the download index (survives eviction, queryable) and Cache
// Storage for the audio itself (streams to disk without buffering the whole
// file in memory first, which matters when the file is 8 MB and the phone has
// 200 MB of headroom).
//
// ---------------------------------------------------------------------------
// WHY Cache Storage AND NOT localStorage
// ---------------------------------------------------------------------------
// localStorage is synchronous, string-only, and capped around 5 MB. A single
// album exceeds it, and a base64 audio blob would have to be fully resident in
// memory before it could be written. Cache Storage takes a Response, streams
// it to disk, and is what the service worker's storage eviction understands.
//
// ---------------------------------------------------------------------------
// WHY THE INDEX IS MIRRORED
// ---------------------------------------------------------------------------
// Rendering the downloads list must not wait on an async open. The index is
// written to localStorage as well as IndexedDB so the list paints on first
// frame, and IndexedDB remains the source of truth. Every read of the index is
// validated (`parseOfflineIndex`) because the localStorage copy is writable by
// the user and survives version changes.
// ---------------------------------------------------------------------------

import {
  OFFLINE_INDEX_KEY,
  isOfflineCacheKey,
  offlineCacheKey,
  parseOfflineIndex,
  type OfflineEntry,
} from "./offlineStore";

const DB_NAME = "synq-offline";
const DB_VERSION = 1;
const INDEX_STORE = "entries";

/** Browsers with no Cache Storage cannot support offline audio at all. */
export function offlineSupported(): boolean {
  return (
    typeof indexedDB !== "undefined" &&
    typeof caches !== "undefined" &&
    typeof navigator !== "undefined"
  );
}

/**
 * Ask the browser to keep this origin's data.
 *
 * Without this, a browser under storage pressure evicts Cache Storage
 * silently and the listener's downloads vanish with no warning and no way to
 * tell what happened. Persistent storage is granted quietly on install and
 * denied for sites the user rarely visits, so this must never be treated as
 * guaranteed — the UI reports the real answer.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    if (navigator.storage?.persisted) {
      if (await navigator.storage.persisted()) return true;
    }
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* storage API unavailable or refused — reported as false, not thrown */
  }
  return false;
}

/** True when the browser has granted this origin persistent storage. */
export async function isPersisted(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * How much room is left, in bytes, or null when the browser won't say.
 *
 * `quota - usage` is the honest number. `usage` counts everything this origin
 * stores, not just audio, so subtracting it is what stops a download from
 * failing at 99% full with a confusing DOMException instead of an explanation.
 */
export async function browserRemainingBytes(): Promise<number | null> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (!estimate || typeof estimate.quota !== "number") return null;
    if (typeof estimate.usage !== "number") return estimate.quota;
    return Math.max(0, estimate.quota - estimate.usage);
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEX_STORE)) {
        db.createObjectStore(INDEX_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** The authoritative index, from IndexedDB. */
export async function readIndex(): Promise<OfflineEntry[]> {
  if (!offlineSupported()) return [];
  try {
    const db = await openDb();
    const rows = await new Promise<OfflineEntry[]>((resolve, reject) => {
      const request = db
        .transaction(INDEX_STORE, "readonly")
        .objectStore(INDEX_STORE)
        .getAll();
      request.onsuccess = () => resolve(request.result as OfflineEntry[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.filter((r) => r && isOfflineCacheKey(r.key));
  } catch {
    // A failed read must not wipe the list the user can still see: fall back
    // to the validated localStorage mirror rather than reporting "no downloads".
    return readMirror();
  }
}

/** The localStorage mirror, validated. Synchronous, so first paint is free. */
export function readMirror(): OfflineEntry[] {
  try {
    return parseOfflineIndex(localStorage.getItem(OFFLINE_INDEX_KEY));
  } catch {
    return [];
  }
}

function writeMirror(entries: OfflineEntry[]): void {
  try {
    localStorage.setItem(OFFLINE_INDEX_KEY, JSON.stringify(entries));
  } catch {
    // A full localStorage must not fail a successful download. The bytes are
    // on disk and IndexedDB still has the index; only the fast path is lost.
  }
}

async function putEntry(entry: OfflineEntry): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(INDEX_STORE, "readwrite");
  tx.objectStore(INDEX_STORE).put(entry);
  await txDone(tx);
  db.close();
}

async function deleteEntry(key: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(INDEX_STORE, "readwrite");
  tx.objectStore(INDEX_STORE).delete(key);
  await txDone(tx);
  db.close();
}

/**
 * Write one track's audio to disk and add it to the index.
 *
 * The bytes are written BEFORE the index row. If the process dies between the
 * two, the listener has an orphaned cache entry and a downloads list that
 * honestly says the track is not downloaded — which is recoverable. The
 * reverse order would produce an index row pointing at nothing, and the UI
 * would offer a "downloaded" track that fails to play offline with no way for
 * the listener to tell why.
 */
export async function saveDownload(
  entry: OfflineEntry,
  response: Response,
): Promise<void> {
  const cache = await caches.open("synq-audio");
  await cache.put(offlineCacheKey(entry.trackId), response.clone());
  await putEntry(entry);
  const all = await readIndex();
  writeMirror(
    all
      .filter((e) => e.key !== entry.key)
      .sort((a, b) => b.savedAt - a.savedAt),
  );
}

/** The stored bytes for a track, or null when it is not downloaded. */
export async function readDownload(trackId: string): Promise<Response | null> {
  if (!offlineSupported()) return null;
  try {
    const cache = await caches.open("synq-audio");
    return (await cache.match(offlineCacheKey(trackId))) ?? null;
  } catch {
    return null;
  }
}

/** True when a track's audio is on this device right now. */
export async function isDownloaded(trackId: string): Promise<boolean> {
  return (await readDownload(trackId)) !== null;
}

/**
 * A playable URL for a stored track, or null.
 *
 * Returns an object URL rather than the cache key so the caller can hand it
 * straight to an <audio> element. The URL is revoked on the next track change
 * by the player; revoking it here would break playback mid-song.
 *
 * A cached audio file is a complete 200 response, so the <audio> element
 * seeks within it using its own buffered ranges. No Range request is ever made
 * against the cache — which is exactly why the service worker can keep
 * refusing Range requests on the network path without affecting offline audio.
 */
export async function offlineAudioUrl(trackId: string): Promise<string | null> {
  const response = await readDownload(trackId);
  if (!response) return null;
  try {
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}

/**
 * Toggle whether a download is protected from automatic eviction.
 *
 * Rewrites the index row in place rather than re-downloading anything: a pin is
 * bookkeeping, and re-fetching the audio just to flip a flag would be absurd.
 */
export async function setPinned(
  trackId: string,
  pinned: boolean,
): Promise<void> {
  const rows = readMirror();
  const row = rows.find((e) => e.trackId === trackId);
  if (!row) return;
  const next: OfflineEntry = { ...row };
  if (pinned) next.pinned = true;
  else delete next.pinned;
  writeMirror(rows.map((e) => (e.trackId === trackId ? next : e)));
  if (offlineSupported()) {
    try {
      // IndexedDB is the source of truth; the mirror above is the fast path.
      await putEntry(next);
    } catch {
      // A failed pin write must not throw into a click handler. The listener
      // sees the toggle not stick rather than an unhandled rejection.
    }
  }
}

/**
 * Remove one download.
 *
 * Both halves are deleted: the cache entry AND the index row. Deleting only
 * the index would leave bytes consuming quota with nothing pointing at them,
 * and deleting only the cache would leave a row that offers a "downloaded"
 * track which cannot play offline.
 */
export async function removeDownload(trackId: string): Promise<void> {
  if (offlineSupported()) {
    try {
      const cache = await caches.open("synq-audio");
      await cache.delete(offlineCacheKey(trackId));
    } catch {
      /* fall through to the index delete */
    }
    try {
      await deleteEntry(offlineCacheKey(trackId));
    } catch {
      /* index already gone */
    }
  }
  writeMirror(readMirror().filter((e) => e.trackId !== trackId));
}

/** Remove every download. */
export async function clearDownloads(): Promise<void> {
  if (offlineSupported()) {
    try {
      await caches.delete("synq-audio");
    } catch {
      /* cache already gone */
    }
    try {
      const db = await openDb();
      const tx = db.transaction(INDEX_STORE, "readwrite");
      tx.objectStore(INDEX_STORE).clear();
      await txDone(tx);
      db.close();
    } catch {
      /* index already gone */
    }
  }
  writeMirror([]);
}

/** Total bytes across the index, as the UI reports them. */
export function totalDownloadedBytes(entries: OfflineEntry[]): number {
  return entries.reduce((sum, e) => sum + (Number(e.bytes) || 0), 0);
}
