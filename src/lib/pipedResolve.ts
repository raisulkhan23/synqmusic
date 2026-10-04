/**
 * Browser-side stream resolution through public Piped instances.
 *
 * WHY THIS EXISTS ALONGSIDE THE CONVEX RESOLVER. `youtube:resolveStream` runs
 * on the Convex backend, so YouTube sees a datacenter IP and frequently answers
 * `"Sign in to confirm you're not a bot"` — that is the bot-check, and it is
 * why the Convex path alone could not download anything. Piped resolves from
 * the LISTENER'S OWN IP and sends CORS headers itself, so it is neither
 * bot-blocked nor a cross-origin problem for the page.
 *
 * WHY IT IS A SEPARATE MODULE. This logic used to live inline inside
 * `resolveYoutubeStream` in the player store, so the download path could not
 * reach it and had no way to resolve a stream when the backend was
 * bot-blocked. Playback worked and downloading did not, for the same track, at
 * the same moment. One implementation, used by both, is what stops that drift
 * coming back.
 *
 * WHY IT REPORTS A REASON INSTEAD OF `null`. This used to return a bare
 * `string | null`, and every failure looked identical to the caller. That is
 * how a dead third-party instance ended up surfacing to the user as YouTube's
 * bot-check: the caller had nothing to say except the backend's reason, so the
 * one message shown was the one that was least likely to be the true cause. A
 * `null` here now always carries why, so a download failure can name the thing
 * that actually broke.
 *
 * WHAT COMES BACK. An audio-only stream where Piped offers one, otherwise the
 * lowest-resolution MUXED stream — Piped now strips audio-only formats for many
 * videos, and only the audio track is wanted here. It is NOT wrapped in
 * `/audio-proxy`: Piped already serves the CORS headers the fetch needs, so
 * routing it through the proxy would add a hop and a failure mode for nothing.
 */

/**
 * Public Piped instances, tried in order.
 *
 * These are volunteer-run and go down without warning, so the list is a
 * rotation rather than a set of guarantees, and every entry is allowed to
 * fail. The first two are the instances verified reachable; the rest are kept
 * because a rotation is the only defence against the first two disappearing,
 * and an unreachable instance costs one fast timeout rather than a failure.
 */
const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.ducks.party",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.reallyaweso.me",
  "https://pipedapi.leptons.xyz",
] as const;

/** Per-instance resolve budget. Short, because a dead host must not stall us. */
const RESOLVE_TIMEOUT_MS = 6_000;

export interface PipedResolutionFailure {
  /** The instance that was tried, host only — enough to identify it. */
  instance: string;
  /** What it actually did: a status, a network error, or an empty result. */
  detail: string;
}

export interface PipedResolution {
  url: string | null;
  /** Every instance's outcome, in the order tried. Empty when `url` is set. */
  failures: PipedResolutionFailure[];
}

const hostOf = (base: string): string => base.replace(/^https?:\/\//, "");

/**
 * Resolve `videoId` to a stream URL through public Piped instances.
 *
 * Returns `{ url: null, failures }` rather than throwing: every failure here is
 * an expected, recoverable condition (an instance is down, rate-limited, or has
 * no stream for this video), and the caller has a better fallback to try than
 * an exception is.
 */
export async function resolveViaPiped(
  videoId: string,
): Promise<PipedResolution> {
  if (!videoId || typeof fetch !== "function") {
    return { url: null, failures: [] };
  }

  const failures: PipedResolutionFailure[] = [];

  for (const base of PIPED_INSTANCES) {
    const host = hostOf(base);
    let res: Response;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS);
      try {
        res = await fetch(`${base}/streams/${videoId}`, { signal: ctrl.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // A network error, a DNS failure, an aborted timeout, or a CORS block —
      // all indistinguishable from here, and all "this instance is no use".
      failures.push({
        instance: host,
        detail: err instanceof Error ? err.message : "network error",
      });
      continue;
    }

    if (!res.ok) {
      failures.push({ instance: host, detail: `HTTP ${res.status}` });
      continue;
    }

    let data: {
      audioStreams?: { url: string; bitrate?: number; mimeType?: string }[];
      videoStreams?: {
        url: string;
        quality?: string;
        videoOnly?: boolean;
        mimeType?: string;
      }[];
    };
    try {
      data = (await res.json()) as typeof data;
    } catch {
      failures.push({ instance: host, detail: "malformed JSON" });
      continue;
    }

    // Preferred: a dedicated audio-only stream, best bitrate first.
    const audio = (data.audioStreams ?? [])
      .filter((s) => !!s.url && (!s.mimeType || s.mimeType.includes("audio")))
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    if (audio[0]?.url) return { url: audio[0].url, failures: [] };

    // Otherwise the lowest-resolution muxed stream: the video track is
    // discarded by the media engine, and only the audio is ever used.
    const muxed = (data.videoStreams ?? [])
      .filter(
        (s) =>
          !!s.url &&
          s.videoOnly === false &&
          (!s.mimeType ||
            s.mimeType.includes("mp4") ||
            s.mimeType.includes("webm")),
      )
      .sort(
        (a, b) =>
          (parseInt(a.quality ?? "0", 10) || 9999) -
          (parseInt(b.quality ?? "0", 10) || 9999),
      );
    if (muxed[0]?.url) return { url: muxed[0].url, failures: [] };

    // The instance answered, and had nothing for us. Piped returns HTTP 200
    // with empty stream lists for videos it cannot extract, so this is a
    // real per-video outcome rather than a broken host.
    failures.push({ instance: host, detail: "no audio or muxed stream" });
  }

  return { url: null, failures };
}
