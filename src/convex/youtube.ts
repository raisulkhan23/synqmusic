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
    .replace(/(?:\(|\[)(?:official|topic|audio|video|lyrics?|visualizer|hd|hq)[^\])]*(?:\)|\])/gi, "")
    .replace(/\s+(?:topic|vevo)$/i, "")
    .trim();
  if (!name || CREATOR_NAME_PLACEHOLDER_RE.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
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
      if (CREATOR_NAME_PLACEHOLDER_RE.test(candidate) || !/[\p{L}\p{N}]/u.test(candidate)) continue;
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
  for (const pattern of suffixPatterns) title = title.replace(pattern, "").trim();
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
        (get(vr, ["title", "runs", 0, "text"]) as string) ??
        (get(vr, ["title", "simpleText"]) as string) ??
        "Untitled";
      const artist = firstCreatorName(
        title,
        get(vr, ["ownerText", "runs", 0, "text"]),
        get(vr, ["longBylineText", "runs", 0, "text"]),
      );
      const lengthText = get(vr, ["lengthText", "simpleText"]) as string | undefined;
      const thumbs = get(vr, ["thumbnail", "thumbnails"]);
      const thumbnail = Array.isArray(thumbs)
        ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
        : "";

      out.push({ id: videoId, title: cleanTrackTitle(title), artist, duration: parseLength(lengthText), thumbnail });
      if (out.length >= 10) return out;
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
  if (!res.ok) throw new ConvexError(`YouTube Music API returned ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return extractMusicResults(data);
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
  if (item.duration > 0 && (item.duration < 30 || item.duration > 900)) return false;
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
  return terms.length <= 6 ? matches === terms.length : matches >= Math.ceil(terms.length * 0.7);
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
  return item.duration >= 30 && item.duration <= 900 &&
    MUSIC_VIDEO_MARKER_RE.test(`${item.title} ${item.artist}`);
}

const DISCOVERY_QUERY_RE =
  /\b(songs?|music|hits|mix|playlist|chill|happy|sad|energetic|focus|workout|party|sleep|romantic|nostalgic|pop|rock|jazz|classical|ambient|funk|metal|country|reggaeton|afrobeats|k[\s-]?pop|indie|electronic|lo-fi|r\s*(?:&|and)\s*b|hip-hop)\b/i;

const DISCOVERY_SEEDS: Array<[RegExp, string[]]> = [
  [/\bk[\s-]?pop\b/i, ["BLACKPINK songs", "TWICE songs", "Stray Kids songs"]],
  [/\bpop\b/i, ["Taylor Swift songs", "Dua Lipa songs", "Olivia Rodrigo songs"]],
  [/\bhip[\s-]?hop\b/i, ["Kendrick Lamar songs", "Drake songs", "Nicki Minaj songs"]],
  [/\brock\b/i, ["Foo Fighters songs", "Queen songs", "Nirvana songs"]],
  [/\br\s*(?:&|and)\s*b\b/i, ["SZA songs", "The Weeknd songs", "Daniel Caesar songs"]],
  [/\belectronic\b/i, ["Daft Punk songs", "Justice songs", "Disclosure songs"]],
  [/\bindie\b/i, ["Phoebe Bridgers songs", "Tame Impala songs", "Arctic Monkeys songs"]],
  [/\bjazz\b/i, ["Miles Davis songs", "Ella Fitzgerald songs", "Kamasi Washington songs"]],
  [/\bclassical\b/i, ["Ludwig van Beethoven songs", "Mozart songs", "Chopin songs"]],
  [/\blo[\s-]?fi\b/i, ["Lofi Girl songs", "KSW songs", "Lofi beats songs"]],
  [/\bmetal\b/i, ["Metallica songs", "Slipknot songs", "Iron Maiden songs"]],
  [/\bcountry\b/i, ["Morgan Wallen songs", "Luke Combs songs", "Maren Morris songs"]],
  [/\breggaeton\b/i, ["Bad Bunny songs", "Karol G songs", "J Balvin songs"]],
  [/\bafrobeats\b/i, ["Burna Boy songs", "Wizkid songs", "Tems songs"]],
  [/\bambient\b/i, ["Brian Eno songs", "Max Richter songs", "Marconi Union songs"]],
  [/\bfunk\b/i, ["Jamiroquai songs", "Vulfpeck songs", "The Meters songs"]],
  [/\bchill\b/i, ["Frank Ocean songs", "Daniel Caesar songs", "Khruangbin songs"]],
  [/\bhappy\b/i, ["Pharrell Williams songs", "Olivia Rodrigo songs", "Dua Lipa songs"]],
  [/\bsad\b/i, ["Billie Eilish songs", "Lana Del Rey songs", "The National songs"]],
  [/\benergetic\b/i, ["Imagine Dragons songs", "The Killers songs", "Arctic Monkeys songs"]],
  [/\bfocus\b/i, ["Ludovico Einaudi songs", "Max Richter songs", "Ólafur Arnalds songs"]],
  [/\bworkout\b/i, ["Kendrick Lamar songs", "Drake songs", "Doja Cat songs"]],
  [/\bparty\b/i, ["Dua Lipa songs", "Doja Cat songs", "Kylie Minogue songs"]],
  [/\bsleep\b/i, ["Norah Jones songs", "Billie Eilish songs", "Bon Iver songs"]],
  [/\bromantic\b/i, ["Adele songs", "The Weeknd songs", "SZA songs"]],
  [/\bnostalgic\b/i, ["Fleetwood Mac songs", "The Weeknd songs", "Tame Impala songs"]],
];

function discoverySeedQueries(query: string): string[] {
  return [...new Set(DISCOVERY_SEEDS
    .filter(([pattern]) => pattern.test(query))
    .flatMap(([, categorySeeds]) => categorySeeds))];
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
  if (!isMusicTrack(item) || item.duration < 30 || item.duration > 900) return false;
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

  const sections = get(data, ["contents", "tabbedSearchResultsRenderer", "tabs", 0, "tabRenderer", "content", "sectionListRenderer", "contents"]);
  const flat = Array.isArray(sections)
    ? sections
    : get(data, ["contents", "sectionListRenderer", "contents"]);
  if (!Array.isArray(flat)) return out;

  for (const section of flat) {
    // Legacy shape: a dedicated songs shelf.
    const shelf = get(section, ["musicShelfRenderer", "contents"]);
    if (Array.isArray(shelf)) {
      for (const item of shelf) {
        const renderer = get(item, ["musicResponsiveListItemRenderer"]) as Record<string, unknown> | undefined;
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
        const renderer = get(item, ["musicResponsiveListItemRenderer"]) as Record<string, unknown> | undefined;
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
export function parseMusicListItem(renderer: Record<string, unknown>): (YtItem & { kind: "song" | "other" }) | null {
  const videoId =
    (get(renderer, ["playlistItemData", "videoId"]) as string | undefined) ??
    (get(renderer, ["overlay", "musicItemThumbnailOverlayRenderer", "content", "musicPlayButtonRenderer", "playNavigationEndpoint", "watchEndpoint", "videoId"]) as string | undefined) ??
    (get(renderer, ["navigationEndpoint", "watchEndpoint", "videoId"]) as string | undefined);
  if (!videoId) return null;

  const flex = get(renderer, ["flexColumns"]);
  if (!Array.isArray(flex)) return null;
  const runsOf = (col: unknown) =>
    (get(col, ["musicResponsiveListItemFlexColumnRenderer", "text", "runs"]) as Array<{ text?: string }> | undefined) ?? [];
  const textOf = (col: unknown) => runsOf(col)[0]?.text ?? "";
  const title = cleanTrackTitle(textOf(flex[0]) || "Untitled");
  // Column 1 interleaves metadata and separator runs. Depending on the
  // response shape it can be [artist, " • ", album, " • ", duration] or
  // [type, " • ", artist, " • ", duration], so separators must never be
  // mistaken for the artist.
  const runs = (get(flex[1], ["musicResponsiveListItemFlexColumnRenderer", "text", "runs"]) as Array<{ text?: string }> | undefined) ?? [];
  const metaRuns = runs
    .map((run) => run.text?.trim() ?? "")
    .filter((value) => value && !/^[•·,&]+$/.test(value));
  const typePattern = /^(song|video|playlist|album|artist|episode|short|music video|live performance|single|ep)$/i;
  const typeIndex = metaRuns.findIndex((value) => typePattern.test(value));
  const artistIndex = typeIndex >= 0 ? typeIndex + 1 : 0;
  const typeRun = typeIndex >= 0 ? metaRuns[typeIndex] : "";
  // The Songs shelf often omits the explicit "Song" metadata run and returns
  // only [artist, album, duration]. Those rows are still single playable
  // tracks, so only reject rows when YouTube explicitly identifies them as a
  // playlist/album/artist/episode. Treating an omitted type as "other" made
  // valid category results disappear before they reached the player.
  const kind: "song" | "other" =
    /^(playlist|album|artist|episode)$/i.test(typeRun) ? "other" : "song";
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

  const thumbs = get(renderer, ["thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails"]);
  const thumbnail = Array.isArray(thumbs)
    ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
    : "";

  return {
    id: videoId,
    title,
    artist,
    duration: parseLength(durationRaw),
    thumbnail,
    kind,
  };
}

/** The musicCardShelfRenderer "Top result" card → YtItem (song only). */
function parseMusicCardShelf(card: Record<string, unknown>): YtItem | null {
  const videoId =
    (get(card, ["onTap", "watchEndpoint", "videoId"]) as string | undefined) ??
    (get(card, ["buttons", 0, "buttonRenderer", "command", "watchEndpoint", "videoId"]) as string | undefined);
  if (!videoId) return null;

  const title = cleanTrackTitle(
    (get(card, ["title", "runs", 0, "text"]) as string | undefined) ??
    (get(card, ["header", "musicCardShelfHeaderBasicRenderer", "title", "runs", 0, "text"]) as string | undefined) ??
    "Top result",
  );
  // Subtitle runs pack artist • song • year.
  const subtitle = (get(card, ["subtitle", "runs"]) as Array<{ text?: string }> | undefined) ?? [];
  const parts = subtitle.map((r) => r.text ?? "").join("").split("•").map((s) => s.trim());
  const artist = firstCreatorName(title, parts[0], parts[1]);
  const durationText =
    (get(card, ["lengthText", "simpleText"]) as string | undefined) ??
    parts.find((part) => /^\d{1,2}:\d{2}(?::\d{2})?$/.test(part)) ??
    "";

  const thumbs = get(card, ["thumbnail", "musicThumbnailRenderer", "thumbnail", "thumbnails"]);
  const thumbnail = Array.isArray(thumbs)
    ? ((thumbs[thumbs.length - 1] as { url?: string })?.url ?? "")
    : "";

  return { id: videoId, title, artist, duration: parseLength(durationText), thumbnail };
}

/**
 * Search YouTube for music. Uses the YouTube Music endpoint so ONLY music
 * tracks are ever returned — no podcasts, vlogs, mixes, or other videos.
 */
export const searchYoutube = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<{ items: YtItem[] }> => {
    if (!query.trim()) return { items: [] };

    // Category/mood searches are discovery requests, not literal title
    // searches. Prefer concrete artist-backed seeds BEFORE the broad shelf
    // response: YouTube Music often answers "K-pop songs" with soundtrack or
    // animation tracks even though it has plenty of actual K-pop songs.
    if (DISCOVERY_QUERY_RE.test(query)) {
      const seeded: YtItem[] = [];
      for (const seedQuery of discoverySeedQueries(query)) {
        try {
          const items = await musicSearch(seedQuery);
          if (items.length > 0) seeded.push(...items);
        } catch {
          // Try the next artist-backed seed.
        }
      }
      const combined = dedupeMusicItems(seeded).slice(0, 10);
      if (combined.length > 0) return { items: combined };
    }

    // Preferred: YouTube Music — returns real studio tracks (Songs shelf),
    // never random YouTube videos.
    try {
      const items = await musicSearch(query);
      if (items.length > 0) return { items };
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
        extractSearchResults(data).filter((item) => isPrimaryMusicResult(item, query)),
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
export const searchLyricVideos = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }): Promise<{ items: YtItem[] }> => {
    const rawQuery = query.trim();
    if (!rawQuery) return { items: [] };

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
        extractSearchResults(data).filter((item) => isLyricVideoTrack(item, rawQuery)),
      );
      return { items: items.slice(0, 8) };
    } catch {
      return { items: [] };
    }
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
    quality: v.optional(v.union(v.literal("high"), v.literal("low")))
  },
  handler: async (_ctx, { videoId, quality = "high" }): Promise<{ url: string | null; title: string; reason?: string; youtubeUrl?: string }> => {
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

        const status = get(data, ["playabilityStatus", "status"]) as string | undefined;
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

        const sorted = formats.sort(
          (a, b) => (b.bitrate as number) - (a.bitrate as number),
        ) as Array<Record<string, unknown>>;
        // Network-aware: on "low", take the smallest stream that's still ≥ 48kbps.
        const best =
          quality === "low"
            ? [...sorted].reverse().find((f) => (f.bitrate as number) >= 48000) ?? sorted[sorted.length - 1]
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
