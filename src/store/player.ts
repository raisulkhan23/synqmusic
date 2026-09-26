import { create } from "zustand";
import {
  getAudio,
  setAudioFilter,
  setEqBass as setEqBassLib,
  setEqTreble as setEqTrebleLib,
  setEqBalance as setEqBalanceLib,
  setEqMono as setEqMonoLib,
  ensureGraph,
  hasAudioProcessing,
  getSignalLevel,
  resumeGraph,
  onEqChange,
  AUDIO_FILTERS,
  type AudioFilterId,
} from "@/lib/audio";
import type { RGB } from "@/lib/covers";
import {
  applyCardTransparency,
  CARD_TRANSPARENCY_KEY,
  readCardTransparency,
} from "@/lib/cardTransparency";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import * as ytEngine from "@/lib/youtubePlayer";
import { cacheStream, cleanArtistName, cleanTrackTitle, getCachedStream, type YtItem } from "@/lib/youtube";
import { api } from "@/convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { toast } from "sonner";
import { track as trackEvent } from "@/lib/analytics";

/**
 * Resolve a direct audio stream URL for a YouTube video via the Convex
 * backend (vanilla client — usable outside React). Used only when an audio
 * effect needs the stream on the <audio> element.
 *
 * The URL is routed through our CORS proxy (/audio-proxy on the Convex
 * site): stream hosts send no CORS headers, so without the proxy the
 * <audio crossOrigin="anonymous"> element can't load them and every effect
 * silently becomes a no-op. Returns null on failure.
 */
let ytResolveClient: ConvexClient | null = null;
let ytSearchClient: ConvexClient | null = null;
const convexSiteUrl = ((import.meta.env.VITE_CONVEX_URL as string) ?? "").replace(".cloud", ".site");
const audioProxyBase = `${convexSiteUrl}/audio-proxy`;
const resolveYoutubeStream = async (videoId: string): Promise<string | null> => {
  // EQ-only playback uses the same resolver as preset effects. Start the
  // already-warm YouTube IFrame immediately so the user hears the dry track
  // while the direct stream is being resolved, then swap to Web Audio only
  // after that stream is ready. Initial track loads already start this path
  // in loadTrack, so the current-track guard avoids a duplicate load there.
  if (hasAudioProcessing() && usePlayerStore.getState().current?.youtubeId === videoId) {
    const state = usePlayerStore.getState();
    void ytEngine
      .play(videoId, {
        volume: state.volume,
        muted: state.muted,
        startSeconds: state.currentTime || undefined,
      })
      .catch(() => undefined);
  }
  // 1) Browser-side InnerTube resolution. Runs from the USER's IP, which is
  //    NOT subject to YouTube's datacenter bot-check (cloud functions get
  //    "Sign in to confirm you're not a bot" for most videos, which is what
  //    made every effect report "Effect unavailable"). The returned
  //    googlevideo URL then goes through our CORS proxy so the <audio>
  //    element (and therefore the EQ chain) can load it.
  try {
    const clients = [
      { name: "ANDROID_VR", id: "28", version: "1.60.19", ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; eureka-user Build/SQ3A.220605.009.A1) gzip", extra: { androidSdkVersion: 31, osName: "Android", osVersion: "12" } },
      { name: "TVHTML5", id: "7", version: "7.20240801.18.00", ua: "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15", extra: {} },
    ];
    for (const c of clients) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(`https://www.youtube.com/youtubei/v1/player?prettyPrint=false`, {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "User-Agent": c.ua,
            "X-Youtube-Client-Name": c.id,
            "X-Youtube-Client-Version": c.version,
            Origin: "https://www.youtube.com",
          },
          body: JSON.stringify({
            context: { client: { hl: "en", gl: "US", clientName: c.name, clientVersion: c.version, ...c.extra } },
            videoId,
            contentCheckOk: true,
            racyCheckOk: true,
            thirdParty: { embedUrl: "https://www.youtube.com" },
          }),
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          playabilityStatus?: { status?: string };
          streamingData?: {
            adaptiveFormats?: Record<string, unknown>[];
            formats?: Record<string, unknown>[];
          };
        };
        if (data.playabilityStatus?.status && data.playabilityStatus.status !== "OK") continue;
        const formats = [
          ...(data.streamingData?.adaptiveFormats ?? []),
          ...(data.streamingData?.formats ?? []),
        ];
        const audio = formats
          .filter(
            (f) =>
              typeof f.url === "string" &&
              typeof f.mimeType === "string" &&
              f.mimeType.startsWith("audio/"),
          )
          .sort((a, b) => (b.bitrate as number) - (a.bitrate as number));
        const best = audio[0];
        if (typeof best?.url === "string") {
          return `${audioProxyBase}?u=${encodeURIComponent(best.url)}`;
        }
      } catch {
        continue;
      }
    }
  } catch {
    /* fall through to the other resolvers */
  }
  // 2) Server-side InnerTube resolution as a backup (may be bot-blocked, but
  //    occasionally the cloud IP isn't).
  try {
    ytResolveClient = ytResolveClient ?? new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    // Network-aware quality: prefer a lighter stream when the connection is poor.
    type NetInfo = { effectiveType?: string };
    const net = (navigator as Navigator & { connection?: NetInfo }).connection;
    const slow = net?.effectiveType === "2g" || net?.effectiveType === "slow-2g" || net?.effectiveType === "3g";
    const res = await ytResolveClient.action(api.youtube.resolveStream, { videoId, quality: slow ? "low" : "high" });
    if (res?.url) return `${audioProxyBase}?u=${encodeURIComponent(res.url)}`;
  } catch {
    /* fall through to browser-side resolution */
  }
  // 2) Browser-side fallback via public Piped instances. These run CORS
  //    headers directly and resolve from the USER's IP (never bot-blocked),
  //    so the Web Audio effect chain always gets a stream to process.
  try {
    const instances = [
      "https://api.piped.private.coffee",
      "https://pipedapi.ducks.party",
    ];
    for (const base of instances) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(`${base}/streams/${videoId}`, { signal: ctrl.signal });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          audioStreams?: { url: string; bitrate?: number; mimeType?: string }[];
          videoStreams?: { url: string; quality?: string; videoOnly?: boolean; mimeType?: string }[];
        };
        // Preferred: dedicated audio-only streams (best quality).
        const audioStreams = (data.audioStreams ?? [])
          .filter((s) => !!s.url && (!s.mimeType || s.mimeType.includes("audio")))
          .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
        if (audioStreams[0]?.url) return audioStreams[0].url;
        // Fallback: ANY muxed (video+audio) stream, not just exact "360p".
        // Piped now strips audio-only formats for many videos (verified live:
        // audioStreams comes back EMPTY), so muxed is often the only source.
        // Web Audio decodes its audio track fine, and Piped's proxy serves
        // CORS headers. Sort by lowest resolution — we only need the audio.
        const muxed = (data.videoStreams ?? [])
          .filter(
            (s) =>
              !!s.url &&
              s.videoOnly === false &&
              (!s.mimeType || s.mimeType.includes("mp4") || s.mimeType.includes("webm")),
          )
          .sort((a, b) => (parseInt(a.quality ?? "0", 10) || 9999) - (parseInt(b.quality ?? "0", 10) || 9999));
        if (muxed[0]?.url) return muxed[0].url;
      } catch {
        continue;
      }
    }
  } catch {
    /* nothing else to try */
  }
  return null;
};

const ytResolveCache = new Map<string, Promise<string | null>>();

/** Resolve once per track, then reuse the stream while EQ/effects are adjusted. */
const ytResolve = (videoId: string): Promise<string | null> => {
  const cached = getCachedStream(videoId);
  if (cached) return Promise.resolve(cached);
  const existing = ytResolveCache.get(videoId);
  if (existing) return existing;

  const pending = resolveYoutubeStream(videoId).then((url) => {
    if (url) cacheStream(videoId, url);
    else ytResolveCache.delete(videoId);
    return url;
  });
  ytResolveCache.set(videoId, pending);
  return pending;
};

/** Start EQ stream resolution before the user changes a slider. */
export function prewarmYoutubeStream(videoId: string): void {
  void ytResolve(videoId);
}

export type RepeatMode = "off" | "all" | "one";

let likeMutation: LikeMutation | null = null;

export interface RemoteLikeSnapshot {
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
  youtubeId?: string;
  source: string;
}

export interface LikeMutation {
  (trackId: string, remote?: RemoteLikeSnapshot): Promise<boolean>;
}

/** Fire-and-forget recorder for catalog plays (wired to Convex in AppShell). */
let historyRecorder: ((trackId: string) => void) | null = null;

interface PlayerStore {
  // playback
  queue: Playable[];
  queueIndex: number;
  /** Queue order saved when shuffle was enabled, so it can be restored. */
  unshuffledQueue: Playable[] | null;
  unshuffledIndex: number;
  current: Playable | null;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  errorNonce: number;

  // preferences
  volume: number;
  muted: boolean;
  shuffle: boolean;
  /** Smart shuffle avoids replaying recently heard tracks. */
  smartShuffle: boolean;
  repeat: RepeatMode;
  /** Playback speed 0.5–2. */
  rate: number;
  /** Active audio effect filter (8D, bass boost, …) — catalog playback. */
  audioFilter: AudioFilterId;

  // sleep timer
  /** Epoch ms when playback will pause; null when off. */
  sleepEndsAt: number | null;
  /** Stop after the current song finishes. */
  sleepAtSongEnd: boolean;

  // A-B repeat (seconds within current track; null = unset)
  abA: number | null;
  abB: number | null;

  // interface
  queueOpen: boolean;
  fullscreen: boolean;
  accent: RGB | null;

  // appearance preferences (persisted locally)
  /** Accent theme: "auto" follows album art, or a fixed color id. */
  accentTheme: string;
  /** Fixed accent colors offered in Settings. */
  setAccentTheme: (id: string) => void;
  /** UI density: comfortable (default) or compact. */
  compactMode: boolean;
  toggleCompactMode: () => void;
  /** Ambient background glow on/off. */
  ambientGlow: boolean;
  toggleAmbientGlow: () => void;
  /** Visualizer animation on/off. */
  visualizerEnabled: boolean;
  toggleVisualizer: () => void;
  /** Pointer-following ambient glow, enabled by default. */
  pointerEffects: boolean;
  togglePointerEffects: () => void;
  /** UI theme: "dark" (default) | "light" | "amoled" */
  themeMode: string;
  setThemeMode: (mode: string) => void;
  /** hide tracks flagged explicit */
  hideExplicit: boolean;
  toggleHideExplicit: () => void;
  /** Liquid glass UI effect (frosted refraction panels) */
  liquidGlass: boolean;
  toggleLiquidGlass: () => void;
  /**
   * Performance mode: drops every decoration that costs frames on a weaker
   * machine (animated glass sheen, backdrop blurs, the aurora orbs, the
   * ambient grid, click ripples and the pointer glow/trail). Playback, the
   * queue and the player are untouched — it is purely a rendering budget.
   */
  performanceMode: boolean;
  togglePerformanceMode: () => void;
  /** 0 = solid panels, 80 = maximum see-through. */
  cardTransparency: number;
  setCardTransparency: (value: number) => void;
  /** Optional locally-persisted blurred background wallpaper. */
  wallpaper: string | null;
  wallpaperType: "image" | "video";
  setWallpaper: (value: string | null, type?: "image" | "video") => void;
  setWallpaperType: (type: "image" | "video") => void;
  /** Hide the account email in the sidebar corner. */
  hideSidebarEmail: boolean;
  /** Spotify-style collapsed sidebar (icon rail). */
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  toggleHideSidebarEmail: () => void;

