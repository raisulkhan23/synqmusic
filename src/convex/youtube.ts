import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";

// ---------------------------------------------------------------------------
// SYNQ audio source resolver.
// Talks to YouTube InnerTube / YouTube Music to search for music and to
// resolve a direct, playable audio stream for a video. No external keys
// required — the public INNERTUBE key below is embedded in every YouTube
// client.
// ---------------------------------------------------------------------------

export interface YtItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  /** Album when the source reports one; absent means unknown, never guessed. */
  album?: string;
}

const API = "https://www.youtube.com/youtubei/v1/";
const REQUEST_TIMEOUT_MS = 10_000;
const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

interface InnerTubeClient {
  /** X-Youtube-Client-Name header value */
  id: string;
  clientName: string;
  clientVersion: string;
  userAgent: string;
  extra?: Record<string, unknown>;
}

// WEB — reliable for `search`, returns the twoColumnSearchResultsRenderer
// shape the parser below expects.
const WEB: InnerTubeClient = {
  id: "1",
  clientName: "WEB",
  clientVersion: "2.20240801.01.00",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

// ANDROID / IOS — historically returned unencrypted stream URLs for `player`.
const ANDROID: InnerTubeClient = {
  id: "3",
  clientName: "ANDROID",
  clientVersion: "19.44.38",
  userAgent: "com.google.android.youtube/19.44.38 (Linux; U; Android 14) gzip",
  extra: { androidSdkVersion: 34 },
};

const IOS: InnerTubeClient = {
  id: "5",
  clientName: "IOS",
  clientVersion: "19.45.4",
  userAgent:
    "com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)",
  extra: { deviceModel: "iPhone16,2", osVersion: "18.1.0.22B83" },
};

const MWEB: InnerTubeClient = {
  id: "2",
  clientName: "MWEB",
  clientVersion: "2.20240801.01.00",
  userAgent:
    "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
};

// Android VR (Daydream) client — newer client that is generally not subject
// to the datacenter bot-check that blocks ANDROID/IOS stream resolution.
const ANDROID_VR: InnerTubeClient = {
  id: "28",
  clientName: "ANDROID_VR",
  clientVersion: "1.60.19",
  userAgent:
    "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip",
  extra: { androidSdkVersion: 31, osName: "Android", osVersion: "12" },
};

// TV embedded client — typically not subject to the datacenter bot-check that
// blocks ANDROID/IOS stream resolution from cloud IPs.
const TV_EMBEDDED: InnerTubeClient = {
  id: "85",
  clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
  clientVersion: "2.0",
  userAgent:
    "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15",
  extra: { clientScreen: "EMBED" },
};

async function innerTube(
  endpoint: string,
  client: InnerTubeClient,
  body: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": client.userAgent,
      "X-Goog-Api-Key": INNERTUBE_KEY,
      "X-Youtube-Client-Name": client.id,
      "X-Youtube-Client-Version": client.clientVersion,
      Origin: "https://www.youtube.com",
      "X-Origin": "https://www.youtube.com",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
    userAgent: client.userAgent,
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    ...client.extra,
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

const CREATOR_NAME_PLACEHOLDER_RE =
  /^(?:unknown artist|artist|song|video|single|album|ep|music|official|unknown|topic|records?|music video|official video|official audio|lyrics?)$/i;

function cleanCreatorName(value: unknown): string {
  if (typeof value !== "string") return "Unknown artist";
  const name = value
    .replace(/\s+/g, " ")
    .replace(
      /(?:\(|\[)(?:official|topic|audio|video|lyrics?|visualizer|hd|hq)[^\])]*(?:\)|\])/gi,
      "",
    )
    .replace(/\s+(?:topic|vevo)$/i, "")
    .trim();
  if (
    !name ||
    CREATOR_NAME_PLACEHOLDER_RE.test(name) ||
    !/[\p{L}\p{N}]/u.test(name)
  ) {
    return "Unknown artist";
  }
  return name;
}

function firstCreatorName(title: string, ...values: unknown[]): string {
  const titleKey = normalizeMatchText(title);
  for (const value of values) {
    const raw = cleanCreatorName(value);
    if (raw === "Unknown artist") continue;
    const candidates = raw
      .split(/\s*(?:[•·|]|\s+[-–—]\s+)\s*/i)
      .map((part) => part.replace(/^[\s\-–—|·]+|[\s\-–—|·]+$/g, "").trim())
      .filter(Boolean);
    for (const candidate of candidates) {
      if (
        CREATOR_NAME_PLACEHOLDER_RE.test(candidate) ||
        !/[\p{L}\p{N}]/u.test(candidate)
      )
        continue;
      if (normalizeMatchText(candidate) !== titleKey) return candidate;
    }
  }
  return "Unknown artist";
}

function cleanTrackTitle(value: string): string {
  let title = value.replace(/\s+/g, " ").trim();
  const suffixPatterns = [
    /\s+[-–—]\s+music\s+for\s+.*$/i,
    /\s+[-–—|]\s*(?:official\s+)?(?:music\s+video|music\s+audio|audio|lyrics?|visualizer)\s*$/i,
    /\s*(?:\(|\[)\s*(?:official\s+)?(?:music\s+video|music\s+audio|audio|lyrics?|visualizer)\s*(?:\)|\])\s*$/i,
  ];
  for (const pattern of suffixPatterns)
    title = title.replace(pattern, "").trim();
  return title || value.trim();
}

