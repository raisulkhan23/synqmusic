import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// Soundscape audio source resolver (v2).
// These actions talk to YouTube's InnerTube API (the same endpoints the
// official apps use) to search for tracks and to resolve a direct, playable
// audio stream URL for a video. No external keys required — the public
// INNERTUBE key below is the one embedded in every YouTube client.
// ---------------------------------------------------------------------------

export interface YtItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/**
 * The public shape returned when a stream can't be resolved. The frontend
 * treats this as a cue to show the YouTube link as the primary action rather
 * than attempting playback.
 */
export interface StreamUnavailable {
  url: null;
  title: string;
  reason: string;
  youtubeUrl: string;
}

const API = "https://www.youtube.com/youtubei/v1/";
const UA =
  "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip";
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

interface InnerTubeClient {
  clientName: string;
  clientVersion: string;
  androidSdkVersion?: number;
  deviceModel?: string;
  osVersion?: string;
}

// Clients that return unencrypted stream URLs, in preference order.
const CLIENTS: InnerTubeClient[] = [
  { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 30 },
  {
    clientName: "IOS",
    clientVersion: "19.09.3",
    deviceModel: "iPhone14,3",
    osVersion: "16.5.0",
  },
  { clientName: "MWEB", clientVersion: "2.20240801.01.00" },
];

async function innerTube(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      "X-Goog-Api-Key": INNERTUBE_KEY,
      Origin: "https://www.youtube.com",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ConvexError(`YouTube API returned ${res.status}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

const clientContext = (client: InnerTubeClient) => ({
  client: {
    hl: "en",
    gl: "US",
    userAgent: UA,
    ...client,
  },
});

/** Parse a "H:MM:SS" / "MM:SS" / "SS" length string into seconds. */
function parseLength(raw?: string): number {
  if (!raw) return 0;
  const parts = raw.split(":").map((p) => Number(p) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] ?? 0;
}

// Loose structural helpers — InnerTube responses are deeply nested and typed
// as unknown, so we traverse defensively.
const get = (obj: unknown, path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

function extractSearchResults(data: Record<string, unknown>): YtItem[] {
  const out: YtItem[] = [];
  const sections = get(data, [
    "contents",
    "twoColumnSearchResultsRenderer",
    "primaryContents",
    "sectionListRenderer",
    "contents",
  ]);
  if (!Array.isArray(sections)) return out;

  for (const section of sections) {
    const items = get(section, ["itemSectionRenderer", "contents"]);
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const vr = get(item, ["videoRenderer"]) as Record<string, unknown> | undefined;
      const videoId = vr ? (vr.videoId as string | undefined) : undefined;
      if (!videoId) continue;

      const title =
        (get(vr, ["title", "runs", "0", "text"]) as string) ??
        (get(vr, ["title", "simpleText"]) as string) ??
        "Untitled";
      const artist =
        (get(vr, ["ownerText", "runs", "0", "text"]) as string) ?? "Unknown artist";
      const lengthText = get(vr, ["lengthText", "simpleText"]) as string | undefined;
      const thumbs = get(vr, ["thumbnail", "thumbnails"]);
      const thumbnail = Array.isArray(thumbs)
        ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
        : "";

      out.push({ id: videoId, title, artist, duration: parseLength(lengthText), thumbnail });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

/**
 * Search YouTube for a track. Returns up to 10 video results with enough
 * metadata to render a premium result list.
 */
export const searchYoutube = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<{ items: YtItem[] }> => {
    if (!query.trim()) return { items: [] };
    const data = await innerTube("search", {
      context: clientContext(CLIENTS[0]),
      query,
      params: "EgIQAQ%3D%3D", // video-only search filter
    });
    return { items: extractSearchResults(data) };
  },
});

/**
 * Resolve a direct, playable audio stream URL for a YouTube video. Tries
 * several clients in order and picks the highest-quality audio-only format.
 */
const streamResultValidator = v.union([
  v.object({ url: v.string(), title: v.string() }),
  v.object({
    url: v.null(),
    title: v.string(),
    reason: v.string(),
    youtubeUrl: v.string(),
  }),
]);

export const resolveStream = action<typeof streamResultValidator, {
  videoId: string;
}>({
  args: { videoId: v.string() },
  handler: async (_ctx, { videoId }): Promise<
    | { url: string; title: string }
    | StreamUnavailable
  > => {
    let lastError: string | undefined;
    let lastTitle: string | undefined;

    for (const client of CLIENTS) {
      try {
        const data = await innerTube("player", {
          context: clientContext(client),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
        });

        const status = get(data, ["playabilityStatus", "status"]) as string | undefined;
        if (status && status !== "OK") {
          lastTitle =
            (get(data, ["videoDetails", "title"]) as string) ??
            `YouTube video ${videoId}`;
          lastError =
            (get(data, ["playabilityStatus", "reason"]) as string) ??
            `Playback unavailable (${status})`;
          continue;
        }

        const videoTitle =
          (get(data, ["videoDetails", "title"]) as string) ??
          undefined;
        if (videoTitle) lastTitle = videoTitle;

        const adaptive = get(data, ["streamingData", "adaptiveFormats"]);
        const base = get(data, ["streamingData", "formats"]);
        const formats = [
          ...(Array.isArray(adaptive) ? adaptive : []),
          ...(Array.isArray(base) ? base : []),
        ].filter(
          (f): f is Record<string, unknown> =>
            !!f &&
            typeof f === "object" &&
            typeof (f as Record<string, unknown>).url === "string" &&
            typeof (f as Record<string, unknown>).mimeType === "string" &&
            ((f as Record<string, unknown>).mimeType as string).startsWith("audio/"),
        );

        const best = formats.sort(
          (a, b) => (b.bitrate as number) - (a.bitrate as number),
        )[0] as Record<string, unknown> | undefined;

        if (best?.url) {
          return {
            url: best.url as string,
            title: videoTitle ?? "YouTube audio",
          };
        }

        // Player returned OK but no audio formats — treat as unavailable.
        lastTitle = videoTitle ?? `YouTube video ${videoId}`;
        lastError = "No audio stream available for this video";
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Stream resolution failed";
      }
    }

    return {
      url: null,
      title: lastTitle ?? `YouTube video ${videoId}`,
      reason: lastError ?? "No playable audio stream found for this video",
      youtubeUrl: `https://youtu.be/${videoId}`,
    };
  },
});