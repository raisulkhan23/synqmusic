/**
 * Saving a track by CAPTURING THE TAB'S AUDIO, with no resolver at all.
 *
 * WHY THIS EXISTS, WHEN EVERY OTHER ROUTE HAS BEEN PROVEN DEAD. Playback works
 * in this app. It plays through the YouTube IFrame API, which runs a real
 * signed-in browser session on the listener's own IP — that is precisely why
 * YouTube serves it, and why every attempt to *resolve* a stream URL has
 * failed: a resolver is an anonymous server-side caller, which YouTube
 * refuses with "Sign in to confirm you're not a bot". Measured, not assumed:
 * all 15 instances in the authoritative Piped registry are dead or
 * IP-blocked, the app's own Convex backend is refused, Invidious is dead,
 * Cobalt's API has been shut down since November 2024, and the public
 * converter sites are behind Cloudflare bot walls that a server cannot pass.
 *
 * So stop trying to be an anonymous caller. Be the listener. `getDisplayMedia`
 * asks the browser to capture this tab's own output, `MediaRecorder` encodes
 * it, and the audio that is already playing is written straight to disk. There
 * is no stream URL to obtain, no origin to be refused, and no third party
 * involved. The IFrame player's audio being cross-origin — the fact that makes
 * it unreadable and unsavable by any other means — is irrelevant here, because
 * this reads what the tab *renders*, not what a player element exposes.
 *
 * WHAT THIS COSTS, STATED PLAINLY. It is a real-time recording, not a
 * transfer: it captures as fast as the track plays, so a four-minute song
 * takes four minutes. The output is re-encoded (Opus in WebM), so it is not
 * bit-identical to YouTube's own audio. It needs one permission grant per
 * session, and Chrome only includes tab audio if the user ticks "Share tab
 * audio" in the picker — which is why a missing audio track is reported as its
 * own actionable error instead of a silent zero-byte file. It records whatever
 * the tab is playing, so the user should let the track play to the end.
 *
 * This is the honest fallback, not the good path: a resolver, when one is
 * configured, is faster and higher fidelity. This exists so that "download"
 * means something rather than nothing.
 */

/** MIME types tried in order, best first. Opus in WebM is universally supported. */
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
] as const;

export type CaptureErrorReason =
  /** The browser has no tab-capture or recording API. */
  | "unsupported"
  /** The user dismissed the picker, or the permission was refused. */
  | "denied"
  /** A stream came back with no audio — almost always an unticked "Share tab audio". */
  | "no-audio"
  /** The recorder itself failed. */
  | "failed"
  /** The recorder ran but produced nothing. */
  | "empty";

export class CaptureError extends Error {
  readonly reason: CaptureErrorReason;
  constructor(reason: CaptureErrorReason, message: string) {
    super(message);
    this.name = "CaptureError";
    this.reason = reason;
  }
}

/**
 * Can this browser record its own tab audio at all?
 *
 * Split out from the attempt so the UI can hide the button rather than offer
 * something that is guaranteed to fail. `getDisplayMedia` also requires a
 * secure context, which is why this is gated on `isSecureContext` rather than
 * on the function merely existing.
 */
export function captureSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return false;
  }
  if (window.isSecureContext === false) return false;
  return (
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
    typeof MediaRecorder !== "undefined"
  );
}

/** The best container this browser will actually record, or null to let it choose. */
export function pickCaptureMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of CANDIDATE_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      /* a browser that throws here is telling us it cannot vouch for the type */
    }
  }
  return null;
}

export interface CaptureHandle {
  /** Stop and resolve with everything captured. Safe to call more than once. */
  stop(): Promise<Uint8Array>;
  /** Bytes captured so far, for live progress. */
  readonly bytes: number;
  /** End the capture without saving. Called on unmount and on cancel. */
  dispose(): void;
}