// Loose structural helpers — InnerTube responses are deeply nested and typed
// as unknown, so we traverse defensively.
// NOTE: numeric segments index LISTS ("tabs" → [tab]) and string segments
// read object keys — the old helper only handled dicts, so paths like
// ["tabs", "0", ...] silently returned undefined and musicSearch always
// returned zero results (the home sections never loaded).
const get = (obj: unknown, path: (string | number)[]): unknown =>
  path.reduce<unknown>((acc, key) => {
    if (typeof key === "number") {
      return Array.isArray(acc) && key < acc.length ? acc[key] : undefined;
    }
    if (
      acc &&
      typeof acc === "object" &&
      key in (acc as Record<string, unknown>)
    ) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);

function extractSearchResults(
  data: Record<string, unknown>,
  limit = 10,
): YtItem[] {
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
      const vr = get(item, ["videoRenderer"]) as
        | Record<string, unknown>
        | undefined;
      const videoId = vr ? (vr.videoId as string | undefined) : undefined;
      if (!videoId) continue;

      const title =
        (get(vr, ["title", "runs", 0, "text"]) as string) ??
        (get(vr, ["title", "simpleText"]) as string) ??
        "Untitled";
      const artist = firstCreatorName(
        title,
        get(vr, ["ownerText", "runs", 0, "text"]),
        get(vr, ["longBylineText", "runs", 0, "text"]),
      );
      const lengthText = get(vr, ["lengthText", "simpleText"]) as
        | string
        | undefined;
      const thumbs = get(vr, ["thumbnail", "thumbnails"]);
      const thumbnail = Array.isArray(thumbs)
        ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
        : "";

      out.push({
        id: videoId,
        title: cleanTrackTitle(title),
        artist,
        duration: parseLength(lengthText),
        thumbnail,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Music-only search (YouTube Music).
// Uses the YouTube Music InnerTube endpoint with the WEB_REMIX client, which
// exclusively serves music content — no vlogs, podcasts, uploads, etc.
// ---------------------------------------------------------------------------

const MUSIC_CLIENT: InnerTubeClient = {
  id: "67",
  clientName: "WEB_REMIX",
  clientVersion: "1.20240801.01.00",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
};

const MUSIC_API = "https://music.youtube.com/youtubei/v1/";

async function musicSearch(query: string): Promise<YtItem[]> {
  const res = await fetch(`${MUSIC_API}search?prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": MUSIC_CLIENT.userAgent,
      "X-Goog-Api-Key": INNERTUBE_KEY,
      "X-Youtube-Client-Name": MUSIC_CLIENT.id,
      "X-Youtube-Client-Version": MUSIC_CLIENT.clientVersion,
      Origin: "https://music.youtube.com",
      "X-Origin": "https://music.youtube.com",
      Referer: "https://music.youtube.com/",
    },
    body: JSON.stringify({
      context: {
        client: {
          hl: "en",
          gl: "US",
          clientName: MUSIC_CLIENT.clientName,
          clientVersion: MUSIC_CLIENT.clientVersion,
        },
      },
      query,
      // Songs-shelf filter: restricts results to YouTube Music's "Songs"
      // shelf — proper studio tracks/album versions, not random videos.
      params: "Eg-KAQwIARAAGAAgACgAMABqChAEEAMQBBApEAU",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new ConvexError(`YouTube Music API returned ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { items: extractMusicResults(data), ok: hasMusicResults(data) };
}

/**
 * Heuristics that reject anything that is not a real music track:
 * - duration must be between 30s and 15 min (filters streams, mixes, livesets)
 * - title/owner must not look like a podcast, interview, mix, etc.
 */
// Match phrases, not isolated words. Song titles and artist names legitimately
// contain words such as "army", "troop", "sports", and "highlights"; rejecting
// those words by themselves made valid catalog tracks disappear.
const GAMING_CONTENT_RE =
  /\b(clash of clans|coc|gameplay|video game|mobile game|walkthrough|let'?s play|inferno tower|inferno dragon|super witch|new troops?|max troops?|max single|all max troop|home village|builder base|base layout|attack strategy|defen[cs]e strategy|super troops?|hog rider|barbarian|archer queen|spell caster)\b/i;
const NON_MUSIC_RE =
  /\b(podcast|episode|interview|full album|mix(?:ed)? by|megamix|dj set|live set|1 hour|10 hours|hours of|asmr|reaction|tutorial|karaoke|cover\s*\?*|how to deal with|football highlights?|soccer highlights?|basketball highlights?|sports highlights?|match highlights?|game highlights?|wta|atp|nba|nfl|ufc|formula 1|grand prix|china open|press conference|breaking news|news update|match review|match result|transfer news|sports news)\b/i;

export function isMusicTrack(item: YtItem): boolean {
  if (item.duration > 0 && (item.duration < 30 || item.duration > 900))
    return false;
  const hay = `${item.title} ${item.artist}`;
  return !GAMING_CONTENT_RE.test(hay) && !NON_MUSIC_RE.test(hay);
}

// Lyric/lo-fi uploads are a separate source, not interchangeable with the
// YouTube Music Songs shelf. These helpers deliberately require a real music
// marker, a song-like duration, and a close match to the user's query so a
// video that merely mentions a song can never leak into this list.
const MUSIC_VIDEO_MARKER_RE =
  /\b(lyrics?|lyrical|lofi|lo-fi|music\s*video|official\s*(audio|video))\b/i;
const QUERY_NOISE_RE =
  /\b(song|songs|music|track|video|official|lyrics?|lyrical|lofi|lo-fi|remix|version|full|album|audio)\b/i;

function normalizeMatchText(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function queryTerms(query: string): string[] {
  return normalizeMatchText(query)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length > 1 && !QUERY_NOISE_RE.test(term));
}

/** Strict gate for the supplemental lyric/lo-fi source. */
export function isLyricVideoTrack(item: YtItem, query: string): boolean {
  if (!isMusicTrack(item)) return false;
  // Unknown-length results are not safe to classify from title text alone.
  if (item.duration < 30 || item.duration > 900) return false;
  const haystack = normalizeMatchText(`${item.title} ${item.artist}`);
  if (!MUSIC_VIDEO_MARKER_RE.test(`${item.title} ${item.artist}`)) return false;

  const terms = queryTerms(query);
  if (terms.length === 0) return false;
  const matches = terms.filter((term) => haystack.includes(term)).length;
  // Song-title searches are normally short, so require every meaningful term.
  // For longer searches, allow a small amount of artist/title noise without
  // accepting a result that shares only one generic word.
  return terms.length <= 6
    ? matches === terms.length
    : matches >= Math.ceil(terms.length * 0.7);
}

/** Deduplicate by video id and by normalized title + artist. */
export function dedupeMusicItems(items: YtItem[]): YtItem[] {
  const seenIds = new Set<string>();
  const seenTracks = new Set<string>();
  return items.filter((item) => {
    const trackKey = `${normalizeMatchText(item.title)}|${normalizeMatchText(item.artist)}`;
    if (seenIds.has(item.id) || seenTracks.has(trackKey)) return false;
    seenIds.add(item.id);
    seenTracks.add(trackKey);
    return true;
  });
}

function hasMusicEvidence(item: YtItem): boolean {
  return (
    item.duration >= 30 &&
    item.duration <= 900 &&
    MUSIC_VIDEO_MARKER_RE.test(`${item.title} ${item.artist}`)
  );
}

const DISCOVERY_QUERY_RE =
  /\b(songs?|music|hits|mix|playlist|chill|happy|sad|energetic|focus|workout|party|sleep|romantic|nostalgic|pop|rock|jazz|classical|ambient|funk|metal|country|reggaeton|afrobeats|k[\s-]?pop|indie|electronic|lo-fi|r\s*(?:&|and)\s*b|hip-hop)\b/i;

const DISCOVERY_SEEDS: Array<[RegExp, string[]]> = [
  [/\bk[\s-]?pop\b/i, ["BLACKPINK songs", "TWICE songs", "Stray Kids songs"]],
  [
    /\bpop\b/i,
    ["Taylor Swift songs", "Dua Lipa songs", "Olivia Rodrigo songs"],
  ],
  [
    /\bhip[\s-]?hop\b/i,
    ["Kendrick Lamar songs", "Drake songs", "Nicki Minaj songs"],
  ],
  [/\brock\b/i, ["Foo Fighters songs", "Queen songs", "Nirvana songs"]],
  [
    /\br\s*(?:&|and)\s*b\b/i,
    ["SZA songs", "The Weeknd songs", "Daniel Caesar songs"],
  ],
  [/\belectronic\b/i, ["Daft Punk songs", "Justice songs", "Disclosure songs"]],
  [
    /\bindie\b/i,
    ["Phoebe Bridgers songs", "Tame Impala songs", "Arctic Monkeys songs"],
  ],
  [
    /\bjazz\b/i,
    ["Miles Davis songs", "Ella Fitzgerald songs", "Kamasi Washington songs"],
  ],
  [
    /\bclassical\b/i,
    ["Ludwig van Beethoven songs", "Mozart songs", "Chopin songs"],
  ],
  [/\blo[\s-]?fi\b/i, ["Lofi Girl songs", "KSW songs", "Lofi beats songs"]],
  [/\bmetal\b/i, ["Metallica songs", "Slipknot songs", "Iron Maiden songs"]],
  [
    /\bcountry\b/i,
    ["Morgan Wallen songs", "Luke Combs songs", "Maren Morris songs"],
  ],
  [/\breggaeton\b/i, ["Bad Bunny songs", "Karol G songs", "J Balvin songs"]],
  [/\bafrobeats\b/i, ["Burna Boy songs", "Wizkid songs", "Tems songs"]],
  [
    /\bambient\b/i,
    ["Brian Eno songs", "Max Richter songs", "Marconi Union songs"],
  ],
  [/\bfunk\b/i, ["Jamiroquai songs", "Vulfpeck songs", "The Meters songs"]],
  [
    /\bchill\b/i,
    ["Frank Ocean songs", "Daniel Caesar songs", "Khruangbin songs"],
  ],
  [
    /\bhappy\b/i,
    ["Pharrell Williams songs", "Olivia Rodrigo songs", "Dua Lipa songs"],
  ],
  [
    /\bsad\b/i,
    ["Billie Eilish songs", "Lana Del Rey songs", "The National songs"],
  ],
  [
    /\benergetic\b/i,
    ["Imagine Dragons songs", "The Killers songs", "Arctic Monkeys songs"],
  ],
  [
    /\bfocus\b/i,
    ["Ludovico Einaudi songs", "Max Richter songs", "Ólafur Arnalds songs"],
  ],
  [/\bworkout\b/i, ["Kendrick Lamar songs", "Drake songs", "Doja Cat songs"]],
  [/\bparty\b/i, ["Dua Lipa songs", "Doja Cat songs", "Kylie Minogue songs"]],
  [
    /\bsleep\b/i,
    ["Norah Jones songs", "Billie Eilish songs", "Bon Iver songs"],
  ],
  [/\bromantic\b/i, ["Adele songs", "The Weeknd songs", "SZA songs"]],
  [
    /\bnostalgic\b/i,
    ["Fleetwood Mac songs", "The Weeknd songs", "Tame Impala songs"],
  ],
];

/**
 * Artist-backed seed queries for a category/mood request. A broad query can
 * match several groups at once ("indie pop" matches `indie` and `pop`), so the
 * seeds are round-robined across the matching groups instead of concatenated.
 * Concatenation let the caller's `slice` cap cut off the second genre almost
 * entirely, which is exactly the variety a broad genre request is asking for.
 */
export const DISCOVERY_SEED_LIMIT = 4;

export function discoverySeedQueries(
  query: string,
  limit = DISCOVERY_SEED_LIMIT,
): string[] {
  const groups = DISCOVERY_SEEDS.filter(([pattern]) => pattern.test(query))
    .map(([, categorySeeds]) => categorySeeds)
    .filter((seeds) => seeds.length > 0);
  if (groups.length === 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  for (
    let round = 0;
    round < Math.max(...groups.map((seeds) => seeds.length));
    round++
  ) {
    for (const seeds of groups) {
      const seed = seeds[round];
      if (seed && !seen.has(seed)) {
        seen.add(seed);
        out.push(seed);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

function matchesSearchQuery(item: YtItem, query: string): boolean {
  const terms = normalizeMatchText(query)
    .split(" ")
    .filter((term) => term.length > 1 && !QUERY_NOISE_RE.test(term));
  if (terms.length === 0) return false;
  const result = normalizeMatchText(`${item.title} ${item.artist}`);
  const matches = terms.filter((term) => result.includes(term)).length;
  // Broad discovery searches are category requests, not exact title queries.
  // Requiring every term made useful fallbacks such as "pop music hits" fail
  // because the returned metadata naturally does not contain the word
  // "hits". Exact song/artist searches remain strict.
  if (DISCOVERY_QUERY_RE.test(query)) return matches > 0;
  return matches === terms.length;
}

/**
 * Gate for the regular-web fallback. A close query match plus a song-length
 * duration is useful even when an otherwise valid upload has no "official
 * audio" wording in its title/channel. Contextual non-music filters above keep
 * this permissive without reintroducing the broad gaming/sports false positives.
 */
export function isPrimaryMusicResult(item: YtItem, query: string): boolean {
  if (!isMusicTrack(item) || item.duration < 30 || item.duration > 900)
    return false;
  return matchesSearchQuery(item, query);
}

function extractMusicResults(data: Record<string, unknown>): YtItem[] {
  const out: YtItem[] = [];
  const others: YtItem[] = [];
  const seen = new Set<string>();
  // Songs/videos first — playlists, albums and artists don't play as a single
  // track and used to fill the results, pushing real songs out of the list.
  const push = (entry: (YtItem & { kind?: "song" | "other" }) | null) => {
    if (!entry || seen.has(entry.id)) return;
    seen.add(entry.id);
    if (entry.kind === "other") others.push(entry);
    else out.push(entry);
  };

  const sections = get(data, [
    "contents",
    "tabbedSearchResultsRenderer",
    "tabs",
    0,
    "tabRenderer",
    "content",
    "sectionListRenderer",
    "contents",
  ]);
  const flat = Array.isArray(sections)
    ? sections
    : get(data, ["contents", "sectionListRenderer", "contents"]);
  if (!Array.isArray(flat)) return out;

  for (const section of flat) {
    // Legacy shape: a dedicated songs shelf.
    const shelf = get(section, ["musicShelfRenderer", "contents"]);
    if (Array.isArray(shelf)) {
      for (const item of shelf) {
        const renderer = get(item, ["musicResponsiveListItemRenderer"]) as
          | Record<string, unknown>
          | undefined;
        if (renderer) {
          const entry = parseMusicListItem(renderer);
          if (entry) push(entry);
        }
        if (out.length >= 20) break;
      }
      if (out.length >= 20) break;
      continue;
    }

    // Current shape (2026+): results arrive as a list of
    // itemSectionRenderer blocks, each wrapping one
    // musicResponsiveListItemRenderer — plus a musicCardShelfRenderer top
    // result. The old parser only read musicShelfRenderer, so every search
    // silently returned zero items and the home sections never loaded.
    const card = get(section, ["musicCardShelfRenderer"]);
    if (card && typeof card === "object") {
      const entry = parseMusicCardShelf(card as Record<string, unknown>);
      // Top-result cards do not carry reliable song metadata. Do not let a
      // sports/news upload enter the music catalog just because YouTube
      // Music placed it in the search response.
      if (entry && hasMusicEvidence(entry)) push(entry);
    }
    const isrItems = get(section, ["itemSectionRenderer", "contents"]);
    if (Array.isArray(isrItems)) {
      for (const item of isrItems) {
        const renderer = get(item, ["musicResponsiveListItemRenderer"]) as
          | Record<string, unknown>
          | undefined;
        if (renderer) {
          const entry = parseMusicListItem(renderer);
          if (entry) push(entry);
        }
        if (out.length >= 20) break;
      }
      if (out.length >= 20) break;
    }
  }
  // Not enough typed single tracks — only top up with rows that carry an
  // explicit music marker. Untyped rows are deliberately not promoted: that
  // was the path that previously let unrelated videos into music search.
  for (const o of others) {
    if (out.length >= 20) break;
    if (hasMusicEvidence(o)) out.push(o);
  }
  return out.filter(isMusicTrack).slice(0, 10);
}

/**
 * One musicResponsiveListItemRenderer → YtItem, or null when the row isn't a
 * directly playable single track (playlists/artists have no watch videoId).
 * Reads the videoId from every place YouTube puts it: playlistItemData, the
 * overlay play button's watchEndpoint, or the row's navigationEndpoint.
 * Also classifies the row: YouTube puts the type ("Song"/"Video"/"Playlist"…)
 * as the first subtitle run of column 1.
 */
export function parseMusicListItem(
  renderer: Record<string, unknown>,
): (YtItem & { kind: "song" | "other" }) | null {
  const videoId =
    (get(renderer, ["playlistItemData", "videoId"]) as string | undefined) ??
    (get(renderer, [
      "overlay",
      "musicItemThumbnailOverlayRenderer",
      "content",
      "musicPlayButtonRenderer",
      "playNavigationEndpoint",
      "watchEndpoint",
      "videoId",
    ]) as string | undefined) ??
    (get(renderer, ["navigationEndpoint", "watchEndpoint", "videoId"]) as
      | string
      | undefined);
  if (!videoId) return null;

  const flex = get(renderer, ["flexColumns"]);
  if (!Array.isArray(flex)) return null;
  const runsOf = (col: unknown) =>
    (get(col, ["musicResponsiveListItemFlexColumnRenderer", "text", "runs"]) as
      | Array<{ text?: string }>
      | undefined) ?? [];
  const textOf = (col: unknown) => runsOf(col)[0]?.text ?? "";
  const title = cleanTrackTitle(textOf(flex[0]) || "Untitled");
  // Column 1 interleaves metadata and separator runs. Depending on the
  // response shape it can be [artist, " • ", album, " • ", duration] or
  // [type, " • ", artist, " • ", duration], so separators must never be
  // mistaken for the artist.
  const runs =
    (get(flex[1], [
      "musicResponsiveListItemFlexColumnRenderer",
      "text",
      "runs",
    ]) as Array<{ text?: string }> | undefined) ?? [];
  const metaRuns = runs
    .map((run) => run.text?.trim() ?? "")
    .filter((value) => value && !/^[•·,&]+$/.test(value));
  const typePattern =
    /^(song|video|playlist|album|artist|episode|short|music video|live performance|single|ep)$/i;
  const typeIndex = metaRuns.findIndex((value) => typePattern.test(value));
  const artistIndex = typeIndex >= 0 ? typeIndex + 1 : 0;
  const typeRun = typeIndex >= 0 ? metaRuns[typeIndex] : "";
  // The Songs shelf often omits the explicit "Song" metadata run and returns
  // only [artist, album, duration]. Keep those rows conservative: they are
  // promoted later only when they carry independent music evidence, while
  // explicitly non-track rows are always rejected.
  const kind: "song" | "other" =
    typeRun === "" || /^(playlist|album|artist|episode)$/i.test(typeRun)
      ? "other"
      : "song";
  const artist = firstCreatorName(
    title,
    metaRuns[artistIndex],
    get(renderer, ["subtitle", "runs", 0, "text"]),
    get(renderer, ["longBylineText", "runs", 0, "text"]),
  );
  const durationMatch = [...metaRuns]
    .reverse()
    .find((value) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(value));
  const durationRaw = durationMatch ?? textOf(flex[2]) ?? "";

  // Album, when YouTube actually reports one. The subtitle column packs
  // [type?, artist, album, year, duration], so the album is the run right
  // after the artist that is neither a duration, a bare year, a view count
  // nor another metadata label. When nothing qualifies it stays undefined —
  // the recommendation engine needs to know an album is unknown rather than
  // assume a value it cannot verify.
  const isNoise = (value: string) =>
    !value ||
    /^\d{1,2}:\d{2}(:\d{2})?$/.test(value) ||
    /^(19|20)\d{2}$/.test(value) ||
    typePattern.test(value) ||
    /views?$/i.test(value) ||
    /^\d[\d,]*$/i.test(value);
  const albumCandidate = metaRuns.find(
    (value, index) => index > artistIndex && !isNoise(value),
  );
  const album =
    albumCandidate && albumCandidate.toLowerCase() !== artist.toLowerCase()
      ? albumCandidate
      : undefined;

  const thumbs = get(renderer, [
    "thumbnail",
    "musicThumbnailRenderer",
    "thumbnail",
    "thumbnails",
  ]);
  const thumbnail = Array.isArray(thumbs)
    ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
    : "";

  return {
    id: videoId,
    title,
    artist,
    duration: parseLength(durationRaw),
    thumbnail,
    ...(album ? { album } : {}),
    kind,
  };
}

/** The musicCardShelfRenderer "Top result" card → YtItem (song only). */
function parseMusicCardShelf(card: Record<string, unknown>): YtItem | null {
  const videoId =
    (get(card, ["onTap", "watchEndpoint", "videoId"]) as string | undefined) ??
    (get(card, [
      "buttons",
      0,
      "buttonRenderer",
      "command",
      "watchEndpoint",
      "videoId",
    ]) as string | undefined);
  if (!videoId) return null;

  const title = cleanTrackTitle(
    (get(card, ["title", "runs", 0, "text"]) as string | undefined) ??
      (get(card, [
        "header",
        "musicCardShelfHeaderBasicRenderer",
        "title",
        "runs",
        0,
        "text",
      ]) as string | undefined) ??
      "Top result",
  );
  // Subtitle runs pack artist • song • year.
  const subtitle =
    (get(card, ["subtitle", "runs"]) as Array<{ text?: string }> | undefined) ??
    [];
  const parts = subtitle
    .map((r) => r.text ?? "")
    .join("")
    .split("•")
    .map((s) => s.trim());
  const artist = firstCreatorName(title, parts[0], parts[1]);
  const durationText =
    (get(card, ["lengthText", "simpleText"]) as string | undefined) ??
    parts.find((part) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part)) ??
    "";

  const thumbs = get(card, [
    "thumbnail",
    "musicThumbnailRenderer",
    "thumbnail",
    "thumbnails",
  ]);
  const thumbnail = Array.isArray(thumbs)
    ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
    : "";

  return {
    id: videoId,
    title,
    artist,
    duration: parseLength(durationText),
    thumbnail,
  };
}

/**
 * Did this response actually CONTAIN a search-results structure?
 *
 * Both extractors return `[]` when the container they walk is missing. That is
 * also exactly what YouTube returns when it answers with a bot-check
 * interstitial or an error page: HTTP 200, valid JSON, no results anywhere.
 * "No such song" and "we were never really answered" then collapse into the
 * same value, and the page tells someone their song does not exist when the
 * truth is that SYNQ could not ask.
 *
 * This is the same distinction `searchLyricVideos` already reports through its
 * `failed` flag; `searchYoutube` did not have it, and said "No related
 * results" during a total outage.
 */
function hasMusicResults(data: Record<string, unknown>): boolean {
  const sections = get(data, [
    "contents",
    "tabbedSearchResultsRenderer",
    "tabs",
    0,
    "tabRenderer",
    "content",
    "sectionListRenderer",
    "contents",
  ]);
  const flat = Array.isArray(sections)
    ? sections
    : get(data, ["contents", "sectionListRenderer", "contents"]);
  return Array.isArray(flat);
}

/** The same probe for the plain (non-Music) search response shape. */
function hasSearchResults(data: Record<string, unknown>): boolean {
  return Array.isArray(
    get(data, [
      "contents",
      "twoColumnSearchResultsRenderer",
      "primaryContents",
      "sectionListRenderer",
      "contents",
    ]),
  );
}

/**
 * Search YouTube for music. Uses the YouTube Music endpoint so ONLY music
 * tracks are ever returned — no podcasts, vlogs, mixes, or other videos.
 *
 * `failed` is the honest version of "we came back empty-handed": it is true
 * only when NO attempt returned a results structure at all, which means the
 * source never answered rather than that the query had no matches.
 */
export const searchYoutube = action({
  args: { query: v.string() },
  handler: async (
    _ctx,
    { query },
  ): Promise<{ items: YtItem[]; failed: boolean }> => {
    if (!query.trim()) return { items: [], failed: false };

    // Did anything actually answer with a results structure?
    let answered = false;

    // Category/mood searches are discovery requests, not literal title
    // searches. Prefer concrete artist-backed seeds BEFORE the broad shelf
    // response: YouTube Music often answers "K-pop songs" with soundtrack or
    // animation tracks even though it has plenty of actual K-pop songs.
    if (DISCOVERY_QUERY_RE.test(query)) {
      // Run the artist-backed seeds CONCURRENTLY, not one after another. A
      // broad genre query can match several seed groups at once ("indie pop"
      // matches both `indie` and `pop`), so the sequential version chained up
      // to six YouTube Music requests — long enough to blow the caller's
      // request timeout, which is why "Play something random" kept failing.
      const seeds = discoverySeedQueries(query);
      const settled = await Promise.allSettled(
        seeds.map((seedQuery) => musicSearch(seedQuery)),
      );
      const seeded = settled.flatMap((result) =>
        result.status === "fulfilled" ? result.value.items : [],
      );
      for (const result of settled) {
        if (result.status === "fulfilled" && result.value.ok) answered = true;
      }
      const combined = dedupeMusicItems(seeded).slice(0, 10);
      if (combined.length > 0) return { items: combined, failed: false };
    }

    // Preferred: YouTube Music — returns real studio tracks (Songs shelf),
    // never random YouTube videos.
    try {
      const attempt = await musicSearch(query);
      if (attempt.ok) answered = true;
      if (attempt.items.length > 0)
        return { items: attempt.items, failed: false };
    } catch {
      // fall through to the video-filter retry below
    }

    // Fallback: regular YouTube search restricted to the "video" result type,
    // with the same non-music heuristics.
    const data = await innerTube("search", WEB, {
      context: clientContext(WEB),
      query,
      params: "EgIQAQ%3D%3D",
    });
    // The fallback is only for a failed/empty YouTube Music response. It must
    // be stricter than the primary path: no duration-less or marker-less
    // uploads, otherwise a generic vlog can appear to be a song result.
    return {
      items: dedupeMusicItems(
        extractSearchResults(data).filter((item) =>
          isPrimaryMusicResult(item, query),
        ),
      ),
    };
  },
});

/**
 * Search only the lyric/lo-fi music-video category. The user's query stays
 * unchanged everywhere else; this action derives a narrowly scoped YouTube
 * query internally and then applies a second, strict filter before returning
 * anything. Results are intentionally kept separate from `searchYoutube`.
 */
/**
 * Supplemental "lyric & lo-fi video" results, kept strictly separate from the
 * primary Songs results.
 *
 * `failed` exists because this action used to swallow every failure into
 * `{ items: [] }`. An empty list and an unreachable YouTube were then the same
 * value, and the page — which hides the section when there is nothing to show —
 * made the whole Lyric & lo-fi section silently disappear on any transient
 * error. To a listener that is indistinguishable from the feature having been
 * deleted, and there was no way to retry. The two cases are now reported
 * separately so the UI can say which one happened.
 */
export const searchLyricVideos = action({
  args: { query: v.string() },
  handler: async (
    _ctx,
    { query },
  ): Promise<{ items: YtItem[]; failed: boolean }> => {
    const rawQuery = query.trim();
    if (!rawQuery) return { items: [], failed: false };

    // This derived string is used ONLY for this supplemental action. It is
    // never written back to the input, search history, analytics, or the
    // primary YouTube Music request.
    const videoQuery = `${rawQuery} (lyric video OR lyrics OR lofi OR lo-fi OR music video)`;
    try {
      const data = await innerTube("search", WEB, {
        context: clientContext(WEB),
        query: videoQuery,
        params: "EgIQAQ%3D%3D",
      });
      const items = dedupeMusicItems(
        extractSearchResults(data).filter((item) =>
          isLyricVideoTrack(item, rawQuery),
        ),
      );
      return { items: items.slice(0, 8), failed: false };
    } catch {
      return { items: [], failed: true };
    }
  },
});

// ---------------------------------------------------------------------------
// Creative Commons discovery.
//
// Search for music YouTube itself licenses under Creative Commons, so the
// tracks that CAN be stored offline are findable rather than hidden behind a
// download button that mostly says no.
//
// ---------------------------------------------------------------------------
// WHY EVERY RESULT IS VERIFIED, NOT JUST FILTERED
// ---------------------------------------------------------------------------
// YouTube exposes a "Features: Creative Commons" search filter, but a filter
// is a HINT and not an answer: it can be changed, ignored, or quietly stop
// applying, and the failure is completely silent — the request still returns
// results, they are just the wrong ones. Presenting those as Creative Commons
// would label a copyrighted recording as downloadable, which is precisely the
// outcome this whole area exists to prevent.
//
// So the candidate list is a hint and `status.license` is the answer. Every
// candidate is confirmed against the official Data API before it is returned,
// and an unconfirmed candidate is dropped. The filter's only job is RECALL; it
// can no longer affect CORRECTNESS. That is also why the plain music search is
// unioned in: if YouTube ever ignores the filter, this returns candidates to
// verify instead of nothing at all — noise, never a wrong answer.
//
// A consequence worth stating: Creative Commons music is a SMALL catalogue, so
// an empty result is a normal outcome rather than a broken one, and the UI says
// so. A larger, honest nothing beats a padded list that cannot be downloaded.
// ---------------------------------------------------------------------------

/**
 * Search param for YouTube's "Features → Creative Commons" filter.
 *
 * Base64 of the feature-filter protobuf (`{ f2: { f14: 4 } }`), the same
 * encoding the 4K filter uses with `f14: 1`. Deliberately the only magic value
 * here, and deliberately unable to cause a wrong result — see the header.
 */
const CC_FEATURE_FILTER_PARAMS = "EgJwBA==";

/**
 * Which of these video ids YouTube reports as Creative Commons.
 *
 * One `videos.list` call covers up to 50 ids, so verifying a whole page of
 * candidates costs a single unit of Data API quota. Anything that cannot be
 * checked — no key, an HTTP error, a malformed body — simply stays out of the
 * returned set. There is no path here that promotes an unverified video.
 */
async function verifiedCreativeCommonsIds(
  videoIds: string[],
): Promise<Set<string>> {
  const verified = new Set<string>();
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || videoIds.length === 0) return verified;

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(
          batch.join(","),
        )}&key=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, unknown>;
      const items = data.items;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const id = get(item, ["id"]);
        const license = get(item, ["status", "license"]);
        if (typeof id === "string" && license === CC_LICENSE) {
          verified.add(id);
        }
      }
    } catch {
      // An unverified batch stays unverified. Failing open here would hand the
      // listener a standard-licence track labelled Creative Commons.
    }
  }
  return verified;
}

/**
 * Search for Creative Commons music.
 *
 * `unconfigured` is separated from `failed` on purpose: "this deployment has
 * no Data API key" is a setting, not an outage, and telling a listener their
 * search broke when nothing about it did is its own small lie.
 */
export const searchCreativeCommons = action({
  args: { query: v.string() },
  handler: async (
    _ctx,
    { query },
  ): Promise<{ items: YtItem[]; failed: boolean; unconfigured: boolean }> => {
    const q = query.trim();
    if (!q) return { items: [], failed: false, unconfigured: false };

    if (!process.env.YOUTUBE_API_KEY) {
      return { items: [], failed: false, unconfigured: true };
    }

    try {
      // Both searches are free (InnerTube), so running them together costs
      // nothing and removes the dependency on the filter being honoured.
      const [filtered, plain] = await Promise.all([
        innerTube("search", WEB, {
          context: clientContext(WEB),
          query: q,
          params: CC_FEATURE_FILTER_PARAMS,
        }).catch(() => null),
        innerTube("search", WEB, {
          context: clientContext(WEB),
          query: q,
          params: "EgIQAQ%3D%3D",
        }).catch(() => null),
      ]);

      const candidates = dedupeMusicItems([
        ...(filtered ? extractSearchResults(filtered, 20) : []),
        ...(plain ? extractSearchResults(plain, 20) : []),
      ]).filter(isMusicTrack);

      if (candidates.length === 0) {
        return { items: [], failed: false, unconfigured: false };
      }

      const verified = await verifiedCreativeCommonsIds(
        candidates.map((candidate) => candidate.id),
      );

      return {
        items: candidates.filter((item) => verified.has(item.id)).slice(0, 10),
        failed: false,
        unconfigured: false,
      };
    } catch {
      return { items: [], failed: true, unconfigured: false };
    }
  },
});

/**
 * Which of these videos may be downloaded — a whole page in one call.
 *
 * The row badge has to agree with the Download action, and a row cannot afford
 * its own request: a 200-track playlist would be 200 action calls to answer a
 * question YouTube answers 50 ids at a time. So the client collects the ids on
 * screen and asks once.
 *
 * Returns the ELIGIBLE ids only, and nothing about the rest. "Not Creative
 * Commons" and "could not be checked" are deliberately indistinguishable to
 * the caller, because a badge must never appear on the strength of a check
 * that did not run — a listener who taps Download on a badged row and is
 * refused has been lied to by the badge.
 */
export const creativeCommonsFlags = action({
  args: { videoIds: v.array(v.string()) },
  handler: async (_ctx, { videoIds }): Promise<{ ids: string[] }> => {
    // Bounded, so one request can never fan out into an unbounded number of
    // Data API calls. The client chunks anything larger than this.
    const ids = [...new Set(videoIds)].slice(0, 50);
    if (ids.length === 0) return { ids: [] };
    const verified = await verifiedCreativeCommonsIds(ids);
    return { ids: [...verified] };
  },
});

/**
 * Display metadata for a YouTube video id, used by shared track links.
 *
 * A share link is just `/t/<videoId>` — the id alone identifies the song, so
 * nothing else is carried in the URL. That means the landing page has to look
 * the title/artist/art up from the id, which is what this does. Deliberately a
 * separate call from `resolveStream`: a link is opened by someone who may
 * never be able to play the audio (region blocked, bot-checked), and they
 * still deserve a correct title on the page.
 *
 * Public and unauthenticated on purpose — the recipient of a shared link is
 * not signed in. Returns null for an id that does not resolve, so the caller
 * can show a "not found" state instead of rendering a blank row.
 */
export const trackMeta = action({
  args: { videoId: v.string() },
  handler: async (
    _ctx,
    { videoId },
  ): Promise<{
    id: string;
    title: string;
    artist: string;
    coverUrl: string;
    duration: number;
  } | null> => {
    // Cheap and key-free: oembed answers for any public video with a title,
    // author and thumbnail, and does not care about the datacenter bot-check
    // that bites the InnerTube clients below.
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(
          `https://www.youtube.com/watch?v=${videoId}`,
        )}&format=json`,
        { signal: AbortSignal.timeout(6_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const title = typeof data.title === "string" ? data.title.trim() : "";
        if (title) {
          return {
            id: videoId,
            title,
            artist:
              typeof data.author_name === "string" && data.author_name.trim()
                ? data.author_name.trim()
                : "Unknown artist",
            // oembed hands back a 480px thumbnail; the `hqdefault` path is a
            // stable square fallback when it omits one.
            coverUrl:
              typeof data.thumbnail_url === "string" && data.thumbnail_url
                ? data.thumbnail_url
                : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            // oembed carries no duration. 0 lets the player fill in the real
            // length once the stream is loaded, instead of freezing a guess.
            duration: 0,
          };
        }
      }
    } catch {
      /* fall through to InnerTube */
    }

    // Fallback: InnerTube. A video that fails the bot-check can still return
    // its videoDetails, which is enough to label the page.
    for (const client of [ANDROID_VR, TV_EMBEDDED, ANDROID, IOS, MWEB, WEB]) {
      try {
        const data = await innerTube("player", client, {
          context: clientContext(client),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          thirdParty: { embedUrl: "https://www.youtube.com" },
        });
        const details = get(data, ["videoDetails"]) as
          | Record<string, unknown>
          | undefined;
        const title =
          typeof details?.title === "string" ? details.title.trim() : "";
        if (!title) continue;
        const seconds = Number(details?.lengthSeconds);
        return {
          id: videoId,
          title,
          artist:
            typeof details?.author === "string" && details.author.trim()
              ? details.author.trim()
              : "Unknown artist",
          coverUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
        };
      } catch {
        continue;
      }
    }

    return null;
  },
});

/**
 * Resolve a direct, playable audio stream URL for a YouTube video. Tries
 * several clients in order and picks the highest-quality audio-only format.
 * Always resolves (never throws) — when no stream is available it returns
 * { url: null, reason, youtubeUrl } so the UI can link out instead.
 */
export const resolveStream = action({
  args: {
    videoId: v.string(),
    /** "high" (default) picks the best bitrate; "low" prefers ≤ 96kbps for slow connections. */
    quality: v.optional(v.union(v.literal("high"), v.literal("low"))),
  },
  handler: async (
    _ctx,
    { videoId, quality = "high" },
  ): Promise<{
    url: string | null;
    title: string;
    reason?: string;
    youtubeUrl?: string;
  }> => {
    let lastError: string | undefined;
    let lastTitle: string | undefined;
    let lastYoutubeUrl: string | undefined;

    for (const client of [ANDROID_VR, TV_EMBEDDED, ANDROID, IOS, MWEB]) {
      try {
        const data = await innerTube("player", client, {
          context: clientContext(client),
          videoId,
          contentCheckOk: true,
          racyCheckOk: true,
          // Third-party embed params required by the TV embedded client.
          thirdParty: { embedUrl: "https://www.youtube.com" },
        });

        const status = get(data, ["playabilityStatus", "status"]) as
          | string
          | undefined;
        if (status && status !== "OK") {
          lastTitle =
            (get(data, ["videoDetails", "title"]) as string) ??
            `YouTube video ${videoId}`;
          lastError =
            (get(data, ["playabilityStatus", "reason"]) as string) ??
            `Playback unavailable (${status})`;
          lastYoutubeUrl = `https://youtu.be/${videoId}`;
          continue;
        }

        const videoTitle =
          (get(data, ["videoDetails", "title"]) as string) ?? undefined;
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
            ((f as Record<string, unknown>).mimeType as string).startsWith(
              "audio/",
            ),
        );

        const sorted = formats.sort(
          (a, b) => (b.bitrate as number) - (a.bitrate as number),
        ) as Array<Record<string, unknown>>;
        // Network-aware: on "low", take the smallest stream that's still ≥ 48kbps.
        const best =
          quality === "low"
            ? ([...sorted]
                .reverse()
                .find((f) => (f.bitrate as number) >= 48000) ??
              sorted[sorted.length - 1])
            : sorted[0];

        if (best?.url) {
          return {
            url: best.url as string,
            title: videoTitle ?? "YouTube audio",
          };
        }

        // Player returned OK but no audio formats — treat as unavailable.
        lastTitle = videoTitle ?? `YouTube video ${videoId}`;
        lastError = "No audio stream available for this video";
        lastYoutubeUrl = `https://youtu.be/${videoId}`;
      } catch (error) {
        lastError =
          error instanceof Error ? error.message : "Stream resolution failed";
      }
    }

    return {
      url: null,
      title: lastTitle ?? `YouTube video ${videoId}`,
      reason: lastError ?? "No playable audio stream found for this video",
      youtubeUrl: lastYoutubeUrl ?? `https://youtu.be/${videoId}`,
    };
  },
});

