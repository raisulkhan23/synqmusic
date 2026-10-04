import { OpfsSink, opfsSupported } from "@/lib/opfsSink";
import type {
  DownloadAdapter,
  Segment,
} from "@/lib/downloadManager";
import type { YtItem } from "@/lib/youtube";
import { resolveViaPiped } from "@/lib/pipedResolve";

/**
 * The download SOURCE: resolves a track to a playable stream URL through the
 * app's existing `youtube:resolveStream` action, then serves that URL to the
 * range/segment engine.
 *
 * It deliberately reuses `resolveStream` rather than reaching for the
 * InnerTube `player` response itself. That resolver is the one the PLAYER
 * already uses, so a download can never diverge from what is playing — same
 * client rotation, same format preference, same failure reasons.
 *
 * The resolver runs on the server, so the signed stream URL is obtained there
 * and used here only to make ordinary authenticated-by-URL GETs. It is never
 * cached long: `resolveStream` is asked per transfer, not memoised, because a
 * `streamingData` URL is a bearer credential for that media.
 */

export class StreamUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "StreamUnavailableError";
    this.reason = reason;
  }
}

/** How long the backend resolver gets before it is written off. */
const BACKEND_RESOLVE_TIMEOUT_MS = 12_000;

/**
 * Run the backend resolver under a timeout, treating any failure as "no URL".
 *
 * WHY THIS EXISTS. `resolveStream` is a Convex action, so it can reject on a
 * transport error and it can hang while it rotates five InnerTube clients
 * against a bot-checked YouTube. Both outcomes used to be fatal here: the
 * `await` was unguarded, so a rejection propagated straight out of
 * `resolveStreamUrl` and the Piped fallback below it never ran at all. A
 * backend that is merely SLOW therefore looked identical to a backend that is
 * broken, and neither reached the fallback that actually works from the
 * listener's own IP.
 *
 * Returning `null` rather than throwing is deliberate: the caller's job is to
 * try somewhere else, and it already has somewhere else to try.
 */
