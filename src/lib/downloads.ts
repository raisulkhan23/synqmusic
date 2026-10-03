import {
  DownloadManager,
  type DownloadAdapter,
  type DownloadConfig,
} from "@/lib/downloadManager";
import type { Playable } from "@/lib/playable";

/**
 * The single, app-level download manager, and the bridge between "something
 * wants to download this track" and the queue that performs transfers.
 *
 * WHY THIS IS A SINGLETON, NOT A COMPONENT'S STATE. The manager owns the
 * in-flight transfers, the concurrency budget and the duplicate guard, so two
 * instances would be two competing queues. An earlier version had the Download
 * Hub own it and register it on mount — which was wrong: a track's context
 * menu is used on search, liked songs, recently played and the queue, where
 * the hub is NOT mounted. Every menu press therefore found no manager, so the
 * Download action could never start a transfer even once a source adapter was
 * wired in. The manager has to outlive any single page.
 *
 * It is created lazily on first use, so nothing is constructed on pages that
 * never download anything.
 */

export const DOWNLOAD_CONFIG: Partial<DownloadConfig> = {
  chunkSize: 1_048_576,
  maxConcurrentRanges: 2,
  timeoutMs: 30_000,
  maxFileSize: 512 * 1_048_576,
};

type AdapterFactory = (download: unknown) => DownloadAdapter;

let manager: DownloadManager | null = null;
let adapterFactory: AdapterFactory | null = null;

/**
 * Supply the adapter that actually fetches bytes.
 *
 * Called once at app start. Until this is called with a working source,
 * `requestTrackDownload` reports that nothing is downloadable — which is the
 * honest answer today, because every provider SYNQ streams from licenses
 * streaming rather than download.
 */
export function registerDownloadAdapter(factory: AdapterFactory | null): void {
  adapterFactory = factory;
  // A manager built before an adapter existed must be rebuilt, or it would
  // keep the refusing adapter forever.
  manager = null;
}

/** The one manager, created on first use. */
export function getDownloadManager(): DownloadManager {
  if (!manager) {
    manager = new DownloadManager(DOWNLOAD_CONFIG, (d) => {
      if (!adapterFactory) {
        // Refusing is deliberate. An adapter that quietly succeeded would
        // produce an empty file reported as a finished download.
        throw new Error("No download source is configured");
      }
      return adapterFactory(d);
    });
  }
  return manager;
}

/** True when a source that can actually fetch media has been configured. */
export function downloadsAvailable(): boolean {
  return adapterFactory !== null;
}

export interface DownloadRequestResult {
  started: boolean;
  /** Why not, when `started` is false. Safe to show to a user. */
  reason?: "no-source" | "not-downloadable";
}

/**
 * Ask for `track` to be downloaded.
 *
 * Returns whether a transfer actually started. Never throws and never fakes
 * success: `started: false` means the caller must tell the user the truth
 * rather than reporting a download that did not begin.
 */
export function requestTrackDownload(
  track: Pick<Playable, "id" | "title" | "artistName">,
  opts: { force?: boolean } = {},
): DownloadRequestResult {
  if (!downloadsAvailable()) return { started: false, reason: "no-source" };
  try {
    // The manager returns the existing record when the track is already
    // queued, so a duplicate press is idempotent.
    const filename = `${track.artistName} - ${track.title}`
      .replace(/[\\/:*?"<>|]/g, "-")
      .slice(0, 120);
    getDownloadManager().enqueue({
      trackId: track.id,
      filename,
      force: opts.force,
    });
    return { started: true };
  } catch {
    return { started: false, reason: "not-downloadable" };
  }
}