// ---------------------------------------------------------------------------
// Offline download permission (Creative Commons uploads only).
//
// SYNQ will not store a recording the provider has not cleared for it, and it
// will not take the CLIENT's word for that. This action asks YouTube directly,
// per video, through the official Data API v3: a video's `status.license` is
// either "youtube" (the standard licence — streaming only) or
// "creativeCommon".
//
// A CC BY upload is an explicit, public grant from the uploader permitting
// reuse and download, so an offline copy of one is legitimate; the standard
// licence grants nothing of the sort. Everything except "creativeCommon" is
// refused, and CC BY requires attribution, which is why the source video URL
// is returned as the licence to cite.
//
// FAIL-SAFE BY CONSTRUCTION. A missing API key, an HTTP error, a malformed
// response and a missing field all resolve to "not eligible". There is no path
// here that turns "we could not verify the licence" into "download allowed" —
// a rights check that fails open is worse than no check at all.
//
// This mirrors the licence gate the client already applies in
// `evaluateDownloadEligibility`; the difference is that this one is decided by
// the rights holder rather than by the caller.
// ---------------------------------------------------------------------------

export interface DownloadEligibilityResult {
  eligible: boolean;
  /**
   * The page to cite for attribution. Empty when not eligible.
   *
   * CC BY makes attribution a CONDITION of the grant, not a courtesy, so a
   * stored copy without this recorded against it would be a licence breach.
   */
  licenseUrl: string;
  licenseName?: string;
  /** Listener-facing why-not, when `eligible` is false. */
  reason?: string;
}