  // queue history (previously played, most recent first)
  history: Playable[];
  /** When the queue runs dry, automatically continue with similar music. */
  autoplay: boolean;
  toggleAutoplay: () => void;

  /** Show the actual video in the fullscreen player (YouTube sources). */
  videoEnabled: boolean;
  toggleVideo: () => void;

  // liked songs (synced with Convex, optimistic)
  liked: Record<string, number>;
  likedLoaded: boolean;

  // liked albums + followed artists (local, persisted)
  likedAlbums: Record<string, true>;
  followedArtists: Record<string, true>;
  toggleLikedAlbum: (albumId: string) => void;
  toggleFollowArtist: (artistId: string) => void;

  // actions
  playTrack: (track: Playable, list?: (Playable)[]) => void;
  /** Start an endless related-mix radio from any track (any source). */
  startRadio: (track: Playable, contextQuery?: string) => void;
  /** Play a YouTube track through the proxy/audio path (rescues non-embeddable videos). */
  playViaStream: (track: Playable, startSeconds?: number) => void;
  playIndex: (index: number) => void;
  replaceCurrentStream: (playable: Playable, startSeconds?: number) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  toggleSmartShuffle: () => void;
  cycleRepeat: () => void;
  setRate: (rate: number) => void;
  setAudioFilter: (id: AudioFilterId) => void;
  /** minutes, "end" (after current song) or null to cancel */
  setSleepTimer: (mode: number | "end" | null) => void;
  setAbPoint: (which: "a" | "b", seconds: number | null) => void;
  clearAb: () => void;
  setQueueOpen: (open: boolean) => void;
  setFullscreen: (open: boolean) => void;
  setAccent: (accent: RGB | null) => void;
  removeFromQueue: (index: number) => void;
  undoRemoveFromQueue: () => void;
  insertInQueue: (track: Playable, index: number) => void;
  addToQueue: (track: Playable) => void;
  /** Append songs similar to the given seed (genre/artist-based) to the queue. */
  extendQueueWithSimilar: (seed?: Playable) => void;
  playFromHistory: (index: number) => void;
  replaceUpcoming: (upcoming: Playable[]) => void;
  /** Reorder only the not-yet-played tail, keeping history and queueIndex. */
  reorderUpcoming: (upcoming: Playable[]) => void;
  clearQueue: () => void;
  setHistoryRecorder: (fn: ((trackId: string) => void) | null) => void;

  setLiked: (liked: Record<string, number>) => void;
  setLikeMutation: (fn: LikeMutation | null) => void;
  toggleLike: (trackId: string, remote?: RemoteLikeSnapshot) => void;
}

// --- queue persistence (survives refresh) -----------------------------------

interface PersistedPlayable {
  id: string;
  youtubeId?: string;
  title?: string;
  artistName?: string;
  coverUrl?: string;
  duration?: number;
}

const QUEUE_KEY = "ss.queue";

/** Shrink a Playable to its storable essence. */
const persistPlayable = (p: Playable): PersistedPlayable => ({
  id: p.id,
  youtubeId: p.youtubeId,
  title: p.title,
  artistName: p.artistName,
  coverUrl: p.coverUrl,
  duration: p.duration,
});

function saveQueue(queue: Playable[], queueIndex: number, currentId: string | null): void {
  try {
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify({
        items: queue.slice(0, 60).map(persistPlayable),
        queueIndex,
        currentId,
      }),
    );
  } catch {
    /* storage full / unavailable */
  }
}

function readSavedQueue(): { items: Playable[]; queueIndex: number } | null {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      items: PersistedPlayable[];
      queueIndex: number;
    };
    const items: Playable[] = [];
    for (const p of parsed.items ?? []) {
      if (p.youtubeId && p.title) {
        items.push({
          id: p.id,
          source: "youtube",
          youtubeId: p.youtubeId,
          title: p.title,
          artistName: cleanArtistName(p.artistName, p.title),
          albumName: "",
          coverUrl: p.coverUrl ?? "",
          duration: p.duration ?? 0,
          audioUrl: `https://youtu.be/${p.youtubeId}`,
        } as Playable);
      }
    }
    if (items.length === 0) return null;
    return {
      items,
      queueIndex: Math.min(Math.max(0, parsed.queueIndex), items.length - 1),
    };
  } catch {
    return null;
  }
}

// --- persistence helpers ----------------------------------------------------

const readNum = (key: string, fallback: number): number => {
  const raw = localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const readBool = (key: string, fallback: boolean): boolean => {
  const raw = localStorage.getItem(key);
  return raw === null ? fallback : raw === "1";
};

const initialVolume = Math.min(1, Math.max(0, readNum("ss.volume", 0.8)));
const initialMuted = readBool("ss.muted", false);
const initialShuffle = readBool("ss.shuffle", false);
const initialSmartShuffle = readBool("ss.smartShuffle", false);
const initialRepeat = (localStorage.getItem("ss.repeat") as RepeatMode | null) ?? "off";
const initialRate = Math.min(2, Math.max(0.5, readNum("ss.rate", 1)));
const initialAutoplay = readBool("ss.autoplay", true);
// Video presentation is temporarily disabled while the YouTube overlay is
// unreliable. Audio playback remains fully supported.
const initialVideoEnabled = false;
const initialAccentTheme = localStorage.getItem("ss.accentTheme") ?? "auto";
const initialCompact = readBool("ss.compact", false);
const initialGlow = readBool("ss.ambientGlow", true);
const initialVisualizer = readBool("ss.visualizer", true);
// Performance mode is opt-in: a default-off machine is the reason it exists,
// but nothing should change for anyone who has not asked for it.
const initialPerformanceMode = readBool("ss.performanceMode", false);
const initialPointerEffects = readBool("ss.pointerEffects", true);
const initialWallpaper = localStorage.getItem("ss.wallpaper");
const initialWallpaperType = localStorage.getItem("ss.wallpaperType") === "video" ? "video" : "image";
const savedQueue = readSavedQueue();

const readIdSet = (key: string): Record<string, true> => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const arr = JSON.parse(raw) as string[];
    return Object.fromEntries(arr.map((id) => [id, true as const]));
  } catch {
    return {};
  }
};
const writeIdSet = (key: string, set: Record<string, true>): void => {
  try {
    localStorage.setItem(key, JSON.stringify(Object.keys(set)));
  } catch {
    /* ignore */
  }
};

const initialLikedAlbums = readIdSet("ss.likedAlbums");
const initialFollowedArtists = readIdSet("ss.followedArtists");

// --- resume-position memory ---------------------------------------------------
// Long tracks remember where you stopped so you can resume exactly there.

const RESUME_KEY = "ss.resume";
const RESUME_MIN_DURATION = 300; // only tracks ≥ 5 min

/** Latest saved position for a track (for the Continue Listening UI). */
export function peekResumePosition(id: string, duration: number): number {
  try {
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<string, { t: number; at: number }>;
    const hit = map[id];
    if (!hit) return 0;
    if (hit.t < 10 || (duration > 0 && hit.t > duration - 20)) return 0;
    return hit.t;
  } catch {
    return 0;
  }
}

type ResumeMap = Record<string, { t: number; at: number }>;

function readResumeMap(): ResumeMap {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as ResumeMap;
  } catch {
    return {};
  }
}

function saveResumePosition(id: string, t: number): void {
  const map = readResumeMap();
  map[id] = { t, at: Date.now() };
  // cap entries
  const entries = Object.entries(map).sort((a, b) => b[1].at - a[1].at).slice(0, 50);
  localStorage.setItem(RESUME_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function getResumePosition(id: string, duration: number): number {
  if (duration < RESUME_MIN_DURATION) return 0;
  const hit = readResumeMap()[id];
  if (!hit) return 0;
  // only resume if meaningfully into the track and not basically finished
  if (hit.t < 10 || (duration > 0 && hit.t > duration - 20)) return 0;
  return hit.t;
}

// --- smart-shuffle memory -----------------------------------------------------

/** Ids of recently heard tracks (most recent first) — smart shuffle avoids these. */
const recentTrackIds: string[] = [];
function rememberTrack(id: string): void {
  const i = recentTrackIds.indexOf(id);
  if (i >= 0) recentTrackIds.splice(i, 1);
  recentTrackIds.unshift(id);
  if (recentTrackIds.length > 20) recentTrackIds.pop();
}

/**
 * Pick a random queue index for shuffle, avoiding: the current track, the
 * track that just played before it, and (when smart shuffle is on) the last
 * ~10 heard tracks. Falls back to any other index when the exclusions cover
 * the whole queue, so shuffle never dead-ends on a short queue.
 */
function pickShuffleIndex(queueLen: number, currentIndex: number, smart: boolean): number {
  const candidates: number[] = [];
  const recent = smart ? new Set(recentTrackIds) : null;
  for (let i = 0; i < queueLen; i++) {
    if (i === currentIndex) continue;
    // Never land straight back on the song that just ended — the previous
    // queue entry plays right before this pick.
    if (i === (currentIndex + 1) % queueLen && queueLen > 2) continue;
    if (recent) {
      const t = usePlayerStore.getState().queue[i];
      if (t && recent.has(t.id)) continue;
    }
    candidates.push(i);
  }
  if (candidates.length === 0) {
    // Everything excluded (tiny queue / everything recently heard) — any
    // other track is better than repeating or stopping.
    const fallback: number[] = [];
    for (let i = 0; i < queueLen; i++) if (i !== currentIndex) fallback.push(i);
    if (fallback.length === 0) return currentIndex;
    return fallback[Math.floor(Math.random() * fallback.length)];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- last-played memory (any source) ------------------------------------------

const LAST_PLAYED_KEY = "ss.lastPlayed";

export interface LastPlayedSnapshot {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  coverUrl: string;
  duration: number;
  source: "youtube";
  youtubeId?: string;
  audioUrl: string;
  at: number;
}

export function readLastPlayed(): LastPlayedSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as LastPlayedSnapshot;
    return snap && snap.id
      ? { ...snap, artistName: cleanArtistName(snap.artistName, snap.title) }
      : null;
  } catch {
    return null;
  }
}

function saveLastPlayed(track: Playable): void {
  try {
    const snap: LastPlayedSnapshot = {
      id: track.id,
      title: track.title,
      artistName: track.artistName,
      albumName: track.albumName,
      coverUrl: track.coverUrl,
      duration: track.duration,
      source: track.source,
      youtubeId: track.youtubeId,
      audioUrl: track.audioUrl,
      at: Date.now(),
    };
    localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(snap));
  } catch {
    /* storage unavailable */
  }
}

// --- full play history (any source) ------------------------------------------

const HISTORY_KEY = "ss.playHistory";
const HISTORY_MAX = 60;

/** A played track of any source, most recent first. */
export interface HistoryEntry extends LastPlayedSnapshot {
  playCount: number;
}

let historyCache: HistoryEntry[] | null = null;

/**
 * Subscribers to the LOCAL play history. localStorage is not reactive and
 * `readPlayHistory()` used to hand back the same cached array reference, so
 * pages that snapshotted history at mount (Home, Recent, Profile) never
 * repainted after a play. Every write now swaps in a NEW array and notifies,
 * which makes `useSyncExternalStore` re-read correctly.
 */
const historyListeners = new Set<() => void>();

function notifyHistoryChange(): void {
  for (const listener of historyListeners) {
    try {
      listener();
    } catch {
      /* a bad subscriber must not break playback bookkeeping */
    }
  }
}

/** Subscribe to local play-history writes. Fires immediately with the current value. */
export function subscribePlayHistory(listener: () => void): () => void {
  historyListeners.add(listener);
  listener();
  return () => {
    historyListeners.delete(listener);
  };
}

function loadHistory(): HistoryEntry[] {
  if (historyCache) return historyCache;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    historyCache = raw
      ? (JSON.parse(raw) as HistoryEntry[]).map((entry) => ({
          ...entry,
          artistName: cleanArtistName(entry.artistName, entry.title),
        }))
      : [];
  } catch {
    historyCache = [];
  }
  return historyCache!;
}

