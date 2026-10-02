// ---------------------------------------------------------------------------
// The listener-facing Download action for a YouTube track.
//
// The ORDER of these steps is the whole point, and it is not an optimisation:
//
//   1. Ask the SERVER whether YouTube cleared this video for download.
//   2. Refuse — specifically, by name — if it did not.
//   3. Only then resolve the audio and fetch it.
//
// No stream is resolved before step 1 passes, so a track that is not cleared
// for download is never handed to a fetcher at all. A button that downloads
// first and asks permission afterwards is a ripper no matter what the result
// is labelled, and this module exists to not be one.
//
// The licence verdict comes from `youtube:downloadEligibility`, which reads the
// video's own `status.license` from the official Data API. That is a fact about
// the upload — published under Creative Commons Attribution (CC BY), which
// permits reuse and download — rather than a guess SYNQ makes from a URL.
//
// The flow lives in a plain function rather than inside the hook because TWO
// surfaces need it: the button the listener just pressed, and the Retry button
// on the downloads view for a row whose originating surface is long gone. The
// ordering invariant above must hold on both, so both call THIS.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { ConvexHttpClient } from "convex/browser";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { readIndex } from "./offlineAudio";
import {
  downloadTrack,
  noteDownloadStart,
  registerDownloadController,
  releaseDownloadController,
  setDownloadStatus,
} from "./offlineDownloads";

/**
 * The minimum a track must expose to be offered as a download.
 *
 * Deliberately not `YtItem`: the fullscreen player holds a `Playable`, the menu
 * holds a `YtItem`, and neither should have to be converted into the other just
 * to hand four strings to this hook.
 */
export interface DownloadableTrack {
  /** YouTube video id. */
  videoId: string;
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
}

export type TrackDownloadStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "done"
  | "error";

export interface TrackDownloadState {
  status: TrackDownloadStatus;
  /** 0–1 while downloading; null when the total size is not yet known. */
  progress: number | null;
  /** Listener-facing reason, set alongside `error`. */
  message: string;
}

const IDLE: TrackDownloadState = {
  status: "idle",
  progress: null,
  message: "",
};

/**
 * The stream hosts the proxy is allowed to forward — mirrors `convex/http.ts`.
 *
 * Checked here rather than left to the proxy so that a URL it would refuse is
 * passed through untouched instead of being wrapped into a request that can
 * only ever answer 400.
 */
const PROXY_TARGET_RE =
  /^https:\/\/rr[0-9a-z-]*---sn-[a-z0-9-]+\.googlevideo\.com\/videoplayback\?/;

/**
 * Route a resolved stream through the app's CORS proxy.
 *
 * googlevideo sends no CORS headers, so a browser `fetch` of the raw URL is
 * blocked outright — the download would fail for a reason that looks like a
 * dead network. The proxy (the same one playback already uses) adds the
 * headers and forwards `content-length`, which is what the progress readout
 * needs to be a real percentage rather than a spinner.
 */
function proxiedStreamUrl(url: string): string {
  const site = ((import.meta.env.VITE_CONVEX_URL as string) ?? "").replace(
    ".cloud",
    ".site",
  );
  if (!site || !PROXY_TARGET_RE.test(url)) return url;
  return `${site}/audio-proxy?u=${encodeURIComponent(url)}`;
}

/**
 * A one-shot Convex client for the two public YouTube actions.
 *
 * These actions read `process.env.YOUTUBE_API_KEY` on the server and need no
 * session, so they are callable outside React. That is what lets Retry run
 * from a plain event handler on the downloads view without re-deriving the
 * eligibility/resolve order in a second place.
 */
let client: ConvexHttpClient | null = null;
function convex(): ConvexHttpClient {
  client ??= new ConvexHttpClient(import.meta.env.VITE_CONVEX_URL as string);
  return client;
}

/** A phase worth showing on the surface that started the download. */
export type DownloadPhase = "checking" | "downloading";

/** The outcome of one download attempt. `ok: false` always carries a reason. */
export interface DownloadAttemptOutcome {
  ok: boolean;
  /** Listener-facing reason, set when `ok` is false. */
  reason: string;
  /**
   * True when the LISTENER stopped it. A cancel is a choice, not a failure,
   * and must never be reported with a Retry button.
   */
  cancelled: boolean;
}

/**
 * Run the full, ordered download flow for one YouTube track.
 *
 * Records the attempt in the shared store first (so a downloads view can show
 * the row and offer Retry even if this component unmounts), registers the
 * controller so Cancel works from anywhere, then proceeds licence → stream →
 * fetch. The controller is always released, and a failed attempt is always
 * left in the store as `error`, so the downloads view never shows a row frozen
 * mid-phase.
 */