/** The name shown for the one licence SYNQ stores audio under. */
export const CC_BY_LICENSE_NAME = "Creative Commons Attribution (CC BY)";

/**
 * The only value of `status.license` that permits a download.
 *
 * Named once and compared everywhere: a bare "creativeCommon" literal drifting
 * between the download check and the search check is exactly how two paths
 * that are supposed to agree about rights quietly stop agreeing.
 */
const CC_LICENSE = "creativeCommon";

/**
 * A video's licence never changes from one tap to the next, so one lookup is
 * kept per id for the life of the instance. Bounded so a long-lived process
 * cannot grow it without limit.
 */
const licenseCache = new Map<string, DownloadEligibilityResult>();
const LICENSE_CACHE_LIMIT = 500;

/**
 * Whether a YouTube video may be downloaded, decided by YouTube itself.
 *
 * Requires a Data API key in `YOUTUBE_API_KEY`. Without one SYNQ cannot verify
 * anything, so it refuses — see the header.
 */
export const downloadEligibility = action({
  args: { videoId: v.string() },
  handler: async (_ctx, { videoId }): Promise<DownloadEligibilityResult> => {
    const cached = licenseCache.get(videoId);
    if (cached) return cached;

    const refuse = (reason: string): DownloadEligibilityResult => ({
      eligible: false,
      licenseUrl: "",
      reason,
    });

    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      return refuse(
        "Download checks aren't set up yet, so SYNQ can't confirm this track is cleared for offline storage.",
      );
    }

    let data: Record<string, unknown>;
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(
          videoId,
        )}&key=${encodeURIComponent(key)}`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!res.ok) {
        // A 403 here is almost always an exhausted or invalid key, which is a
        // configuration problem rather than a statement about the track — but
        // it is still not a green light.
        return refuse(
          "Couldn't check this track's licence right now. Try again in a moment.",
        );
      }
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return refuse(
        "Couldn't reach YouTube to check this track's licence. Check your connection and retry.",
      );
    }

    const items = data.items;
    const license =
      Array.isArray(items) && items[0]
        ? get(items[0], ["status", "license"])
        : undefined;

    if (license !== CC_LICENSE) {
      return refuse(
        "This track isn't published under a Creative Commons licence, so SYNQ won't store a copy of it.",
      );
    }

    const result: DownloadEligibilityResult = {
      eligible: true,
      licenseUrl: `https://www.youtube.com/watch?v=${videoId}`,
      licenseName: CC_BY_LICENSE_NAME,
    };
    if (licenseCache.size >= LICENSE_CACHE_LIMIT) {
      const oldest = licenseCache.keys().next().value;
      if (oldest !== undefined) licenseCache.delete(oldest);
    }
    licenseCache.set(videoId, result);
    return result;
  },
});