/** All played tracks across every source, most recent first. */
export function readPlayHistory(): HistoryEntry[] {
  return loadHistory();
}

function recordHistory(track: Playable): void {
  // Build a NEW array instead of mutating the cached one in place. Returning a
  // fresh reference is what lets React (and useSyncExternalStore) detect the
  // change — in-place mutation was the reason the Home pulse looked frozen.
  const current = loadHistory();
  const existing = current.find((h) => h.id === track.id);
  const next: HistoryEntry[] = existing
    ? [
        {
          ...existing,
          title: track.title,
          artistName: cleanArtistName(track.artistName, track.title),
          albumName: track.albumName,
          coverUrl: track.coverUrl,
          youtubeId: track.youtubeId,
          audioUrl: track.audioUrl,
          playCount: existing.playCount + 1,
          at: Date.now(),
        },
        ...current.filter((h) => h.id !== track.id),
      ]
    : [{ ...lastSnapshotOf(track), playCount: 1 }, ...current];
  if (next.length > HISTORY_MAX) next.length = HISTORY_MAX;
  historyCache = next;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  notifyHistoryChange();
}

function lastSnapshotOf(track: Playable): LastPlayedSnapshot {
  return {
    id: track.id,
    title: track.title,
    artistName: track.artistName,
    albumName: track.albumName,
    coverUrl: track.coverUrl,
    duration: track.duration,
    source: track.source,
    youtubeId: track.youtubeId,
    audioUrl: track.audioUrl,
    at: Date.now(),
  };
}

/** Clear the local cross-source play history (used by Settings). */
export function clearPlayHistory(): void {
  historyCache = [];
  try {
    localStorage.removeItem(HISTORY_KEY);
    localStorage.removeItem(LAST_PLAYED_KEY);
  } catch {
    /* storage unavailable */
  }
  notifyHistoryChange();
}

/** Remove a single entry from the local play history (by track id). */
export function clearSingleHistoryEntry(id: string): void {
  const history = loadHistory();
  const next = history.filter((h) => h.id !== id);
  historyCache = next;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  notifyHistoryChange();
}



// --- shared end-of-track handling ----------------------------------------------

let sleepCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastResumeSave = 0;

function restartCurrent(): void {
  const s = usePlayerStore.getState();
  if (s.current?.youtubeId) {
    // The engine is built with `autoplay: 1`, so by the time the repeat-one
    // hook runs the player has ALREADY rolled on to a YouTube-chosen related
    // video. `seek(0)` + `resume()` therefore restarted *that* video, not the
    // track the UI was showing — the symptom was a different song playing
    // under a "repeat one" label. Load the current track explicitly by id so
    // the audio and the miniplayer/fullscreen player can never disagree.
    usePlayerStore.setState({ currentTime: 0, isBuffering: true });
    void ytEngine
      .play(s.current.youtubeId, {
        volume: s.volume,
        muted: s.muted,
      })
      .catch(() => {
        // Fall back to the plain resume path so repeat still works if the
        // explicit reload is rejected.
        ytEngine.seek(0);
        ytEngine.resume();
      });
    return;
  }
  s.seek(0);
  void getAudio().play().catch(() => undefined);
}

/** In-flight related-mix fetch, deduped per seed so track-end doesn't double-fire. */
let relatedMixInFlight: { seedId: string; promise: Promise<Playable[]> } | null = null;

/** Tracks already played in this session — related mixes must never repeat them. */
const playedSessionIds = new Set<string>();

/**
 * Known genre list used to infer the seed's genre when YouTube doesn't tell us.
 * Checked against the artist name and track title for hints.
 */
/**
 * The genre/search context of the session's radio ("dark phonk", "jazz",
 * ...). Set when the user starts playback from a search; every queue fill
 * (autofill, end-of-queue, radio) reuses it so the queue never drifts to
 * unrelated songs.
 */
let activeMixContext: string | null = null;

const GENRE_HINTS = [
  "pop", "rock", "hip hop", "rap", "r&b", "soul", "funk", "jazz", "blues",
  "electronic", "edm", "house", "techno", "trance", "dubstep", "drum and bass",
  "ambient", "lofi", "lo-fi", "chill", "classical", "country", "folk",
  "indie", "alternative", "metal", "punk", "reggae", "latin", "afrobeats",
  "k-pop", "kpop", "j-pop", "disco", "synthwave", "vaporwave", "gospel",
  "acoustic", "dance", "disco",
];

/**
 * Try to infer a genre tag for the seed from its artist/title metadata.
 * Returns null when nothing obvious matches — callers then fall back to a
 * broader "similar to X" style query.
 */
/**
 * Turn a user-typed search into a usable genre seed, or null when the query
 * is just the track/artist (in which case genre inference is better).
 */
function normalizeContext(q?: string | null): string | null {
  const t = (q ?? "").trim().toLowerCase();
  if (t.length < 3) return null;
  // Strip noise words, keep the meaningful genre-ish phrase.
  const cleaned = t
    .replace(/\b(songs?|music|track|playlist|video|official|lyrics?|lyric video|remix|mix|edit|full album|top|best|popular|new|2024|2025|2026|hit|hits|vibe|mood|playlist)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3) return null;
  return cleaned;
}

function inferGenre(seed: Playable): string | null {
  const hay = `${seed.artistName} ${seed.title}`.toLowerCase();
  for (const g of GENRE_HINTS) {
    // Whole-word match — "rock" must not match "Rockwell" or "rocking".
    const re = new RegExp(`\\b${g.replace(/[^a-z& -]/g, "")}\\b`);
    if (re.test(hay)) return g === "lo-fi" ? "lofi" : g;
  }
  return null;
}

/**
 * Fetch a related-mix from YouTube Music based on the seed track's GENRE.
 * Returns Playables ready for the queue (empty on failure).
 */async function fetchRelatedMix(seed: Playable, existingQueue: Playable[], count: number, contextQuery?: string | null): Promise<Playable[]> {
  if (relatedMixInFlight?.seedId === seed.id) return relatedMixInFlight.promise;
  const promise = (async () => {
    try {
      ytSearchClient = ytSearchClient ?? new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
      const artist = seed.artistName.split(",")[0]?.trim() ?? "";
      // IMPORTANT: prioritize GENRE over artist. Queries target SONGS in the
      // genre (not "mix"/"playlist" compilations, which return whole-video
      // uploads and rehash the same creators). Two queries run per fill and
      // results are INTERLEAVED so the queue draws from many artists.
      // Prefer the SEARCH the user actually typed: "dark phonk" / "japanese
      // jazz" is a far better genre seed than anything we can guess from a
      // title like "LUZ ROJA (VIP Mix - Slowed)". Without this, playing from
      // search filled the queue with unrelated "similar to artist" results.
      const ctx = normalizeContext(contextQuery);
      const genre = ctx ?? inferGenre(seed);
      const songQueries = genre
        ? [
            `${genre} songs`,
            `top ${genre} songs`,
            `best ${genre} songs`,
            `${genre} hit songs`,
            `popular ${genre} music`,
            `${genre} essentials`,
          ]
        : [
            `artists similar to ${artist}`, // closest genre match we can get
            `${artist} mix`,
            `${artist} and similar artists playlist`,
          ];
      // Pick two different queries so one fill blends two result pools.
      const pick = () => songQueries[Math.floor(Math.random() * songQueries.length)];
      const q1 = pick();
      let q2 = pick();
      let guard = 0;
      while (q2 === q1 && guard++ < 5) q2 = pick();
      const searchOnce = async (query: string): Promise<YtItem[]> => {
        try {
          const client = ytSearchClient as ConvexClient;
          const res = await client.action(api.youtube.searchYoutube, { query });
          return (res?.items ?? []) as YtItem[];
        } catch {
          return [];
        }
      };
      const [items1, items2] = await Promise.all([searchOnce(q1), searchOnce(q2)]);
      // Interleave the two result pools — spreads artists throughout.
      const items: YtItem[] = [];
      const maxLen = Math.max(items1.length, items2.length);
      for (let i = 0; i < maxLen; i++) {
        if (items1[i]) items.push(items1[i]);
        if (items2[i]) items.push(items2[i]);
      }
      // Never include: the seed, anything queued, anything played this
      // session, or near-duplicates of anything queued/heard (same normalized
      // title) — that's how search-page duplicates sneak in.
      const existing = new Set(existingQueue.map((t) => t.id));
      existing.add(seed.id);
      for (const id of playedSessionIds) existing.add(id);
      const normTitle = (s: string) => s.toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, "").replace(/[^a-z0-9]/g, "");
      const seenTitles = new Set(existingQueue.map((t) => normTitle(t.title)));
      const seedTitle = normTitle(seed.title);
      const out: Playable[] = [];
      const normArtist = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const seedArtist = normArtist(seed.artistName);
      // Artist diversity inside the fill itself: max 2 songs per artist.
      const artistSeen = new Map<string, number>();
      for (const it of items as YtItem[]) {
        if (existing.has(it.id)) continue;
        const nt = normTitle(it.title);
        if (nt === seedTitle) continue; // alternate upload of the seed
        if (seenTitles.has(nt)) continue; // duplicate of queued/heard track
        // Drop same-artist repeats after the first couple — the point of the
        // fill is DIFFERENT songs, ideally different artists.
        const thisArtist = normArtist(it.artist ?? "");
        if (seedArtist && thisArtist === seedArtist && out.length >= 2) continue;
        if (thisArtist && (artistSeen.get(thisArtist) ?? 0) >= 2) continue;
        artistSeen.set(thisArtist, (artistSeen.get(thisArtist) ?? 0) + 1);
        existing.add(it.id);
        seenTitles.add(nt);
        out.push(toPlayableYoutube(it, ""));
        if (out.length >= count) break;
      }
      return out;
    } catch {
      return [];
    }
  })();
  relatedMixInFlight = { seedId: seed.id, promise };
  // Don't cache empty/failed fills — a transient search failure would lock
  // the seed out of retries.
  void promise.then((r: Playable[]) => {
    if (r.length === 0 && relatedMixInFlight?.promise === promise) relatedMixInFlight = null;
  }).catch(() => {
    if (relatedMixInFlight?.promise === promise) relatedMixInFlight = null;
  });
  return promise;
}