async function resolveViaBackend(
  resolveStream: (args: {
    videoId: string;
    quality?: "high" | "low";
  }) => Promise<{ url: string | null; title: string; reason?: string }>,
  videoId: string,
  quality: "high" | "low",
): Promise<{ url: string | null; title: string; reason?: string } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), BACKEND_RESOLVE_TIMEOUT_MS);
    });
    return await Promise.race([resolveStream({ videoId, quality }), timeout]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The app's CORS proxy for stream hosts.
 *
 * WHY A DOWNLOAD NEEDS THIS AND A NAIVE `fetch` DOES NOT WORK. `resolveStream`
 * hands back a signed `googlevideo.com` URL, and that host sends NO CORS
 * headers. The `<audio>` element gets away with it because the player routes
 * playback through `/audio-proxy` (see `store/player.ts`, `audioProxyBase`).
 * A `fetch()` from the page is a different matter: the browser blocks the
 * response before the adapter's probe can even read `Content-Range`, so every
 * download would fail at the probe with an opaque CORS error and no useful
 * message. Going through the same proxy the player uses is what makes ranged
 * GETs possible at all.
 */
const audioProxyBase = `${(
  (import.meta.env.VITE_CONVEX_URL as string) ?? ""
).replace(".cloud", ".site")}/audio-proxy`;

/** Wrap a raw stream URL in the CORS proxy, as the player does. */
export function viaAudioProxy(rawUrl: string): string {
  return `${audioProxyBase}?u=${encodeURIComponent(rawUrl)}`;
}

/** Resolve a track's stream URL. Returns null when the provider refuses. */
export async function resolveStreamUrl(
  resolveStream: (args: {
    videoId: string;
    quality?: "high" | "low";
  }) => Promise<{ url: string | null; title: string; reason?: string }>,
  track: YtItem,
  quality: "high" | "low" = "high",
): Promise<{ url: string; title: string }> {
  const result = await resolveViaBackend(resolveStream, track.id, quality);
  if (result?.url) {
    return { url: viaAudioProxy(result.url), title: result.title };
  }

  // The backend is usually met with YouTube's datacenter bot-check
  // ("Sign in to confirm you're not a bot"), because it resolves from Convex's
  // IP rather than the listener's. The PLAYER already survives that by falling
  // back to public Piped instances, which resolve from the user's own IP; the
  // download path did not, which is why a track could play and still refuse to
  // download. Both now resolve identically, via the same shared module.
  //
  // Only the backend's own reason is discarded once Piped succeeds, because the
  // download works and repeating "not a bot" would be untrue.
  const piped = await resolveViaPiped(track.id);
  if (piped.url) return { url: piped.url, title: track.title };

  // Both routes failed. Report what actually broke, NOT the backend's reason.
  //
  // WHY NOT THE BACKEND'S REASON. It used to be `result.reason`, which is
  // almost always YouTube's bot-check aimed at Convex's datacenter IP. That
  // message describes a problem the user cannot act on and that is usually not
  // the reason the download failed — the reason is that no Piped instance
  // answered either. Showing the bot-check for a dead third-party host is how
  // this looked like a YouTube problem for an entire session.
  throw new StreamUnavailableError(describeFailure(result, piped.failures));
}

/**
 * Build the one honest sentence for a total resolution failure.
 *
 * Prefers the fallback's own diagnostics, because those describe the LAST
 * thing that failed and are the ones the user could do something about. The
 * backend reason is only used when there is nothing better to say.
 */
function describeFailure(
  backend: { reason?: string } | null,
  failures: { instance: string; detail: string }[],
): string {
  if (failures.length === 0) {
    return backend?.reason ?? "This track can't be streamed right now";
  }

  // EVERY server-side resolver being bot-blocked is the expected state of the
  // world right now, not a transient fault, and the fix is a setting the user
  // can actually change. So when the failures are all bot-checks, name the
  // cause and the fix instead of listing hostnames — a list of six dead mirrors
  // tells the reader nothing they can act on.
  // The signatures that mean "YouTube refused this network", which is what a
  // server-hosted resolver runs into.
  const blockedDetail =
    /SignInConfirmNotBot|not a bot|LOGIN_REQUIRED|bot.?check|HTTP 50[0234]/i;

  // AT LEAST ONE confirmed block is enough — not all of them.
  //
  // This was `every(...)` at first, and it was wrong in the way that matters
  // most: it never fired for the actual reported failure. In that failure one
  // mirror answered HTTP 500 (blocked) while the rest failed to connect, so
  // `every` was false and the user got the old hostname list with no way
  // forward. A single PROVEN block already establishes the thing the reader
  // needs to know — that server-hosted resolvers are being refused — and the
  // remaining transport failures do not weaken that, they just mean those
  // particular mirrors were additionally unreachable.
  const anyBlocked = failures.some((f) => blockedDetail.test(f.detail));
  if (anyBlocked) {
    return "Google is blocking every public resolver. Add your own in Settings → Offline downloads, or use Record in Downloads to capture playback directly.";
  }

  // Otherwise one line per instance, capped: this string is shown in a toast,
  // and a wall of hostnames helps nobody. The count of failures is itself the
  // signal.
  const shown = failures
    .slice(0, 3)
    .map((f) => `${f.instance} (${f.detail})`)
    .join(", ");
  const more = failures.length > 3 ? `, +${failures.length - 3} more` : "";
  return `No source could be reached. Tried ${failures.length} mirror${
    failures.length === 1 ? "" : "s"
  }: ${shown}${more}`;
}

/**
 * Build the adapter the manager uses. It is created per download because it
 * carries that download's resolved URL and its own sink.
 */
export function createTrackAdapter(
  url: string,
  filename: string,
  id: string,
): DownloadAdapter {
  if (!opfsSupported()) {
    throw new Error(
      "This browser has no filesystem for downloads (Origin Private File System)",
    );
  }
  let sink: OpfsSink | null = null;
  const getSink = async (): Promise<OpfsSink> => {
    sink ??= await OpfsSink.open(filename, id);
    return sink;
  };

  const timedFetch = async (
    input: string,
    init: RequestInit & { timeoutMs: number },
  ): Promise<Response> => {
    const { timeoutMs, ...rest } = init;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    init.signal?.addEventListener("abort", onAbort);
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...rest, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
    }
  };

  return {
    async probe(timeoutMs) {
      // A ranged GET is the only reliable probe: many origins do not answer
      // HEAD with an accurate length or an Accept-Ranges header. Asking for
      // the first byte tells us both, and the body is discarded.
      const res = await timedFetch(url, {
        headers: { Range: "bytes=0-0" },
        timeoutMs,
      });
      // A 200 here means the origin ignored the range and is streaming the
      // whole entity — record that rather than assuming ranges work.
      if (res.status === 200) {
        return {
          status: 200,
          contentLength: numberHeader(res, "content-length"),
          acceptRanges: false,
        };
      }
      const contentRange = res.headers.get("content-range");
      const total = contentRange?.split("/")[1];
      return {
        status: 206,
        contentLength: total && total !== "*" ? Number(total) : null,
        acceptRanges: true,
      };
    },

    async openRange(segment: Segment, timeoutMs, signal) {
      const res = await timedFetch(url, {
        headers: { Range: `bytes=${segment.start}-${segment.end - 1}` },
        timeoutMs,
        signal,
      });
      return {
        status: res.status,
        headers: res.headers,
        body: res.body,
      };
    },

    async openStream(timeoutMs, signal) {
      const res = await timedFetch(url, { timeoutMs, signal });
      return { status: res.status, headers: res.headers, body: res.body };
    },

    // `FileSink` is a structural interface, so forwarding every method is
    // enough — no getter, no cast. Opening happens on the first call, which
    // is also what makes a resume pick up an existing `.part` file.
    sink: {
      bytesWritten: () => getSink().then((s) => s.bytesWritten()),
      append: (chunk: Uint8Array) => getSink().then((s) => s.append(chunk)),
      truncate: (to: number) => getSink().then((s) => s.truncate(to)),
      commit: () => getSink().then((s) => s.commit()),
      discardIncomplete: () => getSink().then((s) => s.discardIncomplete()),
    },
  };
}

function numberHeader(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