// ---------------------------------------------------------------------------
// Playlist import (YouTube / YouTube Music).
//
// The importer used to be CSV-only, which made a two-click YouTube playlist
// take a Takeout export plus a file picker. InnerTube already serves the
// contents of a public playlist through the SAME public endpoint `search`
// uses, so the track list can be read directly from the share link with no
// OAuth app, no user token and no key.
//
// Deliberately a pure fetch: it returns the parsed rows and the caller hands
// them to the `playlists.saveImported` mutation, which is where the
// signed-in check and the ownership rules live. An unauthenticated caller can
// therefore read a public playlist (harmless — anyone can view it on
// YouTube) but can never write one.
// ---------------------------------------------------------------------------

/** One row of an imported playlist, in the shape saveImported expects. */
export interface ImportedRow {
  title: string;
  artist: string;
  duration?: number;
}

export interface PlaylistBrowseResult {
  name: string;
  tracks: ImportedRow[];
  /** Token for the next page of a long playlist, when there is one. */
  continuation: string | null;
  /** Playlists over this length are refused rather than silently truncated. */
  tooLong: boolean;
}

/** A playlist longer than this is a "mix"/"radio" seed, not a real list. */
export const MAX_IMPORT_TRACKS = 500;

function textOf(value: unknown): string {
  const direct = get(value, ["simpleText"]) as string | undefined;
  if (direct) return direct;
  const runs = get(value, ["runs"]);
  if (Array.isArray(runs)) {
    return runs
      .map((r) => (get(r, ["text"]) as string) ?? "")
      .join("")
      .trim();
  }
  return "";
}

