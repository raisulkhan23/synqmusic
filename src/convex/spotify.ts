import { ConvexError } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// Spotify chart source (v1).
// "Songs of the week" is powered by Spotify's public "Today's Top Hits"
// playlist, read from the embed page's inlined JSON (__NEXT_DATA__) — no API
// keys required. Playback itself still resolves through the YouTube IFrame
// engine on the client; Spotify here is the metadata/chart provider.
// ---------------------------------------------------------------------------

/** Spotify's flagship chart playlist: Today's Top Hits. */
const CHART_PLAYLIST = "37i9dQZF1DXcBWIGoYBM5M";

/** How many chart entries to return (and fetch artwork for). */
const MAX_ITEMS = 10;

const INVALID_ARTIST_NAMES =
  /^(?:unknown artist|artist|song|video|single|album|ep|music|official|unknown|topic|records?|music video|official video|official audio|lyrics?)$/i;

function cleanArtistName(value: unknown, title?: string): string {
  if (typeof value !== "string") return "Unknown artist";
  const name = value
    .replace(/\s+/g, " ")
    .replace(
      /(?:\(|\[)(?:official|topic|audio|video|lyrics?|visualizer|hd|hq)[^\])]*(?:\)|\])/gi,
      "",
    )
    .replace(/\s+(?:topic|vevo)$/i, "")
    .trim();
  if (!name || INVALID_ARTIST_NAMES.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
    return "Unknown artist";
  }
  const titleKey = (title ?? "")
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const candidates = name
    .split(/\s*(?:[•·|]|\s+[-–—]\s+)\s*/i)
    .map((part) => part.replace(/^[\s\-–—|·]+|[\s\-–—|·]+$/g, "").trim())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (
      INVALID_ARTIST_NAMES.test(candidate) ||
      !/[\p{L}\p{N}]/u.test(candidate)
    )
      continue;
    const candidateKey = candidate
      .toLocaleLowerCase()
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (titleKey && candidateKey === titleKey) continue;
    return candidate;
  }
  return "Unknown artist";
}

interface ChartItem {
  /** Spotify track id (the tail of "spotify:track:{id}"). */
  id: string;
  title: string;
  artist: string;
  /** seconds */
  duration: number;
  thumbnail: string;
}

interface RawTrack {
  uri?: string;
  title?: string;
  subtitle?: string;
  /** milliseconds in the embed payload */
  duration?: number;
  isPlayable?: boolean;
}

// Actions are stateless, but a short in-process cache lets warm isolates skip
// refetching the playlist on every page load.
let cache: { at: number; items: ChartItem[] } | null = null;
const CACHE_MS = 10 * 60 * 1000;

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/json" },
  });
  if (!res.ok) {
    throw new ConvexError(`Spotify request failed (${res.status})`);
  }
  return res.text();
}

/** Loose traversal helper for the deeply nested parsed JSON. */
const get = (obj: unknown, path: string[]): unknown =>
  path.reduce<unknown>((acc, key) => {
    if (
      acc &&
      typeof acc === "object" &&
      key in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

/** The Spotify embed page inlines the full playlist state as __NEXT_DATA__. */
function extractTrackList(html: string): RawTrack[] {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const start = html.indexOf(marker);
  if (start < 0) {
    throw new ConvexError("Unexpected Spotify embed page (no embedded data)");
  }
  const jsonStart = start + marker.length;
  const end = html.indexOf("</script>", jsonStart);
  if (end < 0) {
    throw new ConvexError("Unexpected Spotify embed page (truncated data)");
  }

  let data: unknown;
  try {
    data = JSON.parse(html.slice(jsonStart, end));
  } catch {
    throw new ConvexError("Failed to parse Spotify embed data");
  }

  const list = get(data, [
    "props",
    "pageProps",
    "state",
    "data",
    "entity",
    "trackList",
  ]);
  return Array.isArray(list) ? (list as RawTrack[]) : [];
}

/** Public oembed endpoint: returns the track's cover art, no auth needed. */
async function thumbnailFor(trackId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://open.spotify.com/oembed?url=spotify:track:${trackId}`,
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) return "";
    const data = (await res.json()) as { thumbnail_url?: string };
    return typeof data.thumbnail_url === "string" ? data.thumbnail_url : "";
  } catch {
    return "";
  }
}

/**
 * Fetch the current "Songs of the week" chart from Spotify (no API keys).
 * Items use the same shape as YouTube search results so the client player can
 * consume them directly — playback is resolved through the YouTube engine.
 */
export const spotifyChart = action({
  args: {},
  handler: async (): Promise<{ items: ChartItem[] }> => {
    if (cache && Date.now() - cache.at < CACHE_MS) {
      return { items: cache.items };
    }

    const html = await fetchText(
      `https://open.spotify.com/embed/playlist/${CHART_PLAYLIST}`,
    );

    const tracks = extractTrackList(html)
      .filter(
        (t) =>
          t.isPlayable !== false &&
          typeof t.uri === "string" &&
          t.uri.startsWith("spotify:track:"),
      )
      .slice(0, MAX_ITEMS)
      .map((t) => ({
        id: (t.uri as string).slice("spotify:track:".length),
        title: t.title ?? "Untitled",
        artist: cleanArtistName(t.subtitle, t.title),
        duration: Math.round((Number(t.duration) || 0) / 1000),
      }));

    // Per-track cover art, fetched in parallel via the public oembed endpoint.
    const items: ChartItem[] = await Promise.all(
      tracks.map(async (t) => ({
        ...t,
        thumbnail: await thumbnailFor(t.id),
      })),
    );

    cache = { at: Date.now(), items };
    return { items };
  },
});