/** Shared auto-advance logic for both engines. */
function handleEnded(): void {
  const s = usePlayerStore.getState();

  // sleep timer "stop after this song"
  if (s.sleepAtSongEnd) {
    getAudio().pause();
    ytEngine.pause();
    usePlayerStore.setState({ isPlaying: false, sleepAtSongEnd: false });
    return;
  }

  if (s.repeat === "one") {
    restartCurrent();
    return;
  }
  if (s.queue.length > 0) {
    // Shuffle ON: jump to a RANDOM upcoming track, not the next in line.
    if (s.shuffle && s.queue.length > 1) {
      s.playIndex(pickShuffleIndex(s.queue.length, s.queueIndex, s.smartShuffle));
      return;
    }
    // Normal: advance in order.
    if (s.queueIndex < s.queue.length - 1) {
      s.playIndex(s.queueIndex + 1);
      return;
    }
    if (s.repeat === "all") {
      s.playIndex(0);
      return;
    }
  }
  // End of queue, repeat off — autoplay related music when enabled.
  // Fetches a related mix (same vibe/genre as the seed) from YouTube Music
  // so the music never stops, for ANY source.
  if (s.autoplay && s.current) {
    const seed = s.current;
    void fetchRelatedMix(seed, s.queue, 5, activeMixContext).then((related) => {
      // Filter INSIDE the updater: maybeAutofillQueue may have appended the
      // same related mix while this fetch was in flight — filtering against a
      // stale queue snapshot used to double-append the same tracks.
      usePlayerStore.setState((st) => {
        const fresh = related.filter((t) => !st.queue.some((q) => q.id === t.id));
        if (fresh.length === 0) return st;
        return { queue: [...st.queue, ...fresh] };
      });
      // Only auto-advance if nothing else started playing meanwhile.
      const after = usePlayerStore.getState();
      if (after.current?.id === seed.id && !after.isPlaying) {
        after.playIndex(after.queue.length - related.length);
      }
    });
    return;
  }
  getAudio().pause();
  ytEngine.pause();
  s.seek(0);
  usePlayerStore.setState({ isPlaying: false, currentTime: 0 });
}

/**
 * TRUE when the current track's audio is coming from the <audio> element
 * (effect/EQ active or a stream rescue) rather than the YouTube IFrame.
 * Playback controls MUST follow this, or play/pause/seek address a paused
 * engine while the real audio keeps playing.
 */
function audioElementIsSource(t: Playable | null | undefined): boolean {
  if (!t) return false;
  return (
    t.audioUrl === "stream" ||
    t.audioUrl.includes("audio-proxy") ||
    t.audioUrl.includes("googlevideo") ||
    t.audioUrl.includes("videoplayback") ||
    t.audioUrl.includes("piped") ||
    t.audioUrl.includes("odycdn") ||
    // A non-YouTube direct URL (catalog tracks) also plays via the element.
    (!t.youtubeId && /^https?:\/\//.test(t.audioUrl))
  );
}

/** A-B repeat + resume-position bookkeeping, run on every time update. */
const prefetchedTrackIds = new Set<string>();

function prefetchTrack(track: Playable | undefined): void {
  if (!track || typeof window === "undefined" || prefetchedTrackIds.has(track.id)) return;
  prefetchedTrackIds.add(track.id);

  // Keep next-track preparation off the critical click path. Artwork is cheap
  // to warm, and direct audio sources can fetch metadata without playing.
  window.setTimeout(() => {
    if (track.coverUrl) {
      const image = new Image();
      image.decoding = "async";
      image.src = track.coverUrl;
    }
    if (track.youtubeId) {
      const thumbnail = new Image();
      thumbnail.decoding = "async";
      thumbnail.src = `https://i.ytimg.com/vi/${track.youtubeId}/hqdefault.jpg`;
    }
    if (!track.youtubeId && /^https?:/.test(track.audioUrl)) {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.src = track.audioUrl;
      audio.load();
      window.setTimeout(() => {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      }, 15_000);
    }
  }, 250);
}

function onTimeUpdate(t: number, duration: number): void {
  const s = usePlayerStore.getState();
  if (s.abA !== null && s.abB !== null && t >= s.abB) {
    if (s.current?.youtubeId && !audioElementIsSource(s.current)) ytEngine.seek(s.abA);
    else getAudio().currentTime = s.abA;
    usePlayerStore.setState({ currentTime: s.abA });
    return;
  }
  // remember position on long tracks (throttled)
  const id = s.current?.id;
  if (id && duration >= RESUME_MIN_DURATION && Date.now() - lastResumeSave > 5000) {
    lastResumeSave = Date.now();
    saveResumePosition(id, t);
  }
}

// --- audio element wiring (catalog playback) ---------------------------------

let wired = false;
let audioBufferWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearAudioBufferWatchdog(): void {
  if (audioBufferWatchdog !== null) clearTimeout(audioBufferWatchdog);
  audioBufferWatchdog = null;
}

function armAudioBufferWatchdog(audio: HTMLAudioElement): void {
  clearAudioBufferWatchdog();
  const trackId = usePlayerStore.getState().current?.id;
  if (!trackId) return;

  audioBufferWatchdog = setTimeout(() => {
    const state = usePlayerStore.getState();
    if (state.current?.id !== trackId || !state.isBuffering) return;
    if (!audioElementIsSource(state.current)) return;
    if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      usePlayerStore.setState({ isBuffering: false });
      return;
    }

    // Retry the same source in place. Do not increment errorNonce here: that
    // would trigger PlayerBar's alternate-upload fallback and could replace
    // the user's song just because the network briefly stalled.
    const resumeAt = audio.currentTime;
    audio.load();
    if (resumeAt > 0) {
      const restorePosition = () => {
        audio.currentTime = resumeAt;
        usePlayerStore.setState({ currentTime: resumeAt });
      };
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) restorePosition();
      else audio.addEventListener("loadedmetadata", restorePosition, { once: true });
    }
    void audio.play().catch(() => undefined);
  }, 8_000);
}
function wireAudio() {
  if (wired) return;
  wired = true;
  const audio = getAudio();
  audio.volume = initialVolume;
  audio.muted = initialMuted;
  audio.playbackRate = initialRate;

  // Restore persisted audio settings (EQ / balance / mono / sound filter).
  try {
    const eq = JSON.parse(localStorage.getItem("ss.eq") ?? "{}") as {
      bass?: number;
      treble?: number;
      balance?: number;
      mono?: boolean;
      filter?: string;
    };
    if (typeof eq.bass === "number") setEqBassLib(eq.bass);
    if (typeof eq.treble === "number") setEqTrebleLib(eq.treble);
    if (typeof eq.balance === "number") setEqBalanceLib(eq.balance);
    if (eq.mono) setEqMonoLib(true);
    // Sound effects are intentionally session-only. Applying a persisted
    // effect after startup made Bass Boost appear at random while a track was
    // already playing; the user must explicitly enable it again.
  } catch {
    /* ignore */
  }

  audio.addEventListener("timeupdate", () => {
    const duration = audio.duration && Number.isFinite(audio.duration) ? audio.duration : 0;
    usePlayerStore.setState({ currentTime: audio.currentTime, duration });
    onTimeUpdate(audio.currentTime, duration);
  });

  audio.addEventListener("durationchange", () => {
    if (audio.duration && Number.isFinite(audio.duration)) {
      usePlayerStore.setState({ duration: audio.duration });
    }
  });

  audio.addEventListener("progress", () => {
    try {
      if (audio.buffered.length > 0) {
        const end = audio.buffered.end(audio.buffered.length - 1);
        usePlayerStore.setState({ bufferedEnd: end });
      }
    } catch {
      /* ignore */
    }
  });

  audio.addEventListener("waiting", () => {
    usePlayerStore.setState({ isBuffering: true });
    armAudioBufferWatchdog(audio);
  });
  audio.addEventListener("stalled", () => {
    usePlayerStore.setState({ isBuffering: true });
    armAudioBufferWatchdog(audio);
  });
  audio.addEventListener("playing", () => {
    clearAudioBufferWatchdog();
    usePlayerStore.setState({ isBuffering: false, isPlaying: true });
  });
  audio.addEventListener("pause", () => {
    clearAudioBufferWatchdog();
    usePlayerStore.setState({ isPlaying: false, isBuffering: false });
  });
  audio.addEventListener("play", () => usePlayerStore.setState({ isPlaying: true }));

  audio.addEventListener("ended", () => {
    clearAudioBufferWatchdog();
    handleEnded();
  });

}

// --- youtube iframe engine wiring --------------------------------------------

let ytWired = false;
let ytLoadWatchdog: ReturnType<typeof setTimeout> | null = null;

function clearYtLoadWatchdog(): void {
  if (ytLoadWatchdog !== null) clearTimeout(ytLoadWatchdog);
  ytLoadWatchdog = null;
}

function wireYoutubeEngine() {
  if (ytWired) return;
  ytWired = true;

  ytEngine.setHandlers({
    onStateChange: (state) => {
      // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
      // The engine emits events asynchronously: when we switch to a catalog
      // track we pause the engine, and its late "paused" event must not flip
      // isPlaying off while the audio element is already playing.
      if (!usePlayerStore.getState().current?.youtubeId) return;
      if (state === 1) {
        clearYtLoadWatchdog();
        // The IFrame player is created with autoplay:1, so YouTube rolls on to
        // a RELATED video by itself when one finishes. Nothing in the app asks
        // for that, so the store's current track (and therefore the miniplayer
        // and fullscreen player) kept showing the old song while a different
        // one played. Snap the engine back to the track the UI is showing.
        const current = usePlayerStore.getState().current;
        const actualId = ytEngine.getActualVideoId();
        if (current?.youtubeId && actualId && actualId !== current.youtubeId) {
          const s2 = usePlayerStore.getState();
          void ytEngine
            .play(current.youtubeId, { volume: s2.volume, muted: s2.muted })
            .catch(() => {
              /* the store's own error path will surface a failed reload */
            });
          // Returned early, so the playing flag has to be set here too. Leaving
          // it untouched made the miniplayer keep showing a paused transport
          // for the whole reload.
          usePlayerStore.setState({ isPlaying: true, isBuffering: false });
          return;
        }
        usePlayerStore.setState({ isPlaying: true, isBuffering: false });
      } else if (state === 2) {
        usePlayerStore.setState({ isPlaying: false, isBuffering: false });
      } else if (state === 3) {
        usePlayerStore.setState({ isBuffering: true });
      } else if (state === 0) {
        handleEnded();
      }
    },
    onTime: (currentTime, duration) => {
      usePlayerStore.setState({
        currentTime,
        duration: duration > 0 ? duration : usePlayerStore.getState().duration,
        bufferedEnd: currentTime,
      });
      onTimeUpdate(currentTime, duration);
    },
    onError: (code) => {
      const current = usePlayerStore.getState().current;
      // Ignore late errors from a previous YouTube load. Otherwise the
      // fallback UI can replace the newly selected song with another upload.
      if (!current?.youtubeId || ytEngine.getLoadedVideoId() !== current.youtubeId) return;
      if (ytEngine.isFatalError(code)) {
        clearYtLoadWatchdog();
        usePlayerStore.setState((s) => ({
          isBuffering: false,
          isPlaying: false,
          errorNonce: s.errorNonce + 1,
        }));
      }
    },
  });

  // Initialize the hidden YouTube player before the first click. This removes
  // the API/iframe startup delay while keeping playback lazy for the track
  // itself.
  ytEngine.warmup();
}

// --- media session (lock screen / hardware keys) ------------------------------

function syncMediaSession(track: Playable | null, playing: boolean) {
  if (!("mediaSession" in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artistName,
    album: track.albumName,
    artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: "512x512" }] : [],
  });
  navigator.mediaSession.playbackState = playing ? "playing" : "paused";
}