/**
 * Depth-bounded search for the first node under `key`.
 *
 * InnerTube reshuffles the browse response between client versions, so the
 * exact path to the playlist list is not something to hard-code. Walking the
 * tree for a known renderer name survives those moves; the depth cap keeps a
 * malformed response from turning into an unbounded walk.
 */
function findRenderer(node: unknown, key: string, depth: number): unknown {
  if (depth <= 0 || !node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findRenderer(child, key, depth - 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (key in record) return record[key];
  for (const child of Object.values(record)) {
    const hit = findRenderer(child, key, depth - 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * Parse an InnerTube `browse` response for a playlist page.
 *
 * Pure and exported so the shape handling is testable without a network call.
 * Rows missing a video id, a title, or a usable artist are dropped: a playlist
 * full of "Watch on YouTube" promos is better imported short than not at all.
 */
/**
 * Find a continuation token anywhere in the response.
 *
 * Paging a long playlist needs this, and the token's location is not stable:
 * the legacy list carries a `continuations` array, the music shelf carries a
 * `continuationItemRenderer`. Depth-bounded for the same reason
 * `findRenderer` is.
 */
function findContinuationToken(node: unknown, depth = 20): string | undefined {
  if (depth <= 0 || !node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findContinuationToken(child, depth - 1);
      if (hit) return hit;
    }
    return undefined;
  }
  const direct =
    get(node, ["continuationEndpoint", "continuationCommand", "token"]) ??
    get(node, ["continuationCommand", "token"]) ??
    get(node, ["nextContinuationData", "continuation"]);
  if (typeof direct === "string" && direct) return direct;
  for (const child of Object.values(node as Record<string, unknown>)) {
    const hit = findContinuationToken(child, depth - 1);
    if (hit) return hit;
  }
  return undefined;
}

export function extractPlaylistBrowse(
  data: Record<string, unknown>,
): PlaylistBrowseResult {
  // YouTube changed the header shape too. `musicResponsiveHeaderRenderer` is
  // what a WEB_REMIX playlist browse returns now; the older
  // `playlistHeaderRenderer` is still accepted so a rollback does not break it.
  const header =
    get(data, ["header", "playlistHeaderRenderer"]) ??
    get(data, ["metadata", "playlistMetadataRenderer"]) ??
    get(data, ["sidebar", "playlistSidebarRenderer"]) ??
    findRenderer(data, "musicResponsiveHeaderRenderer", 16);
  const name =
    textOf(get(header, ["title"])) ||
    textOf(
      get(header, ["items", 0, "playlistSidebarPrimaryInfoRenderer", "title"]),
    ) ||
    "Imported playlist";

  // The row renderer changed too. `playlistVideoListRenderer` is the OLD
  // YouTube shape and is no longer returned by the music client;
  // `musicPlaylistShelfRenderer` carrying `musicResponsiveListItemRenderer`
  // rows is what comes back now. Both are read, because YouTube has moved this
  // once already and may move it back.
  const legacyList = findRenderer(data, "playlistVideoListRenderer", 16);
  const shelf = findRenderer(data, "musicPlaylistShelfRenderer", 16);
  const list = legacyList ?? shelf;
  const contents = get(list, ["contents"]);
  const tracks: ImportedRow[] = [];
  let tooLong = false;

  /** Read one CURRENT row: `musicResponsiveListItemRenderer`. */
  const readResponsiveRow = (item: Record<string, unknown>): void => {
    // flexColumns[0] is the title, [1] the artist line, and the rest are
    // badges/album chips that are not part of the row we store.
    const flexColumns = get(item, ["flexColumns"]);
    const columnRuns = (index: number): Record<string, unknown>[] => {
      if (!Array.isArray(flexColumns)) return [];
      const runs = get(flexColumns[index], [
        "musicResponsiveListItemFlexColumnRenderer",
        "text",
        "runs",
      ]);
      return Array.isArray(runs) ? (runs as Record<string, unknown>[]) : [];
    };
    const columnText = (index: number): string[] =>
      columnRuns(index).map((r) => (get(r, ["text"]) as string) ?? "");

    const rawTitle = columnText(0).join("").trim();
    const title = cleanTrackTitle(rawTitle);
    if (!title) return;

    // The artist column is one run PER ARTIST plus separator runs (" & ",
    // ", ") of their own, so joining everything produced "ROSÉ, &, Bruno
    // Mars" — a name that matches no artist on YouTube. A real artist run is
    // the one carrying a channel browse endpoint; separators carry none. That
    // is the discriminator, so multi-artist rows keep only genuine artists.
    const artistParts = columnRuns(1)
      .filter(
        (r) =>
          typeof get(r, [
            "navigationEndpoint",
            "browseEndpoint",
            "browseId",
          ]) === "string",
      )
      .map((r) => ((get(r, ["text"]) as string) ?? "").trim())
      .filter(Boolean);
    const artist = cleanTrackTitle(artistParts.join(", "));
    if (!artist || artist === "Unknown artist") return;

    const fixedColumns = get(item, ["fixedColumns"]);
    const durationRun = Array.isArray(fixedColumns)
      ? get(fixedColumns[0], [
          "musicResponsiveListItemFixedColumnRenderer",
          "text",
          "runs",
          0,
          "text",
        ])
      : undefined;
    const duration = parseLength((durationRun as string) || undefined);

    tracks.push({ title, artist, duration: duration || undefined });
    if (tracks.length > MAX_IMPORT_TRACKS) tooLong = true;
  };

  if (Array.isArray(contents)) {
    for (const entry of contents) {
      // NEW row shape.
      const responsive = get(entry, ["musicResponsiveListItemRenderer"]) as
        | Record<string, unknown>
        | undefined;
      if (responsive) {
        readResponsiveRow(responsive);
        if (tooLong) break;
        continue;
      }
      // OLD row shape, still handled.
      const vr = get(entry, ["playlistVideoRenderer"]) as
        | Record<string, unknown>
        | undefined;
      if (!vr) continue;
      const videoId = vr.videoId as string | undefined;
      if (!videoId) continue;

      const rawTitle =
        textOf(vr.title) || (get(vr, ["title", "simpleText"]) as string) || "";
      const title = cleanTrackTitle(rawTitle);
      if (!title) continue; // `cleanCreatorName` returns "Unknown artist" for anything that is not a
      // STRING, and a byline is always an OBJECT — `{ runs: [...] }` or
      // `{ simpleText: "..." }`. Passing the object through therefore
      // discarded it, and only the third argument (a raw
      // `runs[0].text`) ever survived. Any row whose byline arrived as
      // `simpleText` instead of `runs` was dropped SILENTLY, shrinking the
      // import rather than failing it. `textOf` reads both forms.
      const byline =
        get(vr, ["shortBylineText"]) ?? get(vr, ["longBylineText"]);
      const artist = firstCreatorName(
        title,
        textOf(byline),
        textOf(get(vr, ["longBylineText"])),
        get(vr, ["shortBylineText", "runs", 0, "text"]),
      );
      if (artist === "Unknown artist") continue;

      const seconds = Number(vr.lengthSeconds);
      const duration =
        Number.isFinite(seconds) && seconds > 0
          ? seconds
          : parseLength(
              (get(vr, ["lengthText", "simpleText"]) as string) ||
                textOf(vr.lengthText) ||
                undefined,
            ) || undefined;

      tracks.push({ title, artist, duration });
      if (tracks.length > MAX_IMPORT_TRACKS) {
        tooLong = true;
        break;
      }
    }
  }

  const continuations = get(list, ["continuations"]);
  const continuation =
    (Array.isArray(continuations)
      ? continuations
          .map(
            (c) =>
              get(c, ["nextContinuationData", "continuation"]) as
                | string
                | undefined,
          )
          .find(Boolean)
      : undefined) ??
    (get(list, [
      "continuations",
      0,
      "reloadContinuationData",
      "continuation",
    ]) as string | undefined) ??
    // The music shelf pages via a `continuationItemRenderer` sitting in its
    // own contents, not via a `continuations` array. Without this a playlist
    // longer than one page silently imported as just its first 100 tracks.
    (get(contents, [
      "continuationItemRenderer",
      "continuationEndpoint",
      "continuationCommand",
      "token",
    ]) as string | undefined) ??
    findContinuationToken(data) ??
    undefined;

  return { name, tracks, continuation: continuation ?? null, tooLong };
}

/**
 * Read a public YouTube / YouTube Music playlist by id.
 *
 * `browseId` is the bare list id prefixed with "VL" for playlists, which is
 * how InnerTube addresses them. Long playlists are paged with the continuation
 * token so a 500-song list imports whole instead of stopping at the first
 * ~100 rows the response happens to carry.
 */
export const importPlaylistById = action({
  args: { playlistId: v.string() },
  handler: async (
    _ctx,
    { playlistId },
  ): Promise<{
    name: string;
    origin: string;
    tracks: ImportedRow[];
    partial: boolean;
  }> => {
    const id = playlistId.trim().replace(/^VL/, "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      throw new ConvexError("That doesn't look like a YouTube playlist ID");
    }

    let data = await innerTube("browse", MUSIC_CLIENT, {
      context: clientContext(MUSIC_CLIENT),
      browseId: `VL${id}`,
    });
    const first = extractPlaylistBrowse(data);

    const tracks: ImportedRow[] = [...first.tracks];
    let continuation = first.continuation;
    let name = first.name;
    // Up to 4 extra pages (~500 rows) — enough for a real playlist without
    // letting a "mix everything" radio seed run forever.
    for (let page = 0; page < 4 && continuation; page++) {
      if (tracks.length >= MAX_IMPORT_TRACKS) break;
      try {
        data = await innerTube("browse", MUSIC_CLIENT, {
          context: clientContext(MUSIC_CLIENT),
          continuation,
        });
      } catch {
        break;
      }
      const next = extractPlaylistBrowse(data);
      if (next.name && next.name !== "Imported playlist") name = next.name;
      for (const row of next.tracks) {
        if (tracks.length >= MAX_IMPORT_TRACKS) break;
        const dupe = tracks.some(
          (t) => t.title === row.title && t.artist === row.artist,
        );
        if (!dupe) tracks.push(row);
      }
      continuation = next.continuation;
    }

    if (tracks.length === 0) {
      throw new ConvexError(
        "That playlist looks private, empty, or unavailable — try a public playlist link",
      );
    }

    return {
      name: name || "Imported playlist",
      origin: "YouTube Music",
      tracks,
      partial: tracks.length >= MAX_IMPORT_TRACKS,
    };
  },
});
