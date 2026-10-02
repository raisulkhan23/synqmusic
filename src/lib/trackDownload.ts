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
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { readIndex } from "./offlineAudio";
import { downloadTrack } from "./offlineDownloads";

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
 * Download one track, including the licence check it depends on.
 *
 * Status lives in component state rather than in the shared download store on
 * purpose. That store answers "is this track on the device?" for row badges,
 * which is a different question from "what is happening on the surface I just
 * clicked" — and only the latter needs to be per-interaction.
 */
export function useTrackDownload(track: DownloadableTrack) {
  const checkEligibility = useAction(api.youtube.downloadEligibility);
  const resolveStream = useAction(api.youtube.resolveStream);
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
    const { videoId, title, artistName, coverUrl, duration } = track;
    const toastId = `download-${videoId}`;

    // --- 1. Rights, decided by the server. --------------------------------
    setState({ status: "checking", progress: null, message: "" });
    let verdict: { eligible: boolean; licenseUrl: string; reason?: string };
    try {
      verdict = await checkEligibility({ videoId });
    } catch {
      const message = "Couldn't check whether this track can be downloaded.";
      setState({ status: "error", progress: null, message });
      toast.error("Download unavailable", {
        id: toastId,
        description: message,
      });
      return;
    }

    if (!verdict.eligible) {
      const message =
        verdict.reason ?? "This track isn't available for download.";
      setState({ status: "error", progress: null, message });
      // Named, never swallowed. A download that does nothing at all reads as a
      // broken button rather than as a deliberate refusal.
      toast.error("Download unavailable", {
        id: toastId,
        description: message,
      });
      return;
    }

    // --- 2. Resolve the audio, now that storing it is allowed. ------------
    let url: string | null = null;
    try {
      const resolved = await resolveStream({ videoId, quality: "high" });
      url = resolved.url;
    } catch {
      url = null;
    }
    if (!url) {
      const message =
        "The audio for this track couldn't be fetched. Try again in a moment.";
      setState({ status: "error", progress: null, message });
      toast.error("Download failed", { id: toastId, description: message });
      return;
    }

    // --- 3. Fetch and store. ---------------------------------------------
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: "downloading", progress: null, message: "" });
    toast.loading("Downloading…", { id: toastId, duration: Infinity });

    // Only repaint the toast when the whole percentage moves; a chunk-level
    // update would re-render a hundred times for a 1 GB file.
    let lastPercent = -1;

    try {
      const result = await downloadTrack({
        trackId: videoId,
        title,
        artistName,
        coverUrl,
        duration,
        audioUrl: proxiedStreamUrl(url),
        // The server verified the licence. This flag is the client echoing
        // that verdict, never the source of it.
        downloadAllowed: true,
        licenseUrl: verdict.licenseUrl,
        source: "youtube",
        entries: await readIndex(),
        signal: controller.signal,
        onProgress: (received, total) => {
          const progress =
            total > 0 ? Math.min(1, received / total) : null;
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

      if (result.ok) {
        setState({ status: "done", progress: 1, message: "" });
        toast.success("Download complete", {
          id: toastId,
          description: `Saved “${title}” for offline listening.`,
        });
        return;
      }

      // A cancel is a choice, not a failure — it does not get a Retry button.
      if (controller.signal.aborted) {
        setState(IDLE);
        toast("Download cancelled", { id: toastId });
        return;
      }

      setState({ status: "error", progress: null, message: result.reason });
      toast.error("Download failed", {
        id: toastId,
        description: result.reason,
        action: {
          label: "Retry",
          onClick: () => retryRef.current(),
        },
      });
    } finally {
      abortRef.current = null;
    }
  }, [track, checkEligibility, resolveStream]);

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