/** Hardware media keys / lock-screen controls. */
function wireMediaKeys() {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.setActionHandler("play", () => usePlayerStore.getState().togglePlay());
    ms.setActionHandler("pause", () => usePlayerStore.getState().togglePlay());
    ms.setActionHandler("previoustrack", () => usePlayerStore.getState().prev());
    ms.setActionHandler("nexttrack", () => usePlayerStore.getState().next());
    ms.setActionHandler("seekbackward", () => {
      const s = usePlayerStore.getState();
      s.seek(Math.max(0, s.currentTime - 10));
    });
    ms.setActionHandler("seekforward", () => {
      const s = usePlayerStore.getState();
      s.seek(s.currentTime + 10);
    });
  } catch {
    /* unsupported action types — fine */
  }
}

// --- store --------------------------------------------------------------------

export const usePlayerStore = create<PlayerStore>()((set, get) => {
  wireAudio();
  wireYoutubeEngine();
  wireMediaKeys();

  const norm = (t: Playable): Playable => ({
    ...t,
    title: cleanTrackTitle(t.title),
    artistName: cleanArtistName(t.artistName, t.title),
    alternatives: t.alternatives?.map((item) => ({
      ...item,
      title: cleanTrackTitle(item.title),
      artist: cleanArtistName(item.artist, item.title),
    })),
  });

  let lastRemoved: { item: Playable; index: number } | null = null;
  /** Increments on every track load; stale async results are discarded. */
  let loadSeq = 0;

  const watchAudioErrors = (audio: HTMLAudioElement, token: number, trackId: string) => {
    const onError = () => {
      // Ignore errors from a previous source that arrive after the user has
      // already switched tracks. Without this guard they increment errorNonce
      // and PlayerBar mistakes them for a failure of the new song, then
      // searches for and swaps in a completely different upload.
      if (token !== loadSeq || get().current?.id !== trackId) return;
      set((state) => ({
        isBuffering: false,
        isPlaying: false,
        errorNonce: state.errorNonce + 1,
      }));
    };
    audio.addEventListener("error", onError, { once: true });
  };

  /**
   * Keep the queue topped up: when autoplay is on and fewer than 3 upcoming
   * songs remain, fetch a genre/related mix and append it — the user should
   * never have to open the queue and press "add similar songs" manually.
   * Guarded so only one fetch runs at a time and the seed can't double-fill.
   */
  let autofillInFlight = false;
  let autofillSeedId: string | null = null;
  const maybeAutofillQueue = () => {
    const s = get();
    if (!s.autoplay || !s.current) return;
    const upcoming = s.queueIndex >= 0 ? s.queue.length - 1 - s.queueIndex : s.queue.length;
    if (upcoming >= 3) return;
    if (autofillInFlight || autofillSeedId === s.current.id) return;
    autofillInFlight = true;
    autofillSeedId = s.current.id;
    const seed = s.current;
    void fetchRelatedMix(seed, s.queue, 8, activeMixContext)
      .then((related) => {
        if (usePlayerStore.getState().current?.id !== seed.id) return; // song changed meanwhile
        // Filter against the LATEST queue inside the updater — the end-of-
        // queue auto-advance path in handleEnded can append the same mix
        // concurrently, and a stale snapshot would duplicate the tracks.
        usePlayerStore.setState((st) => {
          const fresh = related.filter((t) => !st.queue.some((q) => q.id === t.id));
          if (fresh.length === 0) return st;
          return {
            queue: [...st.queue, ...fresh],
            unshuffledQueue: st.unshuffledQueue ? [...st.unshuffledQueue, ...fresh] : null,
          };
        });
        const after = usePlayerStore.getState();
        saveQueue(after.queue, after.queueIndex, after.current?.id ?? null);
      })
      .finally(() => {
        autofillInFlight = false;
      });
  };

  /** Route loading/playback to the right engine for the given track. */
  const loadTrack = (track: Playable, startSeconds?: number) => {
    const seq = ++loadSeq;
    const prev = get().current;
    playedSessionIds.add(track.id);

    // queue history: remember what was playing before this
    if (prev && prev.id !== track.id) {
      set((state) => ({
        history: [prev, ...state.history.filter((h) => h.id !== prev.id)].slice(0, 50),
      }));
    }
    rememberTrack(track.id);
    saveLastPlayed(track);
    recordHistory(track);

    // record catalog plays for history / most-played
    // Record EVERY play (any source) for listening stats — the recorder
    // receives the playable's id; AppShell attaches a title/artist snapshot.
    if (historyRecorder) {
      try {
        historyRecorder(track.id);
      } catch {
        /* ignore */
      }
    }
    // Product analytics: what actually gets played, from where.
    trackEvent("track_play", {
      track_id: track.id,
      title: track.title.slice(0, 120),
      artist: track.artistName.slice(0, 120),
      source: track.source,
      has_video: !!track.youtubeId,
    });

    const resumeAt = startSeconds ?? getResumePosition(track.id, track.duration);

    // Commit the new track to the store BEFORE routing it to an engine.
    // This used to sit at the very end of loadTrack, but two branches return
    // early (the YouTube + audio-processing path below, and the "stream"
    // rescue path) — so with an EQ preset or sound effect active, `current`
    // was never updated. The new song played through the engine while the
    // miniplayer and fullscreen player kept showing the PREVIOUS track, and
    // the ytResolve guard below (which wants current to already be the new
    // track) always failed, so the effect never applied to the new song
    // either. Every branch must observe the same committed state.
    set({
      current: track,
      currentTime: resumeAt,
      duration: track.duration,
      bufferedEnd: 0,
      isBuffering: true,
      // A-B points don't carry across tracks
      abA: null,
      abB: null,
    });

    // Route to the YouTube IFrame engine by video id; otherwise use the audio element.
    // EXCEPTION: when an audio effect is active, YouTube tracks play through
    // the <audio> element with a resolved direct stream instead — the IFrame
    // engine can't be tapped by Web Audio, so effects would be silent no-ops.
    if (track.youtubeId) {
      // The IFrame engine cannot be tapped by Web Audio, so ANY audio
      // processing (effect preset OR a non-flat EQ) must play through the
      // <audio> element. Checking only the effect preset is why the bass /
      // treble sliders appeared to do nothing.
      const wantFilter = get().audioFilter !== "off" || hasAudioProcessing();
      // Mobile browsers are much more likely to keep a mounted HTML audio
      // element alive when the tab is minimized than a YouTube IFrame. The
      // resolver still falls back to the IFrame if the stream is unavailable.
      if (wantFilter && track.youtubeId) {
        // Start the dry YouTube engine immediately, then resolve the EQ
        // stream in the background so effects never delay the first sound.
        void ytEngine
          .play(track.youtubeId, {
            volume: get().volume,
            muted: get().muted,
            startSeconds: resumeAt || undefined,
          })
          .catch(() => undefined);
        void ytResolve(track.youtubeId).then((url) => {
          if (!url) return;
          const state = usePlayerStore.getState();
          if (state.current?.youtubeId !== track.youtubeId || !state.current) return;
          swapToFilteredStream(state.current, state.currentTime);
        });
        return;
      }
      getAudio().pause();
      clearYtLoadWatchdog();
      ytLoadWatchdog = setTimeout(() => {
        const state = usePlayerStore.getState();
        if (seq !== loadSeq || !state.current?.youtubeId || state.isPlaying) return;
        clearYtLoadWatchdog();
        usePlayerStore.setState((currentState) => ({
          isBuffering: false,
          isPlaying: false,
          errorNonce: currentState.errorNonce + 1,
        }));
      }, 12_000);
      ytEngine
        .play(track.youtubeId, { volume: get().volume, muted: get().muted, startSeconds: resumeAt || undefined })
        .then(() => {
          // The engine init is async — if the user picked another song while
          // this one was initializing, make sure this load never wins.
        if (seq !== loadSeq) ytEngine.pause();
      })
      .catch(() => {
          clearYtLoadWatchdog();
          if (seq !== loadSeq) return;
            set({ isPlaying: false, isBuffering: false, errorNonce: get().errorNonce + 1 });
        });
    } else {
      ytEngine.pause();
      const audio = getAudio();
      // "stream" marks a rescue-load: a YouTube track that failed to embed
      // (embed-restricted video), played through the resolved direct stream
      // + CORS proxy instead so it still plays.
      if (track.audioUrl === "stream") {
        void resolveAndPlayWithFilter(track, resumeAt, false);
        return;
      }
      audio.src = track.audioUrl;
      audio.playbackRate = get().rate;
      watchAudioErrors(audio, seq, track.id);
      audio.load();
      if (resumeAt > 0) {
        const applyResume = () => {
          audio.currentTime = resumeAt;
          usePlayerStore.setState({ currentTime: resumeAt });
        };
        if (audio.readyState >= 1) applyResume();
        else audio.addEventListener("loadedmetadata", applyResume, { once: true });
      }
      // Actually start playback. loadTrack is always reached from a user
      // gesture (row click) or auto-advance, so autoplay is permitted —
      // without this the song only loads and needs a second click.
      void audio.play().catch(() => undefined);
      // If this is a YouTube track on the audio path with video enabled,
      // keep the muted visual slave in sync so the fullscreen player shows
      // THIS song's video instead of the previous one's frozen thumbnail.
      if (track.youtubeId) setTimeout(() => syncVideoSlave(), 150);
    }
    syncMediaSession(track, true);
    const nextIndex = get().queueIndex + 1;
    prefetchTrack(get().queue[nextIndex]);
    maybeAutofillQueue();
  };

  const playTrack = (track: Playable, list?: (Playable)[]) => {
    // Explicit list playback (playlist / liked / home rows) is not a search
    // context — drop any genre left over from a previous search.
    activeMixContext = null;
    const list2 =
      list && list.length > 0 ? list.map(norm) : [norm(track)];
    const t = norm(track);
    // Match by id OR youtubeId — history snapshots may carry a stored id that
    // differs from the live item id, which used to make findIndex fail and
    // silently play index 0 ("always the most recent song") instead.
    let idx = list2.findIndex((x) => x.id === t.id);
    if (idx < 0 && t.youtubeId) idx = list2.findIndex((x) => x.youtubeId === t.youtubeId);
    if (idx < 0 && t.title) {
      const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      idx = list2.findIndex(
        (x) => normKey(x.title) === normKey(t.title) && normKey(x.artistName) === normKey(t.artistName),
      );
    }
    let index = idx >= 0 ? idx : 0;
    let queue = list2;
    // If the clicked track isn't in the list (id mismatch with history
    // snapshots), prepend it so the song the user actually clicked plays —
    // falling back to index 0 silently played the most recent entry.
    if (idx < 0) {
      queue = [t, ...queue.filter((x) => x.id !== t.id)];
      index = 0;
    }
    // When shuffle is already on, physically shuffle the REST of the queue
    // (clicked track first) — otherwise "next" would just walk the unshuffled
    // list and shuffle would appear broken until the toggle was touched.
    if (get().shuffle && queue.length > 1) {
      const current = queue[index];
      const rest = queue.filter((_, i) => i !== index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      queue = current ? [current, ...rest] : rest;
      index = 0;
    }
    set({ queue, queueIndex: index, unshuffledQueue: null, unshuffledIndex: -1 });
    loadTrack(queue[index]);
  };

  const startRadio = (track: Playable, contextQuery?: string) => {
    const seed = norm(track);
    // Remember what the user searched so every later queue fill (autofill,
    // end-of-queue) stays in the SAME genre instead of drifting.
    activeMixContext = normalizeContext(contextQuery) ?? activeMixContext;
    // Start the seed immediately; the related mix (same vibe/genre) is
    // fetched in the background and appended as it arrives.
    const initial: Playable[] = [seed];
    set({ queue: initial, queueIndex: 0 });
    loadTrack(seed);
    void fetchRelatedMix(seed, initial, 15, contextQuery).then((related) => {
      // Dedupe against the latest queue inside the updater (see autofill note).
      usePlayerStore.setState((st) => {
        const fresh = related.filter((t) => !st.queue.some((q) => q.id === t.id));
        if (fresh.length === 0) return st;
        return { queue: [...st.queue, ...fresh] };
      });
      saveQueue(
        usePlayerStore.getState().queue,
        usePlayerStore.getState().queueIndex,
        usePlayerStore.getState().current?.id ?? null,
      );
    });
  };

  const playViaStream = (track: Playable, startSeconds?: number) => {
    // Mark the track as stream-loaded so loadTrack takes the audio path even
    // with no filter active — this is how non-embeddable videos get rescued.
    const marked = { ...track, audioUrl: track.audioUrl || "stream" };
    set({ queue: get().queue.map((t) => (t.id === marked.id ? marked : t)) });
    loadTrack(marked, startSeconds);
  };

  const replaceCurrentStream = (playable: Playable, startSeconds?: number) => {
    const s = get();
    const index = Math.max(0, s.queueIndex);
    const queue = s.queue.map((t, i) => (i === index ? playable : t));
    set({ queue, queueIndex: index });
    loadTrack(playable, startSeconds);
  };

  const playIndex = (index: number) => {
    const s = get();
    if (index < 0 || index >= s.queue.length) return;
    saveQueue(s.queue, index, s.queue[index]?.id ?? null);
    set({ queueIndex: index });
    loadTrack(s.queue[index]);
    maybeAutofillQueue();
  };

  const togglePlay = () => {
    const s = get();
    if (s.current) {
      if (s.current.youtubeId && !audioElementIsSource(s.current)) {
        // The engine emits state events, so just nudge it in the right direction.
        if (s.isPlaying) ytEngine.pause();
        else ytEngine.resume();
        return;
      }
      const audio = getAudio();
      if (audio.paused) {
        void audio.play().catch(() => undefined);
        syncMediaSession(s.current, true);
      } else {
        audio.pause();
        syncMediaSession(s.current, false);
      }
      return;
    }
    if (s.queue.length > 0) {
      playIndex(s.queueIndex >= 0 ? s.queueIndex : 0);
    }
  };

  const next = () => {
    const s = get();
    if (s.queue.length === 0) return;
    // Shuffle ON: play a RANDOM other track (not the one directly below).
    if (s.shuffle && s.queue.length > 1) {
      playIndex(pickShuffleIndex(s.queue.length, s.queueIndex, get().smartShuffle));
      return;
    }
    if (s.queueIndex < s.queue.length - 1) {
      playIndex(s.queueIndex + 1);
    } else if (s.repeat === "all") {
      playIndex(0);
    }
  };

  const prev = () => {
    const s = get();
    if (s.queue.length === 0) return;
    if (s.currentTime > 3) {
      s.seek(0);
      return;
    }
    if (s.queueIndex > 0) {
      playIndex(s.queueIndex - 1);
    } else if (s.repeat === "all") {
      playIndex(s.queue.length - 1);
    } else {
      s.seek(0);
    }
  };

  const seek = (time: number) => {
    const s = get();
    const duration = s.duration;
    const t = Math.max(0, Math.min(time, duration || time));
    // Seek whichever engine actually owns the sound (see audioElementIsSource).
    if (s.current?.youtubeId && !audioElementIsSource(s.current)) {
      ytEngine.seek(t);
    } else {
      getAudio().currentTime = t;
    }
    set({ currentTime: t });
  };

  const setVolume = (volume: number) => {
    const v = Math.min(1, Math.max(0, volume));
    getAudio().volume = v;
    ytEngine.setVolume(v);
    localStorage.setItem("ss.volume", String(v));
    set({ volume: v });
  };

  const toggleMute = () => {
    const s = get();
    const nextMuted = !s.muted;
    getAudio().muted = nextMuted;
    ytEngine.setMuted(nextMuted);
    localStorage.setItem("ss.muted", nextMuted ? "1" : "0");
    if (!nextMuted && s.volume === 0) {
      get().setVolume(0.8);
    }
    set({ muted: nextMuted });
  };

  const toggleShuffle = () => {
    const s0 = get();
    const next = !s0.shuffle;
    localStorage.setItem("ss.shuffle", next ? "1" : "0");
    // Physically reorder the queue so shuffle takes effect immediately and the
    // queue panel reflects it. The currently playing track keeps its slot; the
    // rest are Fisher–Yates shuffled. Turning shuffle off restores the saved
    // original order. Works for ANY queue size (≥ 2) — small queues used to
    // silently do nothing, which made shuffle feel broken.
    if (s0.queue.length >= 2) {
      const currentId = s0.queueIndex >= 0 ? s0.queue[s0.queueIndex]?.id : null;
      if (next) {
        if (s0.unshuffledQueue === null) {
          set({ unshuffledQueue: [...s0.queue], unshuffledIndex: s0.queueIndex });
        }
        const current = currentId ? s0.queue[s0.queueIndex] : null;
        const rest = s0.queue.filter((_, i) => i !== s0.queueIndex);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const newQueue = current ? [current, ...rest] : rest;
        set({ queue: newQueue, queueIndex: current ? 0 : -1 });
        saveQueue(newQueue, current ? 0 : -1, currentId);
      } else if (s0.unshuffledQueue !== null) {
        const restored = s0.unshuffledQueue;
        let idx = s0.unshuffledIndex;
        if (currentId) {
          const found = restored.findIndex((t) => t.id === currentId);
          if (found >= 0) idx = found;
        }
        set({ queue: restored, queueIndex: idx, unshuffledQueue: null, unshuffledIndex: -1 });
        saveQueue(restored, idx, currentId);
      }
    }
    set({ shuffle: next });
  };

  const toggleSmartShuffle = () => {
    const next = !get().smartShuffle;
    localStorage.setItem("ss.smartShuffle", next ? "1" : "0");
    // smart shuffle implies shuffle
    if (next && !get().shuffle) {
      localStorage.setItem("ss.shuffle", "1");
      set({ shuffle: true, smartShuffle: true });
      return;
    }
    set({ smartShuffle: next });
  };

  const cycleRepeat = () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const idx = order.indexOf(get().repeat);
    const next = order[(idx + 1) % order.length];
    localStorage.setItem("ss.repeat", next);
    set({ repeat: next });
  };

  const setRate = (rate: number) => {
    const r = Math.min(2, Math.max(0.5, rate));
    getAudio().playbackRate = r;
    ytEngine.setRate(r);
    localStorage.setItem("ss.rate", String(r));
    set({ rate: r });
    // Nudge the seek bar / HUD to re-sync: the YouTube engine reports time in
    // wall-clock seconds, which drifts from the seek bar's duration-based
    // progress when the rate changes mid-play.
    const s = get();
    if (s.current?.youtubeId) {
      usePlayerStore.setState({ currentTime: s.currentTime });
    }
  };

  const setAudioFilterAction = (id: AudioFilterId) => {
    // Warm the graph in the same gesture — a suspended context makes the
    // whole effect chain a silent no-op.
    if (id !== "off") ensureGraph();
    setAudioFilter(id);
    set({ audioFilter: id });
    if (id !== "off") {
      trackEvent("audio_effect_applied", {
        effect: id,
        track_id: get().current?.id ?? null,
        source: get().current?.source ?? null,
      });
    }
    // Detect the resolved-stream paths that play through the <audio> element.
    // Covers: our Convex CORS proxy URLs, raw googlevideo URLs, and direct
    // Piped URLs (the browser-side fallback) — string-matching only googlevideo
    // used to miss Piped streams, so "off" never swapped back to the engine.
    // CRITICAL: the DEFAULT audioUrl for YouTube tracks is the placeholder
    // "https://youtu.be/<id>" — that is NOT a playable stream (it's an HTML
    // page!). Treating it as a stream path made effect activation a no-op:
    // the song kept playing through the IFrame engine where Web Audio can't
    // tap anything, so the EQ never applied. Only REAL media streams count.
    const onStreamPath = (t: Playable | null | undefined) =>
      !!t &&
      (t.audioUrl.includes("audio-proxy") ||
        t.audioUrl.includes("googlevideo") ||
        t.audioUrl.includes("videoplayback") ||
        t.audioUrl.includes("piped") ||
        t.audioUrl.includes("odycdn") ||
        t.audioUrl === "stream");
    // If a YouTube track is currently playing via the IFrame engine and an
    // effect was just activated, hot-swap it onto the filtered audio path.
    // (Anything that isn't a real media stream — including the youtu.be
    // placeholder — needs the swap too.)
    const s = get();
    if (
      (id !== "off" || hasAudioProcessing()) &&
      s.current?.youtubeId &&
      !onStreamPath(s.current)
    ) {
      const resumeAt = s.currentTime;
      void resolveAndPlayWithFilter(s.current, resumeAt, true);
    }
    // If the effect was turned off while a YouTube track is on the audio
    // element, swap back to the IFrame engine (better quality/reliability) —
    // but ONLY when no other processing is configured. With the EQ still
    // active this used to hand playback back to the untappable IFrame, so
    // the bass/treble settings went silent the moment you picked "None".
    if (
      id === "off" &&
      !hasAudioProcessing() &&
      s.current?.youtubeId &&
      onStreamPath(s.current)
    ) {
      const resumeAt = s.currentTime;
      getAudio().pause();
      void ytEngine
        .play(s.current.youtubeId, { volume: s.volume, muted: s.muted, startSeconds: resumeAt })
        .catch(() => undefined);
    }
    // When video is enabled and an effect activates, the sound now comes from
    // the filtered <audio> element — sync the muted video slave to it.
    syncVideoSlave();
    // Outside the fullscreen player the video must never be on screen. Park
    // it explicitly: a left-over fixed overlay is a click blocker, and this is
    // the exact moment one used to appear (enabling an effect).
    if (!get().fullscreen) ytEngine.dismissVideo();
  };

  /**
   * Keep the muted video slave in lockstep with the filtered audio element:
   * start it when needed, pause it when video is off / effect off / not a
   * YouTube track, and re-sync position every few seconds.
   */
  const syncVideoSlave = () => {
    const s = get();
    // The visual slave is needed whenever sound comes from the audio element
    // — that includes EQ-only playback, not just preset effects (which is
    // why the video showed a frozen thumbnail with the sliders but no preset).
    const wantSlave =
      s.fullscreen &&
      s.videoEnabled &&
      !!s.current?.youtubeId &&
      (s.audioFilter !== "off" || hasAudioProcessing()) &&
      audioElementIsSource(s.current);
    if (wantSlave && s.current?.youtubeId) {
      void ytEngine.startSlave(s.current.youtubeId, s.currentTime);
    } else if (ytEngine.isSlaveMode()) {
      ytEngine.stopSlave();
    }
  };

  // Periodic drift resync between the audio element and the video slave.
  setInterval(() => {
    const s = usePlayerStore.getState();
    if (!ytEngine.isSlaveMode()) return;
    const engineT = ytEngine.getEngineTime();
    if (Math.abs(engineT - s.currentTime) > 1.5 && s.isPlaying) {
      ytEngine.seek(s.currentTime);
    }
  }, 3000);

  /**
   * Resolve a direct audio URL for a YouTube track and play it through the
   * audio element so the Web Audio effect chain applies. Falls back to the
   * IFrame engine when resolution fails.
   */
  /**
   * Stream resolution is the fragile part of the EQ chain: YouTube
   * bot-blocks datacenter IPs and public Piped instances intermittently
   * return nothing. A single failed attempt used to kill the effect
   * ("Effect unavailable"). Retry a few times with backoff instead, then
   * schedule a background retry that swaps the song onto the filtered path
   * as soon as ANY resolver succeeds.
   */
  let effectRetryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Monotonic token for filtered-stream loads: only the newest may start. */
  let filterLoadSeq = 0;
  const scheduleEffectRetry = (videoId: string) => {
    if (effectRetryTimer) clearTimeout(effectRetryTimer);
    let attempts = 0;
    const tryResolve = () => {
      attempts += 1;
      void ytResolve(videoId).then((url) => {
        if (url) {
          const s = usePlayerStore.getState();
          // Only swap if this song is still playing AND the effect is still
          // wanted — never hijack playback after the user moved on.
          if (s.current?.youtubeId !== videoId || s.audioFilter === "off") return;
          swapToFilteredStream(s.current, s.currentTime);
          const label = AUDIO_FILTERS.find((f) => f.id === s.audioFilter)?.label ?? "Effect";
          toast.success(`${label} applied`, { id: "fx-retry" });
          return;
        }
        if (attempts < 8) effectRetryTimer = setTimeout(tryResolve, 15_000);
      });
    };
    effectRetryTimer = setTimeout(tryResolve, 12_000);
  };

  /** Play a resolved stream through the <audio> element at `at` seconds. */
  const swapToFilteredStream = (track: Playable, at: number) => {
    const videoId = track.youtubeId;
    if (!videoId) return;
    const seq = ++loadSeq;
    const myFilterSeq = ++filterLoadSeq;
    // Invalidate any other filtered-load in flight so we never end up with two
    // sources playing the same song at once (which sounds like the effect
    // "does nothing" because the dry IFrame audio is mixed on top).
    ytEngine.pause();
    getAudio().pause();
    void ytResolve(videoId).then((url) => {
      if (!url || seq !== loadSeq || myFilterSeq !== filterLoadSeq) return;
      const audio = getAudio();
      ytEngine.pause();
      audio.pause();
      audio.src = url;
      audio.playbackRate = get().rate;
      audio.load();
      if (at > 0) {
        const applyResume = () => {
          audio.currentTime = at;
          usePlayerStore.setState({ currentTime: at });
        };
        if (audio.readyState >= 1) applyResume();
        else audio.addEventListener("loadedmetadata", applyResume, { once: true });
      }
      void audio.play().catch(() => undefined);
      usePlayerStore.setState({ current: { ...track, audioUrl: url }, currentTime: at });
      syncVideoSlave();
    });
  };

  /**
   * Prove the effect is actually doing something: once the filtered stream is
   * playing, sample the graph's analyser. Silence while audio is playing
   * means the EQ is NOT in the path (suspended context, or the element is
   * still dry), so we resume the context and re-route before giving up.
   */
  let verifyTimer: ReturnType<typeof setTimeout> | null = null;
  const verifyEffectIsLive = (videoId: string) => {
    if (verifyTimer) clearTimeout(verifyTimer);
    const check = (attempt: number) => {
      const s = usePlayerStore.getState();
      if (s.current?.youtubeId !== videoId) return;
      if (!s.isPlaying) {
        verifyTimer = setTimeout(() => check(attempt), 500);
        return;
      }
      const level = getSignalLevel();
      if (level < 0) return; // graph not built yet
      if (level > 0.004) return; // audio IS flowing through the EQ chain
      if (attempt >= 2) {
        toast("Effect still not processing", {
          id: "fx-verify",
          description: "This song's stream resists processing \u2014 try another track",
        });
        return;
      }
      void resumeGraph().then((ok) => {
        if (!ok) {
          toast("Tap play once to activate audio processing", {
            id: "fx-verify",
            description: "Your browser needs a click before the EQ can start",
          });
          return;
        }
        const t = usePlayerStore.getState().current;
        if (t?.youtubeId) swapToFilteredStream(t, usePlayerStore.getState().currentTime);
      });
      verifyTimer = setTimeout(() => check(attempt + 1), 2500);
    };
    verifyTimer = setTimeout(() => check(0), 1800);
  };

  const resolveAndPlayWithFilter = (track: Playable, resumeAt: number, forEffect = false) => {
    const videoId = track.youtubeId;
    if (!videoId) return;
    // Build the audio graph NOW (this runs inside the user-gesture click
    // that started playback) — creating it later from a non-gesture context
    // leaves the AudioContext suspended and the effects silent.
    ensureGraph();
    // Update UI immediately — resolution can take seconds (or fail), and the
    // player must never show the previous song while the new one plays.
    set({
      current: track,
      currentTime: resumeAt,
      duration: track.duration,
      bufferedEnd: 0,
      isBuffering: true,
      abA: null,
      abB: null,
    });
    syncMediaSession(track, true);
    const seq = ++loadSeq;
    const myFilterSeq = ++filterLoadSeq;
    // Only one source at a time: stop the IFrame engine before the filtered
    // stream takes over, or both play and the effect is inaudible.
    ytEngine.pause();
    getAudio().pause();
    ytResolve(videoId)
      .then((url) => {
        if (seq !== loadSeq || myFilterSeq !== filterLoadSeq) return; // superseded
        if (!url) throw new Error("no stream");
        const audio = getAudio();
        ytEngine.pause();
        audio.src = url;
        audio.playbackRate = get().rate;
        audio.load();
        if (resumeAt > 0) {
          const applyResume = () => {
            audio.currentTime = resumeAt;
            usePlayerStore.setState({ currentTime: resumeAt });
          };
          if (audio.readyState >= 1) applyResume();
          else audio.addEventListener("loadedmetadata", applyResume, { once: true });
        }
        void audio.play().catch(() => undefined);
        set({ current: { ...track, audioUrl: url }, currentTime: resumeAt });
        // Sound now comes from the audio element — make sure the muted video
        // slave (fullscreen + video on) is playing the visuals for THIS track.
        // Without this, the engine stayed parked on the PREVIOUS video's
        // paused frame and the fullscreen player showed a frozen thumbnail.
        syncVideoSlave();
        verifyEffectIsLive(videoId);
      })
      .catch(() => {
        if (seq !== loadSeq) return; // stale
        // Fall back to the unfiltered IFrame engine so playback never dies.
        // Only tell the user the effect failed when one was actually requested;
        // rescue-loads (playViaStream) use this same path without an effect.
        if (forEffect) {
          // Keep the effect SELECTED and keep retrying in the background:
          // the moment any resolver succeeds the song is swapped onto the
          // filtered path automatically. Turning the effect off here (and
          // toasting "unavailable") is what made the EQ look broken.
          toast("Applying effect\u2026", {
            id: "fx-fallback",
            description: "Resolving an audio stream \u2014 it kicks in automatically",
          });
          scheduleEffectRetry(videoId);
        }
        getAudio().pause();
        ytEngine
          .play(videoId, { volume: get().volume, muted: get().muted, startSeconds: resumeAt || undefined })
          .catch(() => {
            set({ isPlaying: false, isBuffering: false, errorNonce: get().errorNonce + 1 });
          });
      });
  };

  const setSleepTimer = (mode: number | "end" | null) => {
    if (sleepCheckInterval) {
      clearInterval(sleepCheckInterval);
      sleepCheckInterval = null;
    }
    if (mode === null) {
      set({ sleepEndsAt: null, sleepAtSongEnd: false });
      return;
    }
    if (mode === "end") {
      set({ sleepAtSongEnd: true, sleepEndsAt: null });
      return;
    }
    const endsAt = Date.now() + mode * 60_000;
    set({ sleepEndsAt: endsAt, sleepAtSongEnd: false });
    sleepCheckInterval = setInterval(() => {
      const s = get();
      if (s.sleepEndsAt !== null && Date.now() >= s.sleepEndsAt) {
        getAudio().pause();
        ytEngine.pause();
        if (sleepCheckInterval) {
          clearInterval(sleepCheckInterval);
          sleepCheckInterval = null;
        }
        set({ sleepEndsAt: null, isPlaying: false });
      }
    }, 1000);
  };

  const setAbPoint = (which: "a" | "b", seconds: number | null) => {
    set(which === "a" ? { abA: seconds } : { abB: seconds });
  };

  const clearAb = () => set({ abA: null, abB: null });

  const setLikeMutation = (fn: LikeMutation | null) => {
    likeMutation = fn;
  };

  const toggleLike = (trackId: string, remote?: RemoteLikeSnapshot) => {
    const s = get();
    const wasLiked = s.liked[trackId] !== undefined;
    const createdAt = Date.now();

    // optimistic flip
    set((state) => {
      const liked = { ...state.liked };
      if (wasLiked) delete liked[trackId];
      else liked[trackId] = createdAt;
      return { liked };
    });

    if (!likeMutation) return;
    likeMutation(trackId, remote)
      .then((nowLiked) => {
        // reconcile with the server's answer
        set((state) => {
          const liked = { ...state.liked };
          if (nowLiked) liked[trackId] = state.liked[trackId] ?? Date.now();
          else delete liked[trackId];
          return { liked };
        });
      })
      .catch(() => {
        // roll back
        set((state) => {
          const liked = { ...state.liked };
          if (wasLiked) liked[trackId] = state.liked[trackId] ?? createdAt;
          else delete liked[trackId];
          return { liked };
        });
      });
  };

  // Moving an EQ slider while a YouTube track plays through the IFrame engine
  // is inaudible, because the IFrame can't be tapped by Web Audio. On the
  // first real change we re-route playback onto the <audio> element so the
  // new EQ is immediately audible (and keep it there for the whole session).
  onEqChange(() => {
    const s = get();
    if (!hasAudioProcessing()) return;
    const t = s.current;
    if (!t?.youtubeId) return;
    const onStream =
      t.audioUrl.includes("audio-proxy") ||
      t.audioUrl.includes("googlevideo") ||
      t.audioUrl.includes("videoplayback") ||
      t.audioUrl.includes("piped") ||
      t.audioUrl.includes("odycdn") ||
      t.audioUrl === "stream";
    if (onStream) return; // already filterable
    ensureGraph();
    void resolveAndPlayWithFilter(t, s.currentTime, false);
  });

  return {
    queue: [],
    queueIndex: -1,
    current: null,
    isPlaying: false,
    isBuffering: false,
    currentTime: 0,
    duration: 0,
    bufferedEnd: 0,
    errorNonce: 0,

    volume: initialVolume,
    muted: initialMuted,
    shuffle: initialShuffle,
    smartShuffle: initialSmartShuffle,
    unshuffledQueue: null,
    unshuffledIndex: -1,
    repeat: initialRepeat,
    rate: initialRate,
    audioFilter: "off",

    autoplay: initialAutoplay,
    toggleAutoplay: () =>
      set((state) => {
        localStorage.setItem("ss.autoplay", state.autoplay ? "0" : "1");
        return { autoplay: !state.autoplay };
      }),

    videoEnabled: initialVideoEnabled,
    toggleVideo: () =>
      set((state) => {
        const next = !state.videoEnabled;
        localStorage.setItem("ss.video", next ? "1" : "0");
        // Starting/stopping video while fullscreen + effect active must
        // start/stop the muted visual slave immediately, not on the next
        // fullscreen open — otherwise toggling video on shows a thumbnail.
        setTimeout(() => syncVideoSlave(), 100);
        return { videoEnabled: next };
      }),

    sleepEndsAt: null,
    sleepAtSongEnd: false,

    abA: null,
    abB: null,

    queueOpen: false,
    fullscreen: false,
    accent: null,

    accentTheme: initialAccentTheme,
    setAccentTheme: (id) =>
      set(() => {
        localStorage.setItem("ss.accentTheme", id);
        return { accentTheme: id };
      }),
    compactMode: initialCompact,
    toggleCompactMode: () =>
      set((state) => {
        localStorage.setItem("ss.compact", state.compactMode ? "0" : "1");
        return { compactMode: !state.compactMode };
      }),
    ambientGlow: initialGlow,
    toggleAmbientGlow: () =>
      set((state) => {
        localStorage.setItem("ss.ambientGlow", state.ambientGlow ? "0" : "1");
        return { ambientGlow: !state.ambientGlow };
      }),
    visualizerEnabled: initialVisualizer,
    toggleVisualizer: () =>
      set((state) => {
        localStorage.setItem("ss.visualizer", state.visualizerEnabled ? "0" : "1");
        return { visualizerEnabled: !state.visualizerEnabled };
      }),
    performanceMode: initialPerformanceMode,
    togglePerformanceMode: () =>
      set((state) => {
        localStorage.setItem("ss.performanceMode", state.performanceMode ? "0" : "1");
        return { performanceMode: !state.performanceMode };
      }),
    pointerEffects: initialPointerEffects,
    togglePointerEffects: () =>
      set((state) => {
        localStorage.setItem("ss.pointerEffects", state.pointerEffects ? "0" : "1");
        return { pointerEffects: !state.pointerEffects };
      }),

    themeMode: localStorage.getItem("ss.themeMode") ?? "dark",
    setThemeMode: (mode) =>
      set(() => {
        localStorage.setItem("ss.themeMode", mode);
        const root = document.documentElement;
        root.classList.toggle("light", mode === "light");
        root.classList.toggle("amoled", mode === "amoled");
        return { themeMode: mode };
      }),

    hideExplicit: localStorage.getItem("ss.hideExplicit") === "1",
    toggleHideExplicit: () =>
      set((state) => {
        localStorage.setItem("ss.hideExplicit", state.hideExplicit ? "0" : "1");
        return { hideExplicit: !state.hideExplicit };
      }),

    liquidGlass: localStorage.getItem("ss.liquidGlass") !== "0",
    cardTransparency: readCardTransparency(),
    setCardTransparency: (value) => {
      const next = applyCardTransparency(value);
      localStorage.setItem(CARD_TRANSPARENCY_KEY, String(next));
      set({ cardTransparency: next });
    },
    toggleLiquidGlass: () =>
      set((state) => {
        const next = !state.liquidGlass;
        localStorage.setItem("ss.liquidGlass", next ? "1" : "0");
        document.documentElement.classList.toggle("no-glass", !next);
        return { liquidGlass: next };
      }),

    hideSidebarEmail: localStorage.getItem("ss.hideSidebarEmail") === "1",
    toggleSidebarCollapsed: () =>
      set((state) => {
        const next = !state.sidebarCollapsed;
        localStorage.setItem("ss.sidebarCollapsed", next ? "1" : "0");
        return { sidebarCollapsed: next };
      }),
    sidebarCollapsed: localStorage.getItem("ss.sidebarCollapsed") === "1",
    toggleHideSidebarEmail: () =>
      set((state) => {
        const next = !state.hideSidebarEmail;
        localStorage.setItem("ss.hideSidebarEmail", next ? "1" : "0");
        return { hideSidebarEmail: next };
      }),

    wallpaper: initialWallpaper,
    wallpaperType: initialWallpaperType,
    setWallpaperType: (type) =>
      set(() => {
        localStorage.setItem("ss.wallpaperType", type);
        return { wallpaperType: type };
      }),
    setWallpaper: (value, type = "image") =>
      set(() => {
        try {
          if (value) localStorage.setItem("ss.wallpaper", value);
          else localStorage.removeItem("ss.wallpaper");
          localStorage.setItem("ss.wallpaperType", type);
        } catch {
          // Keep the current session usable even when browser storage is full.
        }
        return { wallpaper: value, wallpaperType: type };
      }),

    // restore queue from the last session (does not autoplay — user resumes)
    ...(savedQueue
      ? { queue: savedQueue.items, queueIndex: savedQueue.queueIndex }
      : {}),

    history: [],

    liked: {},
    likedLoaded: false,

    likedAlbums: initialLikedAlbums,
    followedArtists: initialFollowedArtists,
    toggleLikedAlbum: (albumId) =>
      set((state) => {
        const next = { ...state.likedAlbums };
        if (next[albumId]) delete next[albumId];
        else next[albumId] = true;
        writeIdSet("ss.likedAlbums", next);
        return { likedAlbums: next };
      }),
    toggleFollowArtist: (artistId) =>
      set((state) => {
        const next = { ...state.followedArtists };
        if (next[artistId]) delete next[artistId];
        else next[artistId] = true;
        writeIdSet("ss.followedArtists", next);
        return { followedArtists: next };
      }),

    playTrack,
    startRadio,
    playViaStream,
    setAudioFilter: setAudioFilterAction,
    playIndex,
    replaceCurrentStream,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleMute,
    toggleShuffle,
    toggleSmartShuffle,
    cycleRepeat,
    setRate,
    setSleepTimer,
    setAbPoint,
    clearAb,
    setQueueOpen: (queueOpen) => set({ queueOpen }),
    setFullscreen: (fullscreen) => {
      set({ fullscreen });
      // Entering/leaving fullscreen with an active effect changes whether the
      // muted video slave should be visible.
      if (fullscreen) {
        // let the video frame mount first
        setTimeout(() => syncVideoSlave(), 400);
      } else if (ytEngine.isSlaveMode()) {
        ytEngine.stopSlave();
      }
    },
    setAccent: (accent) => set({ accent }),
    removeFromQueue: (index) =>
      set((state) => {
        if (index < 0 || index >= state.queue.length) return state;
        const item = state.queue[index];
        if (index === state.queueIndex) return state; // don't remove the playing track
        const queue = state.queue.filter((_, i) => i !== index);
        const queueIndex2 = index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
        lastRemoved = { item, index };
        saveQueue(queue, queueIndex2, state.current?.id ?? null);
        return { queue, queueIndex: queueIndex2 };
      }),
    undoRemoveFromQueue: () => {
      if (!lastRemoved) return;
      const { item, index } = lastRemoved;
      lastRemoved = null;
      set((state) => {
        const i = Math.min(index, state.queue.length);
        const queue = [...state.queue.slice(0, i), item, ...state.queue.slice(i)];
        const queueIndex = i <= state.queueIndex ? state.queueIndex + 1 : state.queueIndex;
        return { queue, queueIndex };
      });
    },
    insertInQueue: (track, index) => {
      const item = norm(track);
      set((state) => {
        const i = Math.max(0, Math.min(index, state.queue.length));
        const queue = [...state.queue.slice(0, i), item, ...state.queue.slice(i)];
        const queueIndex = i <= state.queueIndex ? state.queueIndex + 1 : state.queueIndex;
        saveQueue(queue, queueIndex, state.current?.id ?? null);
        return { queue, queueIndex };
      });
    },
    addToQueue: (track) => {
      const item = norm(track);
      set((state) => {
        const queue = [...state.queue, item];
        saveQueue(queue, state.queueIndex, state.current?.id ?? null);
        return { queue };
      });
    },
    playFromHistory: (index) => {
      const s = get();
      const item = s.history[index];
      if (!item) return;
      set((state) => ({ history: state.history.filter((_, i) => i !== index) }));
      // play it, keeping the rest of the queue intact for "next"
      const queue = [...s.queue];
      const insertAt = Math.max(0, s.queueIndex) + 1;
      queue.splice(insertAt, 0, item);
      set({ queue, queueIndex: insertAt });
      loadTrack(item);
    },
    /**
     * Fill the queue with more songs matching what's playing (same vibe/
     * genre, fetched live). Fire-and-forget: appends as soon as results
     * arrive, without interrupting playback.
     */
    extendQueueWithSimilar: (seed) => {
      const s = get();
      const base = seed ? norm(seed) : s.current;
      if (!base) {
        toast.error("Nothing playing to base recommendations on");
        return;
      }
      toast("Finding songs that match what's playing…");
      void fetchRelatedMix(base, s.queue, 10).then((related) => {
        const state = usePlayerStore.getState();
        const fresh = related.filter((t) => !state.queue.some((q) => q.id === t.id));
        if (fresh.length === 0) {
          toast.error("Couldn't find more songs like this right now");
          return;
        }
        const picks = state.shuffle ? [...fresh].sort(() => Math.random() - 0.5) : fresh;
        usePlayerStore.setState((st) => ({
          queue: [...st.queue, ...picks],
          unshuffledQueue: st.unshuffledQueue ? [...st.unshuffledQueue, ...picks] : null,
        }));
        const after = usePlayerStore.getState();
        saveQueue(after.queue, after.queueIndex, after.current?.id ?? null);
        toast.success(`Added ${picks.length} songs like "${base.title}"`);
      });
    },
    replaceUpcoming: (upcoming) =>
      set((state) => {
        const current = state.queue[state.queueIndex] ?? null;
        const queue = current ? [current, ...upcoming] : [...upcoming];
        saveQueue(queue, current ? 0 : -1, current?.id ?? null);
        return { queue, queueIndex: current ? 0 : -1, current };
      }),
    // Reordering must NOT go through replaceUpcoming: that rebuilds the queue as
    // [current, ...upcoming], which drops every already-played track and resets
    // queueIndex to 0. Splicing the new order into the existing queue keeps
    // history, the current track and the play position intact.
    reorderUpcoming: (upcoming) =>
      set((state) => {
        const start = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
        const liveUpcoming = state.queue.slice(start);
        // The queue panel hands us an order derived from the last render. If a
        // track ended (or the queue changed) between that render and the drop,
        // splicing the stale list in would duplicate and drop tracks, so the
        // reorder is ignored instead of corrupting the queue.
        if (
          liveUpcoming.length !== upcoming.length ||
          liveUpcoming.some((track, i) => track.id !== upcoming[i]?.id)
        ) {
          return {};
        }
        const queue = [...state.queue.slice(0, start), ...upcoming];
        saveQueue(queue, state.queueIndex, state.current?.id ?? null);
        return { queue };
      }),
    clearQueue: () =>
      set((s2) => {
        const queue = s2.current ? [s2.current] : [];
        saveQueue(queue, s2.current ? 0 : -1, s2.current?.id ?? null);
        // The shuffle snapshot has to be dropped too. Keeping it meant that
        // turning shuffle off after a "clear queue" brought the whole removed
        // queue back from the dead.
        return {
          queue,
          queueIndex: s2.current ? 0 : -1,
          current: s2.current,
          unshuffledQueue: null,
          unshuffledIndex: -1,
        };
      }),
    setHistoryRecorder: (fn) => {
      historyRecorder = fn;
    },

    setLiked: (liked) => set({ liked, likedLoaded: true }),
    setLikeMutation,
    toggleLike,
  };
});