export async function performYouTubeDownload(input: {
  track: DownloadableTrack;
  /** Aborts the transfer. Cancellation is a listener choice, not a failure. */
  controller: AbortController;
  onPhase?: (phase: DownloadPhase) => void;
  onProgress?: (progress: number | null) => void;
}): Promise<DownloadAttemptOutcome> {
  const { track, controller, onPhase, onProgress } = input;
  const { videoId, title, artistName, coverUrl, duration } = track;

  noteDownloadStart(videoId, {
    title,
    artistName,
    coverUrl,
    duration,
    source: "youtube",
    youtubeId: videoId,
    startedAt: Date.now(),
  });
  registerDownloadController(videoId, controller);
  onPhase?.("checking");

  // A refusal is recorded in the store as well as returned, so the downloads
  // view lists the failure rather than a row stuck in `checking`.
  const fail = (reason: string): DownloadAttemptOutcome => {
    setDownloadStatus(videoId, "error", reason);
    return { ok: false, cancelled: false, reason };
  };

  try {
    // --- 1. Rights, decided by the server. --------------------------------
    let verdict: { eligible: boolean; licenseUrl: string; reason?: string };
    try {
      verdict = await convex().action(api.youtube.downloadEligibility, {
        videoId,
      });
    } catch {
      return fail("Couldn't check whether this track can be downloaded.");
    }

    if (!verdict.eligible) {
      return fail(verdict.reason ?? "This track isn't available for download.");
    }

    // --- 2. Resolve the audio, now that storing it is allowed. ------------
    let url: string | null = null;
    try {
      const resolved = await convex().action(api.youtube.resolveStream, {
        videoId,
        quality: "high",
      });
      url = resolved.url;
    } catch {
      url = null;
    }
    if (!url) {
      return fail(
        "The audio for this track couldn't be fetched. Try again in a moment.",
      );
    }

    // --- 3. Fetch and store. ----------------------------------------------
    onPhase?.("downloading");
    const result = await downloadTrack({
      trackId: videoId,
      title,
      artistName,
      coverUrl,
      duration,
      audioUrl: proxiedStreamUrl(url),
      // The server verified the licence. This flag is the client echoing that
      // verdict, never the source of it.
      downloadAllowed: true,
      licenseUrl: verdict.licenseUrl,
      source: "youtube",
      youtubeId: videoId,
      entries: await readIndex(),
      signal: controller.signal,
      onProgress: (received, total) => {
        onProgress?.(total > 0 ? Math.min(1, received / total) : null);
      },
    });

    if (result.ok) return { ok: true, cancelled: false, reason: "" };
    if (controller.signal.aborted) {
      return { ok: false, cancelled: true, reason: "Download cancelled." };
    }
    // `downloadTrack` already recorded some failures; this normalises the rest
    // (a quota refusal that emitted `idle`) so the downloads view is honest.
    setDownloadStatus(videoId, "error", result.reason);
    return { ok: false, cancelled: false, reason: result.reason };
  } finally {
    releaseDownloadController(videoId);
  }
}

/**
 * Download one track, including the licence check it depends on.
 *
 * This hook owns only the per-interaction bits — the spinner on the button
 * that was pressed and its toasts. The shared store is updated by
 * {@link performYouTubeDownload}, so a downloads view stays in step without
 * this component having to exist.
 */
export function useTrackDownload(track: DownloadableTrack) {
  const [state, setState] = useState<TrackDownloadState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  /**
   * The Retry button in the failure toast has to call `start`, but `start`
   * cannot close over itself without Reassigning Its Own Type. The latest
   * instance is parked in a ref from an effect instead — after commit, so no
   * mutation happens during render.
   */
  const retryRef = useRef<() => void>(() => {});

  const start = useCallback(async () => {
    const toastId = `download-${track.videoId}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "checking", progress: null, message: "" });

    // Only repaint the toast when the whole percentage moves; a chunk-level
    // update would re-render a hundred times for a 1 GB file.
    let lastPercent = -1;

    const outcome = await performYouTubeDownload({
      track,
      controller,
      onPhase: (phase) => {
        if (phase !== "downloading") return;
        setState({ status: "downloading", progress: null, message: "" });
        toast.loading("Downloading…", { id: toastId, duration: Infinity });
      },
      onProgress: (progress) => {
        setState((prev) =>
          prev.status === "downloading" ? { ...prev, progress } : prev,
        );
        const percent = progress === null ? -1 : Math.round(progress * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          toast.loading(
            percent < 0 ? "Downloading…" : `Downloading… ${percent}%`,
            { id: toastId, duration: Infinity },
          );
        }
      },
    });

    abortRef.current = null;

    if (outcome.ok) {
      setState({ status: "done", progress: 1, message: "" });
      toast.success("Download complete", {
        id: toastId,
        description: `Saved “${track.title}” for offline listening.`,
      });
      return;
    }

    // A cancel is a choice, not a failure — it does not get a Retry button.
    if (outcome.cancelled) {
      setState(IDLE);
      toast("Download cancelled", { id: toastId });
      return;
    }

    setState({ status: "error", progress: null, message: outcome.reason });
    toast.error("Download failed", {
      id: toastId,
      description: outcome.reason,
      action: {
        label: "Retry",
        onClick: () => retryRef.current(),
      },
    });
  }, [track]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  useEffect(() => {
    retryRef.current = () => {
      void start();
    };
  }, [start]);

  return { state, start, cancel };
}