/**
 * Ask the user to share this tab, and start recording its audio.
 *
 * `video: true` is deliberate and non-negotiable: browsers require a video
 * track to be requested for tab capture to be offered at all. The video track
 * is dropped the instant the stream arrives and never encoded, so nothing
 * visual is recorded or stored.
 */
export async function startAudioCapture(): Promise<CaptureHandle> {
  if (!captureSupported()) {
    throw new CaptureError(
      "unsupported",
      "This browser can't record its own audio. Chrome, Edge and Firefox can.",
    );
  }

  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
      // Suggests this tab in the picker. A hint only — the user still chooses.
      preferCurrentTab: true,
    } as DisplayMediaStreamOptions);
  } catch (err) {
    // A dismissed picker and a refused permission are the same thing to the
    // user: nothing was shared, so there is nothing to record.
    throw new CaptureError(
      "denied",
      err instanceof Error && err.name === "NotAllowedError"
        ? "Recording needs permission to share this tab."
        : "Couldn't start a recording of this tab.",
    );
  }

  const stopTracks = () => {
    for (const track of display.getTracks()) track.stop();
  };

  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    stopTracks();
    throw new CaptureError(
      "no-audio",
      "That share had no audio. Pick this tab again and tick “Share tab audio” in the dialog — without it the recording would be empty.",
    );
  }

  const mimeType = pickCaptureMimeType();
  let recorder: MediaRecorder;
  try {
    recorder = mimeType
      ? new MediaRecorder(new MediaStream(audioTracks), { mimeType })
      : new MediaRecorder(new MediaStream(audioTracks));
  } catch (err) {
    stopTracks();
    throw new CaptureError(
      "failed",
      `This browser refused to start the recorder (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }

  const chunks: Blob[] = [];
  let total = 0;
  let failure: string | null = null;

  recorder.addEventListener("dataavailable", (event) => {
    const blob = event.data;
    if (blob && blob.size > 0) {
      chunks.push(blob);
      total += blob.size;
    }
  });
  recorder.addEventListener("error", () => {
    failure = "The recorder stopped unexpectedly.";
  });

  try {
    recorder.start(1_000);
  } catch (err) {
    stopTracks();
    throw new CaptureError(
      "failed",
      `Couldn't begin recording (${err instanceof Error ? err.message : "unknown error"}).`,
    );
  }

  let stopped: Promise<Uint8Array> | null = null;
  const finish = (): Promise<Uint8Array> => {
    stopped ??= new Promise<Uint8Array>((resolve, reject) => {
      const done = () => {
        stopTracks();
        if (failure) {
          reject(new CaptureError("failed", failure));
          return;
        }
        if (total === 0) {
          reject(
            new CaptureError(
              "empty",
              "Nothing was captured. Make sure the track is actually playing and audible.",
            ),
          );
          return;
        }
        resolve(new Blob(chunks, mimeType ? { type: mimeType } : undefined).arrayBuffer().then((b) => new Uint8Array(b)));
      };
      if (recorder.state === "inactive") {
        done();
      } else {
        recorder.addEventListener("stop", done, { once: true });
        recorder.stop();
      }
    });
    return stopped;
  };

  return {
    stop: finish,
    get bytes() {
      return total;
    },
    dispose() {
      stopTracks();
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* already stopping */
        }
      }
    },
  };
}

/**
 * A filename that plays everywhere.
 *
 * The capture is WebM/Opus unless the browser chose otherwise, so the extension
 * must match what was actually recorded — a `.mp3` holding Opus data is a file
 * that refuses to open in half the players on earth.
 */
export function captureFilename(
  title: string,
  artist: string,
  mimeType: string | null,
): string {
  const clean = (value: string) =>
    value
      .replace(/[\\/:*?"<>|]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  const stem = [clean(artist), clean(title)].filter(Boolean).join(" - ");
  const ext = mimeType?.includes("mp4")
    ? "m4a"
    : mimeType?.includes("ogg")
      ? "ogg"
      : "webm";
  return `${stem || "recording"}.${ext}`;
}