import type { AdapterFactory } from "@/lib/downloads";
import { OpfsSink, opfsSupported } from "@/lib/opfsSink";
import type {
  DownloadAdapter,
  Segment,
} from "@/lib/downloadManager";
import type { YtItem } from "@/lib/youtube";

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

/** Resolve a track's stream URL. Returns null when the provider refuses. */
export async function resolveStreamUrl(
  resolveStream: (args: {
    videoId: string;
    quality?: "high" | "low";
  }) => Promise<{ url: string | null; title: string; reason?: string }>,
  track: YtItem,
  quality: "high" | "low" = "high",
): Promise<{ url: string; title: string }> {
  const result = await resolveStream({
    videoId: track.id,
    quality,
  });
  if (!result.url) {
    throw new StreamUnavailableError(
      result.reason ?? "This track can't be streamed right now",
    );
  }
  return { url: result.url, title: result.title };
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

/**
 * The adapter factory registered with the shared manager.
 *
 * This is the seam that decides whether a download can happen at all. The
 * manager may be constructed on any page; the factory is only bound while a
 * track with a resolvable stream is being downloaded.
 */
export function bindResolver(
  resolveStream: (args: {
    videoId: string;
    quality?: "high" | "low";
  }) => Promise<{ url: string | null; title: string; reason?: string }>,
  track: YtItem,
  quality: "high" | "low" = "high",
): AdapterFactory {
  return async (download: {
    id: string;
    filename: string;
    trackId: string;
  }) => {
    const { url, title } = await resolveStreamUrl(resolveStream, track, quality);
    const filename = download.filename || `${track.artist} - ${title}`;
    return createTrackAdapter(url, filename, download.id);
  };
}