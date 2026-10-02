import { create } from "zustand";
import {
  getAudio,
  getSpareAudio,
  setDeckVolume,
  setDeckMuted,
  setDeckRate,
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
  onActiveDeckChange,
  scheduleCrossfade,
  canCrossfadeNow,
  releaseDeck,
  resetAllDeckGains,
  setDeckGainNow,
  activeDeckSlot,
  spareDeckSlot,
  swapActiveDeck,
  pauseAllDecks,
  AUDIO_FILTERS,
  type AudioFilterId,
} from "@/lib/audio";
import {
  DEFAULT_CROSSFADE,
  DEFAULT_GAPLESS,
  GAPLESS_PRELOAD_LEAD_SECONDS,
  MANUAL_SKIP_FADE_SECONDS,
  shouldStartNow,
  fadeGains,
  normalizeCrossfade,
  planTransition,
  preloadLead,
  shouldStartFade,
  type TransitionPlan,
  type TransitionReason,
} from "@/lib/transition";
import type { RGB } from "@/lib/covers";
import {
  clampIntroSkip,
  DEFAULT_INTRO_TRIM_OPTIONS,
  DEFAULT_MANUAL_INTRO_SKIP,
} from "@/lib/introTrim";
import {
  applyCardTransparency,
  CARD_TRANSPARENCY_KEY,
  readCardTransparency,
} from "@/lib/cardTransparency";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import type { RecoCandidate } from "@/lib/recommend";
import { DEFAULT_EXPLORATION } from "@/lib/recommend";
import * as ytEngine from "@/lib/youtubePlayer";
import {
  cacheStream,
  cleanArtistName,
  cleanTrackTitle,
  getCachedStream,
  type YtItem,
} from "@/lib/youtube";
import { api } from "@/convex/_generated/api";
import { ConvexClient } from "convex/browser";
import { toast } from "sonner";
import { track as trackEvent } from "@/lib/analytics";
import { useAuthGate, type AuthIntent } from "@/store/authGate";

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
const convexSiteUrl = (
  (import.meta.env.VITE_CONVEX_URL as string) ?? ""
).replace(".cloud", ".site");
const audioProxyBase = `${convexSiteUrl}/audio-proxy`;
const resolveYoutubeStream = async (
  videoId: string,
): Promise<string | null> => {
  // EQ-only playback uses the same resolver as preset effects. Start the
  // already-warm YouTube IFrame immediately so the user hears the dry track
  // while the direct stream is being resolved, then swap to Web Audio only
  // after that stream is ready. Initial track loads already start this path
  // in loadTrack, so the current-track guard avoids a duplicate load there.
  if (
    hasAudioProcessing() &&
    usePlayerStore.getState().current?.youtubeId === videoId
  ) {
    const state = usePlayerStore.getState();
    void ytEngine
      .play(videoId, {
        volume: state.volume,
        muted: state.muted,
        startSeconds: state.currentTime || undefined,
      })
      .catch(() => undefined);
  }
  // NOTE: there used to be a browser-side InnerTube attempt here, spoofing an
  // ANDROID_VR / TVHTML5 client to resolve a direct googlevideo URL from the
  // USER's IP so audio effects would survive YouTube's datacenter bot-check.
  // It has been removed because it CANNOT work from a browser, for two
  // structural reasons rather than fixable ones:
  //
  //   1. `https://www.youtube.com/youtubei/v1/player` returns no
  //      `Access-Control-Allow-Origin` at all, and answers the preflight with
  //      403. Verified directly against the live endpoint rather than assumed:
  //      an OPTIONS request carrying an Origin returns 403 and not one
  //      `access-control-*` header.
  //   2. `User-Agent` is a FORBIDDEN header name, so `fetch` silently dropped
  //      the one header the client-spoofing depended on. It never reached the
  //      network wearing the identity it was pretending to have.
  //
  // So it never returned a URL, and all it actually produced was two CORS
  // errors in the console on every single play, alongside a comment claiming
  // resolution ran from the user's IP. The two resolvers below are the real
  // paths, and they are unchanged.
  try {
    ytResolveClient =
      ytResolveClient ??
      new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    // Network-aware quality: prefer a lighter stream when the connection is poor.
    type NetInfo = { effectiveType?: string };
    const net = (navigator as Navigator & { connection?: NetInfo }).connection;
    const slow =
      net?.effectiveType === "2g" ||
      net?.effectiveType === "slow-2g" ||
      net?.effectiveType === "3g";
    const res = await ytResolveClient.action(api.youtube.resolveStream, {
      videoId,
      quality: slow ? "low" : "high",
    });
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
        const res = await fetch(`${base}/streams/${videoId}`, {
          signal: ctrl.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) continue;
        const data = (await res.json()) as {
          audioStreams?: { url: string; bitrate?: number; mimeType?: string }[];
          videoStreams?: {
            url: string;
            quality?: string;
            videoOnly?: boolean;
            mimeType?: string;
          }[];
        };
        // Preferred: dedicated audio-only streams (best quality).
        const audioStreams = (data.audioStreams ?? [])
          .filter(
            (s) => !!s.url && (!s.mimeType || s.mimeType.includes("audio")),
          )
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
              (!s.mimeType ||
                s.mimeType.includes("mp4") ||
                s.mimeType.includes("webm")),
          )
          .sort(
            (a, b) =>
              (parseInt(a.quality ?? "0", 10) || 9999) -
              (parseInt(b.quality ?? "0", 10) || 9999),
          );
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

/** How a play was started. Mirrors the engine's `PlaySignal["origin"]`. */
export type PlayOrigin = "user" | "autoplay" | "recommendation" | "radio";

/**
 * Metadata handed to the play recorder alongside the id.
 *
 * The recorder used to re-read `current` from the store to build this, but
 * `loadTrack` calls it BEFORE committing the new track — so the lookup always
 * returned the PREVIOUS song and every remote history row was stored with no
 * title, artist or cover. Without an artist the recommendation engine has no
 * affinity signal at all, so the snapshot is passed in explicitly now.
 */
export interface HistoryMeta {
  source?: string;
  title?: string;
  artistName?: string;
  coverUrl?: string;
  duration?: number;
  albumName?: string;
  origin?: PlayOrigin;
}

export type HistoryRecorder = (trackId: string, meta?: HistoryMeta) => void;

/**
 * Bridge to the recommendation backend (wired to Convex in AppShell).
 *
 * Every method is optional and every call site is wrapped in try/catch: signal
 * recording is observability, and losing it must never interrupt playback.
 */
export interface SignalBridge {
  /**
   * Record that a play started. Returns (or resolves to) the server-side
   * `startedAt` for that exact play, which is what lets the matching
   * engagement outcome be attached to the right row.
   */
  playStart(args: {
    trackId: string;
    meta: HistoryMeta;
  }): number | Promise<number> | void;
  /** The play ended, or was skipped part-way. */
  engage(args: {
    trackId: string;
    startedAt: number;
    completion: number;
    listenedSeconds: number;
    skipped: boolean;
  }): void;
  /** The listener deleted an automatically generated track from the queue. */
  removal(args: { trackId: string }): void;
  /** Something happened to a recommendation (played / liked / queued). */
  feedback(args: {
    trackId: string;
    outcome: string;
    section?: string;
    reason?: string;
    origin?: PlayOrigin;
    title?: string;
    artistName?: string;
    albumName?: string;
  }): void;
}

let signalBridge: SignalBridge | null = null;

/** Pending outcome for the track that is currently playing. */
interface EngagementSession {
  trackId: string;
  origin: PlayOrigin;
  /** Seconds of the track already behind us when playback began (resume). */
  startOffset: number;
  /** Server-side id of the play row, filled in once the start is confirmed. */
  startedAt: number;
}

let engagement: EngagementSession | null = null;
/** Origin applied to the NEXT loadTrack call. */
let pendingOrigin: PlayOrigin = "user";

/**
 * Close out the current play: how much was heard, and whether it was a skip.
 *
 * Called when the track ends (a completion) and when another track takes over
 * (a skip). Clearing `engagement` first means the second call is a no-op, so a
 * track that ends and then advances cannot be recorded twice.
 */
function settleEngagement(reason: "ended" | "changed"): void {
  const session = engagement;
  if (!session) return;
  engagement = null;

  const bridge = signalBridge;
  if (!bridge || !session.startedAt) return;

  try {
    const s = usePlayerStore.getState();
    const duration =
      s.current && s.current.id === session.trackId
        ? s.current.duration
        : s.duration;
    const position =
      s.current && s.current.id === session.trackId
        ? s.currentTime
        : s.currentTime;
    const heard = Math.max(0, position - session.startOffset);
    if (duration <= 0) return;
    const completion = Math.min(1, heard / duration);
    // "ended" is authoritative; "changed" is a skip unless the listener had
    // already heard most of the track, in which case it is a weak signal at
    // most. A single skip must never look like a rejection of the whole artist.
    const skipped = reason === "changed" && completion < 0.7;
    bridge.engage({
      trackId: session.trackId,
      startedAt: session.startedAt,
      completion,
      listenedSeconds: heard,
      skipped,
    });
  } catch {
    /* signal recording must never throw into playback */
  }
}

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

  /**
   * Crossfade length in seconds; 0 disables it. Persisted locally as
   * `ss.crossfade` and applied only when both songs can play through the
   * <audio> element — the YouTube IFrame engine cannot be routed through Web
   * Audio, so those tracks fall back to gapless playback.
   */
  crossfade: number;
  setCrossfade: (seconds: number) => void;
  /**
   * Gapless playback: start the next track the moment the current one stops
   * instead of leaving a beat of silence while the next track loads.
   */
  gapless: boolean;
  toggleGapless: () => void;

  /**
   * Smart intro trim: while the first seconds of a track play, watch the
   * signal level and seek past a silent/quiet lead-in.
   */
  introTrim: boolean;
  /**
   * Seconds of lead-in skipped on the CURRENT track, or null when nothing has
   * been trimmed yet. Drives the "trimmed / undo" chip in the player bar.
   */
  introTrimSkipped: number | null;

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
  /**
   * Endless "radio" mode. While it is on the queue is topped up forever, so
   * playback never stops at the end of a list.
   */
  radioActive: boolean;
  /** What the current radio was seeded from, shown as a label in the UI. */
  radioSource: string | null;

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
  playTrack: (track: Playable, list?: Playable[]) => void;
  /**
   * Play an explicit list in exactly the order given, ignoring the global
   * shuffle preference AND leaving it untouched.
   *
   * The page-level "Shuffle all" buttons used to reach for the global shuffle
   * switch instead of ordering their own list. That turned a one-off action
   * into a sticky app-wide preference: one press of "Shuffle all" left shuffle
   * on forever, so the plain "Play all" button next to it played in random
   * order, and the transport's shuffle button lit up to prove it.
   */
  playListOrdered: (track: Playable, list: Playable[]) => void;
  /** Start an endless related-mix radio from any track (any source). */
  startRadio: (track: Playable, contextQuery?: string) => void;
  /**
   * Start endless radio seeded by a playlist (Spotify's "playlist radio"):
   * the playlist plays first, then similar music keeps coming.
   */
  startPlaylistRadio: (tracks: Playable[], label: string) => void;
  /** Leave radio mode; the queue goes back to behaving like a finite list. */
  stopRadio: () => void;
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
  /** Transport-button shuffle: off -> shuffle -> smart shuffle -> off. */
  cycleShuffle: () => void;
  /** Turn shuffle on without cycling, for the page-level shuffle actions. */
  startShuffle: () => void;
  toggleSmartShuffle: () => void;
  /**
   * How adventurous recommendations should be, 0..100. 0 stays inside what
   * the listener already plays; 100 pushes unfamiliar music harder.
   */
  exploration: number;
  setExploration: (value: number) => void;
  cycleRepeat: () => void;
  setRate: (rate: number) => void;
  setAudioFilter: (id: AudioFilterId) => void;
  /** minutes, "end" (after current song) or null to cancel */
  setSleepTimer: (mode: number | "end" | null) => void;
  /** Turn smart intro trim on/off. Persisted like every other preference. */
  toggleIntroTrim: () => void;
  /**
   * Seek past a lead-in now. With no argument it uses the default manual
   * skip; the automatic probe calls this once it has decided. Returns the
   * seconds actually skipped, or 0 when nothing was skipped.
   */
  skipIntro: (seconds?: number) => number;
  /** Undo a trim on the current track by seeking back to the start. */
  undoIntroTrim: () => void;
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
  /**
   * Move tracks within the "up next" part of the queue.
   *
   * `base` is the list the caller rendered; it is what proves the reorder is
   * not acting on a queue that has since changed. See the implementation.
   */
  reorderUpcoming: (upcoming: Playable[], base: Playable[]) => void;
  clearQueue: () => void;
  /**
   * Wipe the listening session: stop both decks, stop the YouTube engine,
   * drop the queue, history and the persisted queue.
   *
   * Called when signing out or switching accounts. Without it a shared
   * device hands the next person the previous listener's queue, their
   * half-played song and their recently-played list — which is exactly the
   * kind of cross-account leak this app refuses to do anywhere else.
   */
  resetForSignOut: () => void;
  /**
   * Drop every repeat from the queue, keeping the first occurrence. Returns
   * how many entries went, so the UI can say "removed 3 repeats" instead of
   * silently reshuffling a list the user was reading.
   */
  removeQueueDuplicates: () => number;
  /**
   * Forget what has already been played, keeping the current track at the
   * head of the queue. Returns how many history entries went.
   */
  clearPlayedTracks: () => number;
  /** Randomize only the "playing next" list; what is playing never moves. */
  shuffleUpcoming: () => void;
  /**
   * Attach the recommendation signal bridge (play starts, engagement
   * outcomes, queue removals, feedback). Null detaches it.
   *
   * This is the ONLY writer of play history: the old `setHistoryRecorder`
   * hook is kept for compatibility but SYNQ no longer installs one, because
   * two writers would create two history rows for every play.
   */
  setSignalBridge: (bridge: SignalBridge | null) => void;
  setHistoryRecorder: (fn: HistoryRecorder | null) => void;
  /** Origin applied to the next track the store loads. */
  setPendingOrigin: (origin: PlayOrigin) => void;

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

/**
 * Storage writes must never break a control.
 *
 * `localStorage.setItem` throws outright when storage is blocked (private
 * browsing, disabled cookies) or full. Every one of these calls sits inside a
 * zustand setter, so a throw skipped the `set(...)` that follows it: the
 * volume slider, mute, repeat, shuffle and the whole settings dialog would
 * silently do nothing, and settings that mutate the DOM before persisting
 * would visibly desync. Swallowing the failure keeps the session usable —
 * the same trade-off the wallpaper and history writers already make.
 */
function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable or full */
  }
}

function removeSetting(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

/** Shrink a Playable to its storable essence. */
const persistPlayable = (p: Playable): PersistedPlayable => ({
  id: p.id,
  youtubeId: p.youtubeId,
  title: p.title,
  artistName: p.artistName,
  coverUrl: p.coverUrl,
  duration: p.duration,
});

/**
 * The snapshot stored inside a deferred-auth intent.
 *
 * Deliberately NOT `persistPlayable`. That one is for the saved queue, which
 * only needs enough to rebuild an entry and always re-resolves the audio URL
 * later. A deferred intent has to be able to START playback on its own after
 * an OAuth round-trip has destroyed every in-memory object, so it carries the
 * full playable shape: `audioUrl`, `source` and `albumName` are all load-
 * bearing here and dropping any of them produces a track that resolves to
 * silence. Everything in it is JSON-safe by construction.
 */
type IntentPlayable = Playable;

const intentPlayable = (p: Playable): IntentPlayable => ({
  id: p.id,
  title: p.title,
  artistName: p.artistName,
  albumName: p.albumName ?? "",
  coverUrl: p.coverUrl ?? "",
  audioUrl: p.audioUrl,
  duration: p.duration ?? 0,
  source: "youtube",
  ...(p.youtubeId ? { youtubeId: p.youtubeId } : {}),
});

function saveQueue(
  queue: Playable[],
  queueIndex: number,
  currentId: string | null,
): void {
  try {
    // Keep the CURRENT track plus what follows rather than the head of the
    // list. A radio session appends for as long as it runs, so the head is
    // routinely dozens of tracks stale — persisting it restored a queue
    // pointing at an unrelated old song.
    const start = Math.max(0, Math.min(queueIndex, queue.length - 60));
    writeSetting(
      QUEUE_KEY,
      JSON.stringify({
        items: queue.slice(start, start + 60).map(persistPlayable),
        queueIndex: queueIndex - start,
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
const initialCrossfade = normalizeCrossfade(
  readNum("ss.crossfade", DEFAULT_CROSSFADE),
);
const initialGapless = readBool("ss.gapless", DEFAULT_GAPLESS);

/**
 * Discovery-vs-familiarity preference for recommendations, 0..100.
 *
 * Stored on the device rather than in the database: it is a listening
 * preference, not listening history, and there is no reason to copy it to a
 * server. `DEFAULT_EXPLORATION` is the balanced position, which is also what a
 * listener who never touches the slider gets.
 */
const EXPLORATION_KEY = "ss.exploration";
const initialExploration = readExploration();

function readExploration(): number {
  try {
    const raw = Number(window.localStorage.getItem(EXPLORATION_KEY));
    if (!Number.isFinite(raw)) return DEFAULT_EXPLORATION;
    return Math.min(100, Math.max(0, Math.round(raw)));
  } catch {
    return DEFAULT_EXPLORATION;
  }
}
const initialIntroTrim = readBool("ss.introTrim", false);
// Validated rather than cast: the repeat button shows itself as ACTIVE for
// any value other than "off", while `handleEnded` only ever acts on the exact
// strings "all" and "one". A stale or hand-edited value therefore lit the
// button up and then behaved as if repeat was off — the one state where the
// UI and the playback logic disagree.
const storedRepeat = localStorage.getItem("ss.repeat");
const initialRepeat: RepeatMode =
  storedRepeat === "all" || storedRepeat === "one" ? storedRepeat : "off";
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
const initialWallpaperType =
  localStorage.getItem("ss.wallpaperType") === "video" ? "video" : "image";
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
    writeSetting(key, JSON.stringify(Object.keys(set)));
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
    const map = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "{}") as Record<
      string,
      { t: number; at: number }
    >;
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
  const entries = Object.entries(map)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, 50);
  writeSetting(RESUME_KEY, JSON.stringify(Object.fromEntries(entries)));
}

function getResumePosition(id: string, duration: number): number {
  if (duration < RESUME_MIN_DURATION) return 0;
  const hit = readResumeMap()[id];
  if (!hit) return 0;
  // only resume if meaningfully into the track and not basically finished
  if (hit.t < 10 || (duration > 0 && hit.t > duration - 20)) return 0;
  return hit.t;
}

/**
 * Forget a track's saved position, so it stops appearing in "Continue
 * listening".
 *
 * Deliberately narrow: it clears the RESUME POSITION and nothing else. The
 * play history entry, the listening stats and the recommendation signals all
 * stay exactly where they were, because "stop showing me this in one shelf" is
 * not "pretend I never played it". Forgetting history would also quietly
 * corrupt the recommendation engine, which reads those signals.
 *
 * The shelf reappears for a track played again, because a new position is
 * then saved. That is the honest behaviour: the listener chose to come back to
 * it, so the app should offer it again.
 *
 * Returns true when something was actually removed, so a caller can report
 * honestly rather than claiming success for a no-op.
 */
export function forgetResumePosition(id: string): boolean {
  try {
    const key = id.trim();
    if (!key) return false;
    const map = readResumeMap();
    if (!(key in map)) return false;
    delete map[key];
    writeSetting(RESUME_KEY, JSON.stringify(map));
    return true;
  } catch {
    // Storage unavailable (private browsing). The card will simply still be
    // there, which is recoverable; throwing would break the menu instead.
    return false;
  }
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
function pickShuffleIndex(
  queueLen: number,
  currentIndex: number,
  smart: boolean,
): number {
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
  /**
   * The durable "recently played" record. Only `"youtube"` is possible now
   * that Jamendo is a discovery index rather than a playback source, so
   * restoring history can no longer mislabel a track as one that plays
   * through the `<audio>` element.
   */
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
    writeSetting(LAST_PLAYED_KEY, JSON.stringify(snap));
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
    writeSetting(HISTORY_KEY, JSON.stringify(next));
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
    removeSetting(HISTORY_KEY);
    removeSetting(LAST_PLAYED_KEY);
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
    writeSetting(HISTORY_KEY, JSON.stringify(next));
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
  // When the sound comes from the <audio> element (any active effect or EQ)
  // the IFrame is NOT the source. Restarting the IFrame there left the
  // element sitting at the end of the song while a second, dry copy of the
  // track started playing on top of it — "repeat one" then either did nothing
  // or came back as two overlapping copies with the effect inaudible.
  if (s.current && audioElementIsSource(s.current)) {
    const audio = getAudio();
    usePlayerStore.setState({ currentTime: 0, isBuffering: false });
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
    syncMediaSession(s.current, true);
    return;
  }
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
  void getAudio()
    .play()
    .catch(() => undefined);
}

/** In-flight related-mix fetch, deduped per seed so track-end doesn't double-fire. */
let relatedMixInFlight: {
  seedId: string;
  promise: Promise<Playable[]>;
} | null = null;

/** Tracks already played in this session — related mixes must never repeat them. */
const playedSessionIds = new Set<string>();

/**
 * Ask the recommendation engine for the next track.
 *
 * This is the SAME engine that powers Home, so "what plays next" and the Home
 * rows can never drift apart. The call is wrapped in a timeout and resolves to
 * null on ANY failure: a slow, empty or broken recommendation must fall through
 * to the existing related-mix path rather than stall the music.
 *
 * How long autoplay waits for it at the end of the queue before falling
 * through to the related mix.
 *
 * This is pure SILENCE: the current song has ended and nothing is playing
 * while this promise is outstanding, so the number is a gap in the music, not
 * a background timeout. It used to be 2500ms, which meant a stalled or slow
 * recommendation produced two and a half seconds of dead air between songs. The
 * engine answers in well under a second when it is warm and healthy, so a short
 * leash keeps the good path and only sacrifices the pathological one — and the
 * related mix that takes over is instant.
 */
const PERSONAL_NEXT_TIMEOUT_MS = 900;

async function fetchPersonalNext(
  seed: Playable,
  queueIds: string[],
): Promise<Playable | null> {
  try {
    ytSearchClient =
      ytSearchClient ??
      new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    const client = ytSearchClient as ConvexClient;
    const call = client.action(api.recommend.nextTrack, {
      queueIds,
      currentTrack: {
        id: seed.id,
        title: seed.title,
        artist: seed.artistName,
        duration: seed.duration,
        thumbnail: seed.coverUrl,
        ...(seed.albumName ? { album: seed.albumName } : {}),
      },
      autoplay: true,
      limit: 1,
      // Autoplay honours the same discovery-vs-familiarity preference as the
      // Home shelves, so "what plays next" can never quietly disagree with what
      // the listener was just shown.
      exploration: usePlayerStore.getState().exploration,
    }) as Promise<{ track: RecoCandidate | null }>;

    const result = await Promise.race([
      call,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), PERSONAL_NEXT_TIMEOUT_MS),
      ),
    ]);
    const picked = result?.track;
    if (!picked || !picked.id) return null;
    if (queueIds.includes(picked.id)) return null;
    if (picked.id === seed.id) return null;
    return {
      id: picked.id,
      title: cleanTrackTitle(picked.title),
      artistName: cleanArtistName(picked.artist, picked.title),
      albumName: picked.album ?? "",
      coverUrl: picked.thumbnail,
      audioUrl: "",
      duration: picked.duration,
      source: "youtube" as const,
      youtubeId: picked.id,
      // Tag it: an automatically generated suggestion stays distinguishable
      // from a track the listener queued themselves.
      queueOrigin: "autoplay",
    };
  } catch {
    return null;
  }
}

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
  "pop",
  "rock",
  "hip hop",
  "rap",
  "r&b",
  "soul",
  "funk",
  "jazz",
  "blues",
  "electronic",
  "edm",
  "house",
  "techno",
  "trance",
  "dubstep",
  "drum and bass",
  "ambient",
  "lofi",
  "lo-fi",
  "chill",
  "classical",
  "country",
  "folk",
  "indie",
  "alternative",
  "metal",
  "punk",
  "reggae",
  "latin",
  "afrobeats",
  "k-pop",
  "kpop",
  "j-pop",
  "disco",
  "synthwave",
  "vaporwave",
  "gospel",
  "acoustic",
  "dance",
  "disco",
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
    .replace(
      /\b(songs?|music|track|playlist|video|official|lyrics?|lyric video|remix|mix|edit|full album|top|best|popular|new|2024|2025|2026|hit|hits|vibe|mood|playlist)\b/g,
      " ",
    )
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
 * The dominant genre across a playlist's tracks, used as the radio's mix
 * context. A single seed track is a weak signal — one ballad in an otherwise
 * dance playlist would pull the whole radio off-genre.
 */
function playlistMixContext(tracks: Playable[]): string | null {
  const tally = new Map<string, number>();
  for (const t of tracks) {
    const g = inferGenre(t);
    if (g) tally.set(g, (tally.get(g) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [genre, count] of tally) {
    if (count > bestCount) {
      best = genre;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Fetch a related-mix from YouTube Music based on the seed track's GENRE.
 * Returns Playables ready for the queue (empty on failure).
 */ async function fetchRelatedMix(
  seed: Playable,
  existingQueue: Playable[],
  count: number,
  contextQuery?: string | null,
): Promise<Playable[]> {
  if (relatedMixInFlight?.seedId === seed.id) return relatedMixInFlight.promise;
  const promise = (async () => {
    try {
      ytSearchClient =
        ytSearchClient ??
        new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
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
      const pick = () =>
        songQueries[Math.floor(Math.random() * songQueries.length)];
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
      const [items1, items2] = await Promise.all([
        searchOnce(q1),
        searchOnce(q2),
      ]);
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
      const normTitle = (s: string) =>
        s
          .toLowerCase()
          .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
          .replace(/[^a-z0-9]/g, "");
      const seenTitles = new Set(existingQueue.map((t) => normTitle(t.title)));
      const seedTitle = normTitle(seed.title);
      const out: Playable[] = [];
      const normArtist = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
        if (seedArtist && thisArtist === seedArtist && out.length >= 2)
          continue;
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
  void promise
    .then((r: Playable[]) => {
      if (r.length === 0 && relatedMixInFlight?.promise === promise)
        relatedMixInFlight = null;
    })
    .catch(() => {
      if (relatedMixInFlight?.promise === promise) relatedMixInFlight = null;
    });
  return promise;
}

/** Shared auto-advance logic for both engines. */
/**
 * The part of end-of-track handling that actually moves the queue on.
 *
 * Split out of `handleEnded` so a blend that deferred the outgoing track's
 * `ended` can hand the boundary back here if it is abandoned — otherwise that
 * swallowed event has no owner and the listener is left in silence.
 */
function completeEndedTrack(): void {
  const s = usePlayerStore.getState();

  // sleep timer "stop after this song"
  if (s.sleepAtSongEnd) {
    // Both decks: a blend may have the incoming song audible already.
    cancelTransition("sleep-end");
    pauseAllDecks();
    ytEngine.pause();
    usePlayerStore.setState({ isPlaying: false, sleepAtSongEnd: false });
    return;
  }

  if (s.repeat === "one") {
    cancelTransition("repeat-one");
    restartCurrent();
    return;
  }
  // The track reached its end, so this is a completion, not a skip. Recorded
  // BEFORE the gapless hand-off, which swaps `current` out from under the
  // measurement — doing it afterwards recorded the finished track against the
  // NEXT track's position, which is both the wrong completion percentage and a
  // false "skipped" flag in the recommendation signals.
  settleEngagement("ended");

  // Gapless: if the next track is already resolved and buffered on the spare
  // deck, start it HERE rather than tearing the advance down and letting the
  // loader resolve the stream from scratch inside the gap.
  if (tryGaplessHandoff()) return;

  // A transition was armed but never completed (the incoming track would not
  // load, the listener skipped, the graph went away). Discard it and advance
  // normally — the failure path must still play the next song.
  cancelTransition("ended");
  if (s.queue.length > 0) {
    // Shuffle ON: jump to a RANDOM upcoming track, not the next in line.
    // Ungated, for the same reason as the ordered advance below.
    if (s.shuffle && s.queue.length > 1) {
      autoAdvanceToIndex?.(
        pickShuffleIndex(s.queue.length, s.queueIndex, s.smartShuffle),
      );
      return;
    }
    // Normal: advance in order. UNGATED: this is a track finishing, not a
    // request to start playback.
    if (s.queueIndex < s.queue.length - 1) {
      autoAdvanceToIndex?.(s.queueIndex + 1);
      return;
    }
    if (s.repeat === "all") {
      autoAdvanceToIndex?.(0);
      return;
    }
  }
  // End of queue, repeat off — autoplay. The queue is only exhausted here, so
  // every manually queued track has already been consumed and none can be
  // reordered or overwritten: the listener's queue always wins by
  // construction.
  if ((s.autoplay || s.radioActive) && s.current) {
    const seed = s.current;
    const queueIds = s.queue.map((q) => q.id);

    // PERSONALISED first, via the shared recommendation engine. Any failure
    // (offline, empty candidate pool, a broken request) falls through to the
    // existing genre/artist related mix, so the music never stops.
    void fetchPersonalNext(seed, queueIds)
      .then((picked) => {
        const state = usePlayerStore.getState();
        if (picked && state.current?.id === seed.id) {
          pendingOrigin = s.radioActive ? "radio" : "autoplay";
          signalBridge?.feedback({
            trackId: picked.id,
            outcome: "queued",
            section: "autoplay",
            origin: pendingOrigin,
            title: picked.title,
            artistName: picked.artistName,
            ...(picked.albumName ? { albumName: picked.albumName } : {}),
          });
          usePlayerStore.setState((st) => ({
            queue: [...st.queue, picked],
            unshuffledQueue: st.unshuffledQueue
              ? [...st.unshuffledQueue, picked]
              : null,
          }));
          const after = usePlayerStore.getState();
          saveQueue(after.queue, after.queueIndex, after.current?.id ?? null);
          if (after.current?.id === seed.id) {
            autoAdvanceToIndex?.(after.queue.length - 1);
          }
          return;
        }
        return null;
      })
      .then((result) => {
        if (result !== null) return;
        // PERSONALISED produced nothing usable — RELATED fallback.
        return fetchRelatedMix(seed, s.queue, 5, activeMixContext);
      })
      .then((related) => {
        if (!related) return;
        // Filter INSIDE the updater: maybeAutofillQueue may have appended the
        // same related mix while this fetch was in flight — filtering against a
        // stale queue snapshot used to double-append the same tracks.
        let appended = 0;
        usePlayerStore.setState((st) => {
          const fresh = related.filter(
            (t) => !st.queue.some((q) => q.id === t.id),
          );
          if (fresh.length === 0) return st;
          appended = fresh.length;
          return { queue: [...st.queue, ...fresh] };
        });
        // Count what was ACTUALLY appended. `related.length` overcounts whenever
        // some of the mix was already queued, and advancing by
        // `queue.length - related.length` then started the wrong track — or, if
        // every track was a duplicate, jumped to a random earlier one.
        if (appended === 0) return;
        // Only auto-advance if nothing else started playing meanwhile.
        const after = usePlayerStore.getState();
        if (after.current?.id === seed.id && !after.isPlaying) {
          autoAdvanceToIndex?.(after.queue.length - appended);
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
 * The outgoing element reached its natural end while a blend owned that
 * boundary. Do nothing here — the blend is finishing right now, and
 * `finishTransition` commits the advance.
 *
 * THIS IS THE FIX FOR THE RACE THAT MADE CROSSFADE INAUDIBLE.
 *
 * A 6s crossfade on a 240s track starts at 234s and its automation finishes at
 * ~240s — the same instant the outgoing element fires `ended`. `ended` arrives
 * first (the blend's own completion is polled ~120ms later), and treating it as
 * "a transition failed" made the old handler:
 *
 *   1. cancel the transition mid-flight,
 *   2. call `resetAllDeckGains()`, which forces the INCOMING deck — already
 *      playing, mid-fade — back to gain 1, and
 *   3. advance the queue onto the track AFTER the one that had been fading in.
 *
 * The result on every single crossfade was two songs at once, the fading-in one
 * orphaned at full volume, and the store pointing at a track nobody had heard.
 * Deferring the event is what makes the blend the authority on its own
 * boundary; `recoverDeferredAdvance` is the safety net if it then fails.
 */
function handleEnded(): void {
  const t = transition;

  if (t?.running) {
    t.endedSeen = true;
    traceTransition("ended-deferred", { mode: t.plan.mode, to: t.track.title });
    return;
  }
  // A crossfade that already committed advanced the queue itself.
  if (t?.committed) {
    transition = null;
    resetAllDeckGains();
    return;
  }
  completeEndedTrack();
}

/**
 * Re-run the end-of-track advance that `handleEnded` deferred, when the blend
 * it was deferred for has been abandoned.
 *
 * Guarded twice over: once per transition, and once against the store, because
 * a manual Next pressed in the meantime may already have advanced normally and
 * two advances would skip a track.
 */
function recoverDeferredAdvance(t: NonNullable<typeof transition>): void {
  if (t.advanceRecovered) return;
  t.advanceRecovered = true;
  const s = usePlayerStore.getState();
  if (t.outgoingId && s.current && s.current.id !== t.outgoingId) return;
  traceTransition("recover-deferred-advance", { outgoing: t.outgoingId });
  completeEndedTrack();
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
  if (
    !track ||
    typeof window === "undefined" ||
    prefetchedTrackIds.has(track.id)
  )
    return;
  prefetchedTrackIds.add(track.id);

  // Next-track preparation. This runs AFTER the current track has already been
  // handed to an engine, so it is off the critical click path and no longer
  // needs to be deferred behind a timer — the 250ms `setTimeout` it used to sit
  // in only delayed the warm-up, and on a fast track change that was a real,
  // audible gap before the next song had anything prepared.
  if (track.coverUrl) {
    const image = new Image();
    image.decoding = "async";
    image.src = track.coverUrl;
  }
  if (track.youtubeId) {
    const thumbnail = new Image();
    thumbnail.decoding = "async";
    thumbnail.src = `https://i.ytimg.com/vi/${track.youtubeId}/hqdefault.jpg`;
    // Resolve the direct audio stream NOW, while this track is still playing,
    // rather than on the click. `ytResolve` is cached per video id, so by the
    // time the listener reaches this song the stream URL is already known and
    // the EQ / effect / rescue paths can start the <audio> element on their
    // first frame instead of waiting a network round trip for the resolver.
    // Fire-and-forget: a failure just means the next load resolves normally.
    void ytResolve(track.youtubeId).catch(() => undefined);
  }
  if (!track.youtubeId && /^https?:/.test(track.audioUrl)) {
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = track.audioUrl;
    audio.load();
    window.setTimeout(() => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }, 15_000);
  }
}

// --- song transitions (crossfade + gapless) ----------------------------------

/**
 * Development-only transition tracing.
 *
 * The transition path has too many ways to fail silently — the graph is
 * suspended, the spare deck never got a source, the resolver returned nothing,
 * the incoming element refused to start — and every one of those used to look
 * identical from the UI: no crossfade, no error, no explanation. This prints
 * the decision and the outcome for each one.
 *
 * Gated on `import.meta.env.DEV` so it is compiled out of production builds
 * rather than left to be filtered at runtime.
 */ const traceTransition = import.meta.env.DEV
  ? (event: string, detail?: Record<string, unknown>): void => {
      const parts = Object.entries(detail ?? {}).map(
        ([k, v]) =>
          `${k}=${typeof v === "number" ? Number(v.toFixed(2)) : String(v)}`,
      );
      console.info(`[SYNQ:transition] ${event}`, ...parts);
    }
  : (): void => {};

/**
 * The transition currently in flight, if any.
 *
 * `armed` is set once the next track has been decided and its stream is being
 * prepared; `running` is set from the moment the incoming element is asked to
 * play until the blend has finished and the decks have swapped. Both flags
 * exist to guarantee the thing the spec calls out as non-negotiable: only ONE
 * intended audible transition at a time. Every entry point checks them, and
 * the "rapid Next presses" case simply falls through to normal playback rather
 * than stacking a second blend on top of the first.
 */
let transition: {
  plan: TransitionPlan;
  index: number;
  track: Playable;
  armed: boolean;
  running: boolean;
  /** Seconds remaining at the previous poll, used to fire the fade exactly once. */
  lastRemaining: number | null;
  /** Set once the incoming element is confirmed audible. */
  committed: boolean;
  /** True once the incoming element has actually been asked to play. */
  incomingStarted: boolean;
  /** Track id currently loaded onto the spare deck, if any. */
  preparedFor: string | null;
  /**
   * The outgoing track reached its natural end WHILE this blend was running.
   *
   * A crossfade ends exactly when the outgoing track does, so `ended` and
   * "blend finished" land within milliseconds of each other. `ended` arrives
   * first, and acting on it there cancelled the blend mid-flight. See
   * `handleEnded`.
   */
  endedSeen: boolean;
  /** The track that was playing when this transition was armed. */
  outgoingId: string | null;
  /** The element a blend has already started playing, if any. */
  incomingEl: HTMLAudioElement | null;
  incomingSlot: "a" | "b" | null;
  /** Set once an abandoned blend has recovered its deferred advance. */
  advanceRecovered: boolean;
} | null = null;

/**
 * Cancel a pending or running transition and put the decks back to normal.
 *
 * If a blend had already started the incoming element, that element is
 * STOPPED here rather than merely un-faded.
 *
 * This matters more than it looks. `resetAllDeckGains()` on its own sets BOTH
 * decks to unity, so a transition abandoned after `incoming.play()` had already
 * resolved left the incoming song playing at FULL VOLUME alongside the outgoing
 * one. Every path that cancels mid-blend — seek, Next, clearing the queue,
 * switching repeat mode, changing the crossfade length — hit that: the listener
 * got two songs at once and no way to stop the second one.
 */
function cancelTransition(why: string): void {
  if (!transition) return;
  const t = transition;
  if (why) t.armed = false;
  transition = null;
  if (t.incomingStarted) {
    try {
      t.incomingEl?.pause();
    } catch {
      /* ignore */
    }
  }
  resetAllDeckGains();
}

/**
 * Work out which track plays next WITHOUT consuming it.
 *
 * This mirrors `handleEnded` exactly — shuffle, repeat-all, end of queue — but
 * it must agree with it, or a transition would fade into one song and the
 * advance would start another. Returning null at the end of the queue is
 * deliberate: at that point the next track may be an autoplay recommendation
 * that has not been fetched yet, and guessing would be worse than waiting.
 */
function peekNextTrack(): { track: Playable; index: number } | null {
  const s = usePlayerStore.getState();
  if (s.queue.length === 0 || s.queueIndex < 0) return null;
  let index: number;
  if (s.shuffle && s.queue.length > 1) {
    index = pickShuffleIndex(s.queue.length, s.queueIndex, s.smartShuffle);
  } else if (s.queueIndex < s.queue.length - 1) {
    index = s.queueIndex + 1;
  } else if (s.repeat === "all") {
    index = 0;
  } else {
    return null; // end of queue — autoplay may still fetch something
  }
  const track = s.queue[index];
  if (!track || track.id === s.current?.id) return null;
  return { track, index };
}

/**
 * Can BOTH of these songs be played through an <audio> element at once?
 *
 * This is the honest gate for a real crossfade. The YouTube IFrame engine owns
 * its own audio inside a cross-origin iframe that Web Audio cannot tap, so
 * while that engine is the sound source there is nothing to fade — claiming
 * otherwise would be exactly the fake transition the spec forbids. In that
 * case `planTransition` degrades to gapless/cut, which is still an improvement
 * over a hard stop.
 */
function crossfadePossible(current: Playable | null, next: Playable): boolean {
  if (!audioElementIsSource(current)) return false;
  return audioElementIsSource(next) || !!next.youtubeId;
}

/** Ask the deck scheduler to consider a transition (manual skips). */
export function requestTransition(reason: TransitionReason): void {
  // A skip is an explicit "stop this now": any blend already in progress is
  // abandoned so the listener's click always wins.
  cancelTransition("manual-skip");
  const s = usePlayerStore.getState();
  if (!s.current || !s.isPlaying) return;
  armTransition(reason, s.currentTime);
}

/**
 * Run the short manual blend, then hand control to `advance`.
 *
 * The blend is bounded: if the incoming track will not start, or the graph is
 * gone, `maybeRunCrossfade` bails out without touching playback and this simply
 * advances. The listener's Next press is never swallowed.
 */
async function runManualBlend(advance: () => void): Promise<void> {
  const s = usePlayerStore.getState();
  if (!s.current || !s.isPlaying) {
    advance();
    return;
  }
  armTransition("manual-next", s.currentTime);
  if (!transition || transition.plan.mode !== "crossfade") {
    advance();
    return;
  }
  const t = transition;
  const budget = t.plan.seconds * 1000 + MANUAL_SKIP_FADE_SECONDS * 1000 + 1500;
  const deadline = Date.now() + budget;
  void maybeRunCrossfade(Math.max(0, s.duration - s.currentTime));
  // Wait for the blend to commit or be abandoned, but never past its budget.
  while (transition === t && Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
  }
  if (transition === t) {
    // It neither finished nor failed — drop it rather than leaving the decks
    // mid-blend, then move on.
    cancelTransition("manual-budget");
  }
  advance();
}

/**
 * Decide and arm a transition. Called on every time update once the track is
 * close enough to its end to be worth preparing for, and directly by the
 * manual-skip path.
 */
function armTransition(reason: TransitionReason, atSeconds: number): void {
  const s = usePlayerStore.getState();
  if (transition?.armed || transition?.running) return;
  const next = peekNextTrack();
  if (!next) return;

  const plan = planTransition({
    crossfadeSeconds: s.crossfade,
    gaplessEnabled: s.gapless,
    reason,
    currentDuration: s.duration,
    currentTime: atSeconds,
    hasNext: true,
    canCrossfade: crossfadePossible(s.current, next.track),
    sameAlbum: sameAlbumRun(s.current, next.track),
    abRepeatActive: s.abA !== null && s.abB !== null,
    repeatOne: s.repeat === "one",
    paused: !s.isPlaying,
  });
  if (plan.mode === "cut") {
    traceTransition("plan=cut", {
      because: plan.because,
      reason,
      crossfade: s.crossfade,
      gapless: s.gapless,
    });
    return;
  }
  // A configured crossfade that plans as gapless is the one case a listener
  // cannot tell apart from a bug. Say so explicitly rather than leaving it to
  // be inferred from the absence of a fade.
  if (plan.mode === "gapless" && s.crossfade > 0) {
    traceTransition("plan=gapless-despite-crossfade", {
      because: plan.because,
      from: s.current?.title,
      to: next.track.title,
    });
  }

  traceTransition("armed", {
    mode: plan.mode,
    seconds: plan.seconds,
    reason,
    from: s.current?.title,
    to: next.track.title,
    remaining: Math.max(0, s.duration - atSeconds),
  });

  transition = {
    plan,
    index: next.index,
    track: next.track,
    armed: true,
    running: false,
    lastRemaining: null,
    committed: false,
    incomingStarted: false,
    preparedFor: null,
    endedSeen: false,
    outgoingId: s.current?.id ?? null,
    incomingEl: null,
    incomingSlot: null,
    advanceRecovered: false,
  };
  // Start buffering the incoming track now if there is time for it to land.
  //
  // This used to be gated on `plan.mode === "crossfade"` only, which meant a
  // gapless plan never prepared anything: the next stream was not resolved
  // until after `ended`, i.e. inside the very gap gapless exists to remove.
  void prepareIncoming(next.track);
}

/** Load `track` onto the spare deck and remember that we did. */
function prepareIncoming(track: Playable): Promise<HTMLAudioElement | null> {
  const el = getSpareAudio();
  const t = transition;
  if (t) t.preparedFor = null;
  const ready = async (): Promise<HTMLAudioElement | null> => {
    let url = track.audioUrl;
    // "stream" is a marker meaning "resolve this YouTube video", not a URL.
    if (!audioElementIsSource(track) || track.audioUrl === "stream") {
      if (!track.youtubeId) return null;
      url = (await ytResolve(track.youtubeId)) ?? "";
    }
    if (!url || !/^https?:/.test(url)) return null;
    // The listener may have skipped while this was resolving; do not load a
    // track the queue has moved on from.
    if (transition !== t && t) return null;
    el.src = url;
    el.preload = "auto";
    el.playbackRate = usePlayerStore.getState().rate;
    el.load();
    if (transition === t && t) t.preparedFor = track.id;
    return el;
  };
  // Never let a slow or failing resolver throw into the scheduler — a failed
  // preload must simply mean "play it normally when we get there".
  return ready().catch(() => null);
}

/** Two consecutive tracks from the same album want a gapless boundary. */
function sameAlbumRun(a: Playable | null, b: Playable): boolean {
  if (!a || !a.albumName || !b.albumName) return false;
  return a.albumName.trim().toLowerCase() === b.albumName.trim().toLowerCase();
}

/**
 * Start the crossfade, if the plan says one should start right now.
 *
 * Every failure path here returns WITHOUT touching playback: the current song
 * keeps playing at full volume and `handleEnded` advances normally when it
 * finishes. A transition that cannot be performed must never be the reason a
 * listener hears nothing.
 */
async function maybeRunCrossfade(remaining: number): Promise<void> {
  const t = transition;
  if (!t || !t.armed || t.running) return;
  if (t.plan.mode !== "crossfade") return;
  // A manual skip is a "now" request, so it bypasses the run-down trigger
  // entirely. Everything else waits until the track is `leadSeconds` from its
  // end, which is what makes the blend begin BEFORE the track finishes.
  if (!shouldStartNow(t.plan)) {
    if (!shouldStartFade(t.plan, remaining, t.lastRemaining)) return;
    t.lastRemaining = remaining;
  }

  const s = usePlayerStore.getState();
  // The audio context must be RUNNING. A suspended one turns a fade into
  // silence, which is the exact failure this whole feature exists to remove.
  if (!canCrossfadeNow()) {
    traceTransition("refused:no-running-graph", {
      note: "no AudioContext, or a deck is not attached to the graph",
    });
    cancelTransition("no-running-graph");
    return;
  }

  const outgoingSlot = activeDeckSlot();
  const incomingSlot = spareDeckSlot();
  const incoming = getSpareAudio();

  // Make sure the incoming deck really is holding this track before fading to
  // it. If the resolver was slow or failed, fall back rather than fade to
  // silence.
  if (!incoming.currentSrc || !incoming.currentSrc.startsWith("http")) {
    const prepared = await prepareIncoming(t.track);
    if (!prepared || !transition || transition !== t) return;
    if (!canCrossfadeNow()) {
      cancelTransition("graph-lost");
      return;
    }
  }

  t.running = true;
  // Recorded BEFORE `play()` so that any cancel from this moment on — seek,
  // Next, queue clear, repeat change, a settings change — can stop this
  // element. Once it is audible, "cancel" has to mean "stop", not "un-fade".
  t.incomingEl = incoming;
  t.incomingSlot = incomingSlot;
  resetAllDeckGains();
  // Park the INCOMING deck at zero BEFORE asking it to play.
  //
  // `resetAllDeckGains()` puts both decks at unity, and `scheduleCrossfade` is
  // only called after `await incoming.play()` has already resolved. Without
  // this line the incoming song was audible at 100% for the whole length of the
  // play() promise, then dropped to zero and faded up — a loud unmasked burst
  // of the next track immediately before the blend, which is exactly the
  // artefact a crossfade exists to avoid.
  //
  // The element's own `volume`/`muted` are left at the listener's master
  // settings, so master volume is never modified by a transition.
  setDeckGainNow(incomingSlot, 0);
  incoming.volume = s.volume;
  incoming.muted = s.muted;
  incoming.playbackRate = s.rate;

  const started = await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      incoming.removeEventListener("playing", onPlaying);
      incoming.removeEventListener("error", onError);
      resolve(ok);
    };
    const onPlaying = () => done(true);
    const onError = () => done(false);
    incoming.addEventListener("playing", onPlaying, { once: true });
    incoming.addEventListener("error", onError, { once: true });
    void incoming
      .play()
      .then(() => done(true))
      .catch(() => done(false));
  });

  t.incomingStarted = true;
  if (!started || !transition || transition !== t) {
    // Could not start the incoming track. Put everything back exactly as it
    // was: the current song is still playing and will advance normally.
    cancelTransition("incoming-failed");
    return;
  }

  const ok = scheduleCrossfade(
    outgoingSlot,
    incomingSlot,
    t.plan.seconds,
    fadeGains,
  );
  traceTransition("blend", {
    outgoing: outgoingSlot,
    incoming: incomingSlot,
    seconds: t.plan.seconds,
    masterVolume: s.volume,
  });
  if (!ok) {
    // The incoming element is ALREADY PLAYING at this point. Cancelling the
    // transition without stopping it would leave two songs audible at once and
    // let `handleEnded` later advance to a third — the "rapid Next leaves
    // multiple streams running" failure. Put the decks back exactly as they
    // were: incoming silenced and stopped, outgoing at unity.
    try {
      incoming.pause();
    } catch {
      /* ignore */
    }
    setDeckGainNow(incomingSlot, 0);
    resetAllDeckGains();
    cancelTransition("automation-refused");
    return;
  }

  // Let the blend finish before handing the decks over, so the listener never
  // hears the outgoing song cut off early.
  await new Promise<void>((resolve) => {
    const started2 = Date.now();
    const poll = () => {
      if (Date.now() - started2 >= t.plan.seconds * 1000 + 120) {
        resolve();
        return;
      }
      setTimeout(poll, 60);
    };
    poll();
  });

  // The listener may have skipped again mid-fade. Only finish the transition
  // we started if it is still the current one.
  if (transition !== t || t.committed) {
    // ...but if the outgoing track's `ended` was DEFERRED for this blend and
    // the blend is now being abandoned, nobody is left to advance the queue:
    // that event was swallowed and the outgoing element is already spent.
    // Without this the listener is left in silence at the end of a track.
    if (t.endedSeen) recoverDeferredAdvance(t);
    return;
  }
  t.committed = true;
  traceTransition("complete", { to: t.track.title, index: t.index });
  finishTransition(t, outgoingSlot);
}

/**
 * Set by the store once it exists, so the module-level transition code can
 * commit a crossfaded advance through the same queue bookkeeping every other
 * advance uses without the two needing to live in the same scope.
 */
let commitCrossfadeAdvance: ((index: number, track: Playable) => void) | null =
  null;

/**
 * The UNGATED queue advance, hoisted to module scope for `handleEnded`.
 *
 * `handleEnded` lives outside the store closure, so it cannot close over
 * `advanceToIndex` directly. It must use the ungated version: a track reaching
 * its end is playback already in progress, not a request to start it, so
 * routing it through the auth gate would pop a sign-in dialog at someone at
 * the exact moment a song finished. Assigned once when the store is built.
 */
let autoAdvanceToIndex: ((index: number) => void) | null = null;

/**
 * Shared tail of every transition: hand the decks over and commit the queue
 * advance, so a crossfade and a gapless hand-off can never drift apart.
 *
 * The queue is advanced EXACTLY ONCE, here, and the loader is told the audio is
 * already playing on a deck so it does not re-resolve the stream and restart
 * the song from zero.
 */
function commitTransition(
  t: NonNullable<typeof transition>,
  outgoingSlot: "a" | "b",
): void {
  const s = usePlayerStore.getState();
  transition = null;
  resetAllDeckGains();
  const incoming = getSpareAudio();
  incoming.volume = s.volume;
  incoming.muted = s.muted;
  incoming.playbackRate = s.rate;

  const previousId = s.current?.id;
  if (previousId && t.track.id !== previousId && s.current) {
    usePlayerStore.setState((state) => ({
      history: [
        state.current as Playable,
        ...state.history.filter((h) => h.id !== previousId),
      ].slice(0, 50),
    }));
  }
  swapActiveDeck();
  releaseDeck(outgoingSlot);
  commitCrossfadeAdvance?.(t.index, t.track);
}

/** Complete a crossfade: promote the incoming deck and commit the new track. */
function finishTransition(
  t: NonNullable<typeof transition>,
  outgoingSlot: "a" | "b",
): void {
  commitTransition(t, outgoingSlot);
}

/**
 * Gapless hand-off, attempted the instant the outgoing track reports `ended`.
 *
 * This is the whole point of the gapless setting, and it is NOT "a crossfade of
 * zero seconds". A crossfade overlaps two songs; gapless overlaps nothing and
 * only removes SYNQ's own dead time. Concretely, this removes every delay the
 * app itself causes at the boundary:
 *
 *   - the stream was already resolved and buffered onto the spare deck by
 *     `prepareIncoming` (armed `GAPLESS_PRELOAD_LEAD_SECONDS` early), so no
 *     network round-trip happens inside the gap;
 *   - no element is created, no React state is torn down and re-created, and no
 *     source is swapped before the sound continues — the already-buffered spare
 *     element is simply told to play.
 *
 * HONEST LIMITATION: two HTMLAudioElements cannot be made sample-accurate, so
 * this is not bit-exact gapless the way a single MSE append of two encoded
 * segments would be. `play()` on an already-buffered element still has
 * scheduler granularity, typically a few milliseconds. What is eliminated is
 * everything SYNQ was adding on top of that — resolver latency, first-byte
 * latency, element creation and re-render — which was hundreds of milliseconds
 * to seconds. Returns false whenever the incoming track is not genuinely ready,
 * so the caller falls back to the ordinary advance and nothing is cut short.
 */
function tryGaplessHandoff(): boolean {
  const t = transition;
  if (!t || t.plan.mode !== "gapless" || t.running || t.committed) return false;
  if (t.preparedFor !== t.track.id) {
    traceTransition("gapless:skipped", { why: "nothing preloaded" });
    return false;
  }
  const incoming = getSpareAudio();
  if (!incoming.currentSrc || !incoming.currentSrc.startsWith("http")) {
    traceTransition("gapless:skipped", { why: "no resolved src" });
    return false;
  }
  // HAVE_CURRENT_DATA or better. Below that there is nothing decoded to play
  // and starting now would stall mid-note — worse than the gap.
  if (incoming.readyState < 2) {
    traceTransition("gapless:skipped", {
      why: "not buffered",
      readyState: incoming.readyState,
    });
    return false;
  }

  t.committed = true;
  const outgoingSlot = activeDeckSlot();
  incoming.currentTime = 0;
  const started = incoming.play();
  if (started && typeof started.catch === "function") {
    started.catch(() => {
      /* a rejected play falls through to the normal advance below */
    });
  }
  commitTransition(t, outgoingSlot);
  traceTransition("gapless:handoff", { to: t.track.title, index: t.index });
  return true;
}

/** Run on every position update to keep an armed transition on schedule. */
function tickTransition(t: number, duration: number): void {
  const s = usePlayerStore.getState();
  if (!Number.isFinite(duration) || duration <= 0) return;
  const remaining = Math.max(0, duration - t);
  if (!transition) {
    // Arm once the track is close enough to its end that preparing the next
    // one still has time to buffer.
    const lead =
      s.crossfade > 0
        ? preloadLead({
            mode: "crossfade",
            seconds: s.crossfade,
            leadSeconds: s.crossfade,
            reason: "track-ended",
            because: "",
          })
        : s.gapless
          ? GAPLESS_PRELOAD_LEAD_SECONDS
          : 0;
    if (lead > 0 && remaining <= lead) armTransition("track-ended", t);
    return;
  }
  void maybeRunCrossfade(remaining);
}

function onTimeUpdate(t: number, duration: number): void {
  const s = usePlayerStore.getState();
  if (s.abA !== null && s.abB !== null && t >= s.abB) {
    if (s.current?.youtubeId && !audioElementIsSource(s.current))
      ytEngine.seek(s.abA);
    else getAudio().currentTime = s.abA;
    usePlayerStore.setState({ currentTime: s.abA });
    return;
  }
  // remember position on long tracks (throttled)
  const id = s.current?.id;
  if (
    id &&
    duration >= RESUME_MIN_DURATION &&
    Date.now() - lastResumeSave > 5000
  ) {
    lastResumeSave = Date.now();
    saveResumePosition(id, t);
  }
  tickTransition(t, duration);
}

// --- audio element wiring (catalog playback) ---------------------------------

let wired = false;
let audioBufferWatchdog: ReturnType<typeof setTimeout> | null = null;
/** The deck the store's element listeners are currently attached to. */
let boundAudio: HTMLAudioElement | null = null;
let boundAudioHandlers: [string, EventListener][] = [];

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
      else
        audio.addEventListener("loadedmetadata", restorePosition, {
          once: true,
        });
    }
    void audio.play().catch(() => undefined);
  }, 8_000);
}
function wireAudio() {
  if (wired) return;
  wired = true;
  setDeckVolume(initialVolume);
  setDeckMuted(initialMuted);
  setDeckRate(initialRate);

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

  bindAudioDeck(getAudio());

  // A crossfade promotes the other deck to "live". Move these listeners with
  // it, or every position, buffering and end-of-track update would keep coming
  // from the element that just went silent and playback would appear frozen
  // for the rest of the song.
  onActiveDeckChange((next) => {
    bindAudioDeck(next);
  });
}

/**
 * Attach the element-level listeners to whichever deck is live, detaching them
 * from the previous one. Handlers ignore events from an element that is no
 * longer the live deck, which is what makes a mid-swap event harmless.
 */
function bindAudioDeck(audio: HTMLAudioElement): void {
  if (boundAudio && boundAudio !== audio) {
    for (const [type, fn] of boundAudioHandlers) {
      boundAudio.removeEventListener(type, fn);
    }
  }
  boundAudioHandlers = [];
  boundAudio = audio;

  const live = () => audio === getAudio();
  const on = (type: string, fn: EventListener) => {
    audio.addEventListener(type, fn);
    boundAudioHandlers.push([type, fn]);
  };

  on("timeupdate", (() => {
    if (!live()) return;
    const duration =
      audio.duration && Number.isFinite(audio.duration) ? audio.duration : 0;
    usePlayerStore.setState({ currentTime: audio.currentTime, duration });
    onTimeUpdate(audio.currentTime, duration);
  }) as EventListener);

  on("durationchange", (() => {
    if (!live()) return;
    if (audio.duration && Number.isFinite(audio.duration)) {
      usePlayerStore.setState({ duration: audio.duration });
    }
  }) as EventListener);

  on("progress", (() => {
    if (!live()) return;
    try {
      if (audio.buffered.length > 0) {
        const end = audio.buffered.end(audio.buffered.length - 1);
        usePlayerStore.setState({ bufferedEnd: end });
      }
    } catch {
      /* ignore */
    }
  }) as EventListener);

  on("waiting", (() => {
    if (!live()) return;
    usePlayerStore.setState({ isBuffering: true });
    armAudioBufferWatchdog(audio);
  }) as EventListener);

  on("stalled", (() => {
    if (!live()) return;
    usePlayerStore.setState({ isBuffering: true });
    armAudioBufferWatchdog(audio);
  }) as EventListener);

  on("playing", (() => {
    if (!live()) return;
    clearAudioBufferWatchdog();
    usePlayerStore.setState({ isBuffering: false, isPlaying: true });
  }) as EventListener);

  on("pause", (() => {
    if (!live()) return;
    clearAudioBufferWatchdog();
    usePlayerStore.setState({ isPlaying: false, isBuffering: false });
  }) as EventListener);

  on("play", (() => {
    if (!live()) return;
    usePlayerStore.setState({ isPlaying: true });
  }) as EventListener);

  on("ended", (() => {
    if (!live()) return;
    clearAudioBufferWatchdog();
    handleEnded();
  }) as EventListener);
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
      if (
        !current?.youtubeId ||
        ytEngine.getLoadedVideoId() !== current.youtubeId
      )
        return;
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
    ms.setActionHandler("previoustrack", () =>
      usePlayerStore.getState().prev(),
    );
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

  /**
   * Report a hard playback failure so PlayerBar's fallback chain runs.
   *
   * Late failures from a source the listener has already moved on from are
   * ignored, or the chain would "rescue" a song that isn't the one that
   * actually failed and silently swap the wrong track in.
   */
  const reportLoadFailure = (token: number, trackId: string) => {
    if (token !== loadSeq || get().current?.id !== trackId) return;
    set((state) => ({
      isBuffering: false,
      isPlaying: false,
      errorNonce: state.errorNonce + 1,
    }));
  };

  const watchAudioErrors = (
    audio: HTMLAudioElement,
    token: number,
    trackId: string,
  ) => {
    const onError = () => reportLoadFailure(token, trackId);
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
    // Radio is explicitly "never stop", so it tops up even when the user's
    // autoplay preference is off.
    if ((!s.autoplay && !s.radioActive) || !s.current) return;
    const upcoming =
      s.queueIndex >= 0 ? s.queue.length - 1 - s.queueIndex : s.queue.length;
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
          const fresh = related.filter(
            (t) => !st.queue.some((q) => q.id === t.id),
          );
          if (fresh.length === 0) return st;
          return {
            queue: [...st.queue, ...fresh],
            unshuffledQueue: st.unshuffledQueue
              ? [...st.unshuffledQueue, ...fresh]
              : null,
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
  const loadTrack = (
    track: Playable,
    startSeconds?: number,
    /**
     * Set when a crossfade already started this song on a deck. The audio is
     * genuinely playing, so the engine-routing code below is skipped entirely:
     * re-assigning `src` would restart the song from zero right after the
     * blend, which is the audible stutter the transition exists to remove.
     */
    opts?: { deckAlreadyPlaying?: boolean },
  ) => {
    const seq = ++loadSeq;
    const prev = get().current;
    playedSessionIds.add(track.id);

    // queue history: remember what was playing before this
    if (prev && prev.id !== track.id) {
      set((state) => ({
        history: [prev, ...state.history.filter((h) => h.id !== prev.id)].slice(
          0,
          50,
        ),
      }));
    }
    // The outgoing track stopped before its end: close its engagement record
    // as a (graded) skip. A no-op when handleEnded already settled it, and a
    // no-op when there was nothing playing.
    settleEngagement("changed");
    rememberTrack(track.id);
    saveLastPlayed(track);
    recordHistory(track);

    const origin: PlayOrigin = track.queueOrigin ? "autoplay" : pendingOrigin;
    const meta: HistoryMeta = {
      source: track.source,
      title: track.title,
      artistName: track.artistName,
      coverUrl: track.coverUrl,
      duration: track.duration,
      ...(track.albumName ? { albumName: track.albumName } : {}),
      origin,
    };

    // Record EVERY play (any source) for listening stats. The snapshot travels
    // WITH the call: reading `current` here would still return the previous
    // song, because the new track is committed further down.
    // Product analytics: what actually gets played, from where.
    trackEvent("track_play", {
      track_id: track.id,
      title: track.title.slice(0, 120),
      artist: track.artistName.slice(0, 120),
      source: track.source,
      has_video: !!track.youtubeId,
    });

    const resumeAt =
      startSeconds ?? getResumePosition(track.id, track.duration);

    // Open a new engagement session. `startedAt` is filled in by the bridge
    // once the server confirms the play row; until then the session simply
    // cannot be settled, which is the correct failure mode (better to lose one
    // outcome than to attribute it to the wrong play).
    engagement = {
      trackId: track.id,
      origin,
      startOffset: resumeAt,
      startedAt: 0,
    };
    if (signalBridge) {
      try {
        const startedAt = signalBridge.playStart({
          trackId: track.id,
          meta,
        });
        const attach = (value: number) => {
          // Only attach to the session that is still about THIS track: a slow
          // round trip must never land on the next song.
          if (engagement && engagement.trackId === track.id) {
            engagement.startedAt = value;
          }
        };
        if (typeof startedAt === "number") {
          attach(startedAt);
        } else if (startedAt && typeof startedAt.then === "function") {
          void startedAt.then(attach).catch(() => undefined);
        }
      } catch {
        /* ignore */
      }
    }
    pendingOrigin = "user";

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
      // */ and neither does a trim decision, which is per-track by
      // definition: the next song gets its own fresh look.
      introTrimSkipped: null,
    });

    // The crossfade already has this track sounding on the deck we just
    // promoted. Do all the bookkeeping (queue, history, engagement, media
    // session, prefetch) but leave the audio completely alone.
    if (opts?.deckAlreadyPlaying) {
      const audio = getAudio();
      audio.playbackRate = get().rate;
      syncMediaSession(track, true);
      prefetchTrack(get().queue[get().queueIndex + 1]);
      maybeAutofillQueue();
      return;
    }

    // A track with NO video id and no stream URL cannot play at all. This
    // was reachable and failed SILENTLY: `audio.src = undefined` resolves to
    // the page itself, which is never playable, so the element neither errors
    // nor plays. Fail fast and say so instead.
    if (!track.youtubeId && !track.audioUrl) {
      set({ isBuffering: false, isPlaying: false });
      toast.error(
        "Can't play \"" +
          track.title +
          '" \u2014 this track has no audio source',
        { id: "yt-fallback" },
      );
      return;
    }

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
      // Crossfade and gapless are ALSO reasons to play through the <audio>
      // decks rather than the YouTube IFrame.
      //
      // The IFrame owns its audio inside a cross-origin frame that Web Audio
      // cannot tap, so while it is the sound source there is literally nothing
      // to fade and nothing to hand off to. This is the single biggest reason
      // crossfade appeared not to work: with a flat EQ and no effect preset —
      // i.e. almost every listener — `wantFilter` was false, playback went to
      // the IFrame, `crossfadePossible()` returned false, and every plan
      // silently degraded to a cut. Asking for a crossfade now routes playback
      // the same way an effect preset already did.
      const wantDeckEngine = wantFilter || get().crossfade > 0 || get().gapless;
      // The decks need a RUNNING AudioContext before a blend is possible, and
      // the context is only ever created lazily. Build it here, inside the
      // gesture that started playback, so a crossfade is not permanently
      // disabled by the graph never having been constructed.
      if (wantDeckEngine) ensureGraph();
      // Mobile browsers are much more likely to keep a mounted HTML audio
      // element alive when the tab is minimized than a YouTube IFrame. The
      // resolver still falls back to the IFrame if the stream is unavailable.
      if (wantDeckEngine && track.youtubeId) {
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
          if (state.current?.youtubeId !== track.youtubeId || !state.current)
            return;
          swapToFilteredStream(state.current, state.currentTime);
        });
        return;
      }
      getAudio().pause();
      clearYtLoadWatchdog();
      // Last-resort watchdog: the IFrame never reported playing.
      //
      // It used to be 12s, which meant a blocked embed left the listener
      // staring at a silent player for twelve seconds before anything
      // happened. A healthy IFrame reports state 1 (PLAYING) within a
      // couple of seconds, so 5s is already very generous — and the fatal
      // paths (API blocked, error 153, stream blocked) now short-circuit
      // long before this fires, so it only has to cover genuinely slow nets.
      ytLoadWatchdog = setTimeout(() => {
        const state = usePlayerStore.getState();
        if (seq !== loadSeq || !state.current?.youtubeId || state.isPlaying)
          return;
        clearYtLoadWatchdog();
        usePlayerStore.setState((currentState) => ({
          isBuffering: false,
          isPlaying: false,
          errorNonce: currentState.errorNonce + 1,
        }));
      }, 5_000);
      ytEngine
        .play(track.youtubeId, {
          volume: get().volume,
          muted: get().muted,
          startSeconds: resumeAt || undefined,
        })
        .then(() => {
          // The engine init is async — if the user picked another song while
          // this one was initializing, make sure this load never wins.
          if (seq !== loadSeq) ytEngine.pause();
        })
        .catch(() => {
          clearYtLoadWatchdog();
          if (seq !== loadSeq) return;
          set({
            isPlaying: false,
            isBuffering: false,
            errorNonce: get().errorNonce + 1,
          });
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
        else
          audio.addEventListener("loadedmetadata", applyResume, { once: true });
      }
      // Actually start playback. loadTrack is always reached from a user
      // gesture (row click) or auto-advance, so autoplay is permitted —
      // without this the song only loads and needs a second click.
      //
      // A rejected `play()` used to be swallowed, which is a silent dead end:
      // the element reports nothing, no `error` event fires, and the listener
      // just got silence with no fallback. Only `NotAllowedError` (autoplay
      // policy — the source is fine, it just needs a tap) and `AbortError`
      // (a newer load interrupted this one) are ignored; everything else is a
      // source that cannot play and must escalate.
      void audio.play().catch((err: unknown) => {
        const name = (err as { name?: string } | null)?.name;
        if (name === "NotAllowedError" || name === "AbortError") return;
        reportLoadFailure(seq, track.id);
      });
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

  /**
   * Build a queue around `track` and start playing it.
   *
   * `respectShuffle` is the whole point of the split. When true this is the
   * normal in-app behaviour: if the user has shuffle on, the rest of the list
   * is reordered around the track they picked. When false the list is played
   * exactly as handed over, which is what a page's "Play all" means and what
   * a page's "Shuffle all" builds by shuffling the array itself.
   */
  /**
   * The ONE deferred-auth check for playback.
   *
   * Every way a listener can start audio in this app — a Home shelf row, an
   * album Play, a playlist Play, an artist Radio, the queue's next button, the
   * transport, a keyboard shortcut, a media-key handler — bottoms out in one
   * of the store actions wrapped below. Putting the check here rather than in
   * each component is the difference between one rule that cannot be missed
   * and two dozen scattered `if (!user)` checks, three of which somebody
   * eventually forgets.
   *
   * It runs BEFORE any state is touched. That ordering is the whole point:
   * a guest who clicks Play must not end up with `isPlaying: true`, a
   * populated `current`, and a progress bar advancing over a silent player.
   * Nothing is mutated and no audio is started until this returns true.
   *
   * `intent` is the action to finish once they are signed in. Passing null
   * means "this action is not worth resuming" — used by paths that only
   * advance an already-authenticated session.
   */
  const gatePlayback = (intent: AuthIntent | null): boolean =>
    useAuthGate.getState().request("playback", intent);

  /** Same check for actions that persist to the account rather than play. */
  const gateAccount = (
    reason: "save" | "library",
    intent: AuthIntent | null,
  ): boolean => useAuthGate.getState().request(reason, intent);

  const playResolved = (
    track: Playable,
    list: Playable[] | undefined,
    respectShuffle: boolean,
  ) => {
    // Explicit list playback (playlist / liked / home rows) is not a search
    // context — drop any genre left over from a previous search.
    activeMixContext = null;
    // Choosing a list is an explicit "play this", so it ends any radio that
    // was running. In-queue navigation goes through playIndex, which leaves
    // radio alone, so clicking a row in the queue does not switch it off.
    if (get().radioActive) set({ radioActive: false, radioSource: null });
    const list2 = list && list.length > 0 ? list.map(norm) : [norm(track)];
    const t = norm(track);
    // Match by id OR youtubeId — history snapshots may carry a stored id that
    // differs from the live item id, which used to make findIndex fail and
    // silently play index 0 ("always the most recent song") instead.
    let idx = list2.findIndex((x) => x.id === t.id);
    if (idx < 0 && t.youtubeId)
      idx = list2.findIndex((x) => x.youtubeId === t.youtubeId);
    if (idx < 0 && t.title) {
      const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      idx = list2.findIndex(
        (x) =>
          normKey(x.title) === normKey(t.title) &&
          normKey(x.artistName) === normKey(t.artistName),
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
    if (respectShuffle && get().shuffle && queue.length > 1) {
      const current = queue[index];
      const rest = queue.filter((_, i) => i !== index);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      queue = current ? [current, ...rest] : rest;
      index = 0;
    }
    set({
      queue,
      queueIndex: index,
      unshuffledQueue: null,
      unshuffledIndex: -1,
    });
    loadTrack(queue[index]);
  };

  const playTrack = (track: Playable, list?: Playable[]) => {
    if (
      !gatePlayback({
        kind: "playTrack",
        track: intentPlayable(norm(track)),
        ...(list && list.length > 0
          ? { list: list.map((t) => intentPlayable(norm(t))) }
          : {}),
      })
    )
      return;
    playResolved(track, list, true);
  };

  const playListOrdered = (track: Playable, list: Playable[]) => {
    if (
      !gatePlayback({
        kind: "playListOrdered",
        track: intentPlayable(norm(track)),
        list: list.map((t) => intentPlayable(norm(t))),
      })
    )
      return;
    playResolved(track, list, false);
  };

  const startRadio = (track: Playable, contextQuery?: string) => {
    if (
      !gatePlayback({
        kind: "startRadio",
        track: intentPlayable(norm(track)),
        ...(contextQuery ? { contextQuery } : {}),
      })
    )
      return;
    const seed = norm(track);
    // Remember what the user searched so every later queue fill (autofill,
    // end-of-queue) stays in the SAME genre instead of drifting.
    activeMixContext = normalizeContext(contextQuery) ?? activeMixContext;
    // Start the seed immediately; the related mix (same vibe/genre) is
    // fetched in the background and appended as it arrives.
    const initial: Playable[] = [seed];
    set({
      queue: initial,
      queueIndex: 0,
      radioActive: true,
      radioSource: seed.title,
    });
    loadTrack(seed);
    void fetchRelatedMix(seed, initial, 15, contextQuery).then((related) => {
      // Dedupe against the latest queue inside the updater (see autofill note).
      usePlayerStore.setState((st) => {
        const fresh = related.filter(
          (t) => !st.queue.some((q) => q.id === t.id),
        );
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

  /**
   * Emulate the "playlist radio" Spotify used to ship: play the playlist, then
   * keep seeding similar music forever instead of stopping at the last track.
   * The mix is seeded from the dominant genre across the playlist's own tracks
   * so the radio stays on the playlist's vibe even once the seed track that
   * started it has long finished.
   */
  const startPlaylistRadio = (tracks: Playable[], label: string) => {
    const list = tracks.map(norm).filter((t) => !!t.youtubeId || !!t.audioUrl);
    const first = list[0];
    if (!first) return;
    if (
      !gatePlayback({
        kind: "startPlaylistRadio",
        tracks: list.map((t) => intentPlayable(t)),
        label,
      })
    )
      return;

    activeMixContext = playlistMixContext(list);
    // The WHOLE playlist is queued, not just the first track: this is a
    // playlist radio, so the playlist plays through in order and only then
    // does the endless part begin.
    set({
      queue: list,
      queueIndex: 0,
      radioActive: true,
      radioSource: label || first.title,
    });
    loadTrack(first);

    // Prime the tail straight away, deduped against the full playlist so the
    // radio cannot hand back one of the playlist's own songs as a "related"
    // track later. The playlist still plays first — this only guarantees the
    // first fill is already waiting by the time it runs out, so the radio
    // never audibly stops to think.
    void fetchRelatedMix(first, list, 15, activeMixContext).then((related) => {
      const state = usePlayerStore.getState();
      if (state.current?.id !== first.id || !state.radioActive) return;
      usePlayerStore.setState((st) => {
        const fresh = related.filter(
          (t) => !st.queue.some((q) => q.id === t.id),
        );
        if (fresh.length === 0) return st;
        return { queue: [...st.queue, ...fresh] };
      });
      const after = usePlayerStore.getState();
      saveQueue(after.queue, after.queueIndex, after.current?.id ?? null);
    });
  };

  /** Leave radio mode; the queue stops being topped up. */
  const stopRadio = () => {
    if (!get().radioActive) return;
    activeMixContext = null;
    set({ radioActive: false, radioSource: null });
  };

  const playViaStream = (track: Playable, startSeconds?: number) => {
    const marked = { ...track, audioUrl: track.audioUrl || "stream" };
    if (
      !gatePlayback({
        kind: "playViaStream",
        track: intentPlayable(norm(marked)),
        ...(startSeconds ? { startSeconds } : {}),
      })
    )
      return;
    // Mark the track as stream-loaded so loadTrack takes the audio path even
    // with no filter active — this is how non-embeddable videos get rescued.
    set({ queue: get().queue.map((t) => (t.id === marked.id ? marked : t)) });
    loadTrack(marked, startSeconds);
  };

  const replaceCurrentStream = (playable: Playable, startSeconds?: number) => {
    // Source switching only happens in response to a stream that already
    // failed, which means playback was already under way and therefore
    // already authenticated. Gated anyway for the case where a guest reaches
    // it directly, so there is no ungated hole into `loadTrack`.
    if (!gatePlayback(null)) return;
    const s = get();
    const index = Math.max(0, s.queueIndex);
    const queue = s.queue.map((t, i) => (i === index ? playable : t));
    set({ queue, queueIndex: index });
    loadTrack(playable, startSeconds);
  };

  /**
   * Move to a queue position. UNGATED.
   *
   * This is the internal advance, used by `handleEnded` (a track finishing),
   * by radio autoplay, and by the crossfade commit. None of those are user
   * requests to start playback: they are a consequence of playback that is
   * already happening, and the session that started it was necessarily
   * authenticated.
   *
   * Gating this would be actively wrong. It would mean the end of a queue
   * threw a sign-in dialog at someone purely because the app wanted to
   * auto-play a recommendation — the exact "surprise popup triggered entirely
   * by background autoplay" the deferred-auth design exists to avoid.
   */
  const advanceToIndex = (index: number) => {
    const s = get();
    if (index < 0 || index >= s.queue.length) return;
    saveQueue(s.queue, index, s.queue[index]?.id ?? null);
    set({ queueIndex: index });
    loadTrack(s.queue[index]);
    maybeAutofillQueue();
  };

  /**
   * The user-facing "play this row in the queue" action. Gated, because a
   * click on the queue IS a deliberate request to start audio.
   */
  const playIndex = (index: number) => {
    const s = get();
    if (index < 0 || index >= s.queue.length) return;
    const target = s.queue[index];
    if (
      !gatePlayback({
        kind: "playTrack",
        track: intentPlayable(target),
        list: s.queue.map((t) => intentPlayable(t)),
      })
    )
      return;
    advanceToIndex(index);
  };

  /**
   * Commit a crossfaded advance. The audio is already playing on the deck we
   * just promoted, so this reuses the normal queue bookkeeping (saved queue,
   * index, autoplay top-up, history) and tells `loadTrack` not to touch the
   * source. Going through `playIndex` instead would re-assign `src` and
   * restart the song at zero.
   */
  const advanceTrackForTransition = (index: number, track: Playable) => {
    const s = get();
    if (index < 0 || index >= s.queue.length) return;
    if (s.queue[index]?.id !== track.id) return; // queue moved under us
    saveQueue(s.queue, index, track.id ?? null);
    set({ queueIndex: index });
    loadTrack(s.queue[index], undefined, { deckAlreadyPlaying: true });
  };
  // Hand the transition engine the one thing it cannot do on its own: commit
  // the queue exactly the way a normal advance does.
  commitCrossfadeAdvance = advanceTrackForTransition;
  // Same idea, for the ungated advance `handleEnded` needs. See the
  // declaration for why this one must NOT be gated.
  autoAdvanceToIndex = advanceToIndex;

  const togglePlay = () => {
    const s = get();
    if (s.current) {
      if (s.current.youtubeId && !audioElementIsSource(s.current)) {
        // Decide from the engine's REAL state rather than the polled
        // `isPlaying` flag. When the two disagree the Pause button did
        // nothing at all: pressing it called pauseVideo() on a player that was
        // already paused, the store kept saying "playing", and the transport
        // looked stuck.
        const engineState = ytEngine.getEngineState();
        const enginePlaying =
          engineState === 1 || engineState === 3
            ? true
            : engineState === 0 || engineState === 2 || engineState === 5
              ? false
              : s.isPlaying;
        if (enginePlaying) {
          ytEngine.pause();
        } else if (ytEngine.getLoadedVideoId() === s.current.youtubeId) {
          // Already has this video — resume in place so the position survives.
          ytEngine.resume();
        } else {
          void ytEngine
            .play(s.current.youtubeId, { volume: s.volume, muted: s.muted })
            .catch(() => undefined);
        }
        return;
      }
      const audio = getAudio();
      if (audio.paused) {
        // Resuming after a pause must not restart a half-finished blend: the
        // decks are back at unity, so a blend would run from the wrong place.
        cancelTransition("resume");
        void audio.play().catch(() => undefined);
        syncMediaSession(s.current, true);
      } else {
        // A crossfade has two songs audible at once, so pausing only the live
        // deck would leave the incoming song playing over a "paused" UI — and
        // resuming would then bring both songs back together.
        cancelTransition("pause");
        pauseAllDecks();
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
    // An explicit skip always wins: drop any blend that is in flight so two
    // transitions can never overlap, then start the short manual blend.
    cancelTransition("manual-next");
    // Shuffle ON: play a RANDOM other track (not the one directly below).
    // `peekNextTrack` resolves the shuffle pick with the same function, so a
    // blend can never fade into one song while the advance starts another.
    const advance = () => {
      const cur = get();
      if (cur.shuffle && cur.queue.length > 1) {
        playIndex(
          pickShuffleIndex(cur.queue.length, cur.queueIndex, cur.smartShuffle),
        );
        return;
      }
      if (cur.queueIndex < cur.queue.length - 1) {
        playIndex(cur.queueIndex + 1);
      } else if (cur.repeat === "all") {
        playIndex(0);
      }
    };
    // Manual Next used to call `requestTransition` and then immediately
    // `playIndex`, which tore the current track down before the blend could
    // run — so the short manual crossfade never actually happened. Blend
    // first, then advance, and only wait as long as the blend is meant to last.
    if (s.isPlaying && s.current && s.crossfade > 0) {
      void runManualBlend(advance);
      return;
    }
    advance();
  };

  const prev = () => {
    const s = get();
    if (s.queue.length === 0) return;
    // Previous never crossfades. Going back is a navigation intent, and the
    // existing "restart the song if you are past 3s" behaviour has to keep
    // working untouched.
    cancelTransition("manual-prev");
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
    // A non-finite position reaches us from a zero-width seek bar (dividing by
    // rect.width yields NaN, and Math.max(0, NaN) is still NaN). Assigning
    // NaN to audio.currentTime THROWS "non-finite", which killed the whole
    // click handler and left the transport stuck.
    if (!Number.isFinite(time)) return;
    // Seeking during a blend would leave the incoming track playing from a
    // position the listener never chose, so abandon the transition first.
    cancelTransition("seek");
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
    // Both decks, not just the live one: after a crossfade the idle deck is
    // already holding the next song, and a volume change that missed it would
    // silently play the next track at the old level.
    setDeckVolume(v);
    ytEngine.setVolume(v);
    writeSetting("ss.volume", String(v));
    set({ volume: v });
  };

  const toggleMute = () => {
    const s = get();
    const nextMuted = !s.muted;
    setDeckMuted(nextMuted);
    ytEngine.setMuted(nextMuted);
    writeSetting("ss.muted", nextMuted ? "1" : "0");
    if (!nextMuted && s.volume === 0) {
      get().setVolume(0.8);
    }
    set({ muted: nextMuted });
  };

  const toggleShuffle = () => {
    const s0 = get();
    const next = !s0.shuffle;
    writeSetting("ss.shuffle", next ? "1" : "0");
    // Physically reorder the queue so shuffle takes effect immediately and the
    // queue panel reflects it. The currently playing track keeps its slot; the
    // rest are Fisher–Yates shuffled. Turning shuffle off restores the saved
    // original order. Works for ANY queue size (≥ 2) — small queues used to
    // silently do nothing, which made shuffle feel broken.
    if (s0.queue.length >= 2) {
      const currentId = s0.queueIndex >= 0 ? s0.queue[s0.queueIndex]?.id : null;
      if (next) {
        if (s0.unshuffledQueue === null) {
          set({
            unshuffledQueue: [...s0.queue],
            unshuffledIndex: s0.queueIndex,
          });
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
        set({
          queue: restored,
          queueIndex: idx,
          unshuffledQueue: null,
          unshuffledIndex: -1,
        });
        saveQueue(restored, idx, currentId);
      }
    }
    set({ shuffle: next });
  };

  /**
   * The transport shuffle button cycles through three states, the way
   * Spotify's does:
   *
   *   off  ->  shuffle  ->  smart shuffle  ->  off
   *
   * One control for both modes, so the repeat-avoiding mode is one press away
   * instead of hidden behind a separate switch in the queue panel. The button
   * cannot end up disagreeing with the queue, because every transition goes
   * through here.
   *
   * `toggleShuffle` owns the physical queue reorder, so it is reused rather
   * than duplicated: entering and leaving the shuffled state has to go through
   * the same save/restore of the unshuffled order, or turning shuffle off would
   * leave the queue stuck in shuffled order. Promoting plain shuffle to smart
   * shuffle deliberately does NOT reorder again — the queue is already
   * shuffled, and re-shuffling would throw away the order the listener is
   * part-way through.
   */
  const cycleShuffle = () => {
    const s = get();
    // Off -> plain shuffle. `toggleShuffle` owns only the shuffle flag, and
    // smart shuffle is already false here, so it needs no clearing.
    if (!s.shuffle && !s.smartShuffle) {
      toggleShuffle();
      return;
    }
    // Plain shuffle -> smart shuffle: the queue order stays exactly as it is.
    if (s.shuffle && !s.smartShuffle) {
      writeSetting("ss.smartShuffle", "1");
      set({ smartShuffle: true });
      return;
    }
    // Anything else (shuffle on, or both on) -> fully off, restoring the order.
    toggleShuffle();
    writeSetting("ss.smartShuffle", "0");
    set({ smartShuffle: false });
  };

  /**
   * Turn shuffle on, for the "shuffle this list" buttons on the Liked Songs
   * and playlist pages. Deliberately NOT the three-state cycle: those buttons
   * are actions, not a mode selector, so pressing one twice must never turn
   * shuffle back off. Smart shuffle is left exactly as the listener set it.
   */
  const startShuffle = () => {
    if (get().shuffle) return;
    toggleShuffle();
  };

  const toggleSmartShuffle = () => {
    const next = !get().smartShuffle;
    writeSetting("ss.smartShuffle", next ? "1" : "0");
    // smart shuffle implies shuffle
    if (next && !get().shuffle) {
      writeSetting("ss.shuffle", "1");
      set({ shuffle: true, smartShuffle: true });
      return;
    }
    set({ smartShuffle: next });
  };

  const cycleRepeat = () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const idx = order.indexOf(get().repeat);
    const next = order[(idx + 1) % order.length];
    // Switching to repeat-one while a blend is running would fade the track
    // out and restart it on top of itself.
    cancelTransition("repeat-changed");
    writeSetting("ss.repeat", next);
    set({ repeat: next });
  };

  const setRate = (rate: number) => {
    const r = Math.min(2, Math.max(0.5, rate));
    // Both decks: a prepared incoming track must not start at the old speed.
    setDeckRate(r);
    ytEngine.setRate(r);
    writeSetting("ss.rate", String(r));
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
      // The element is about to be stopped, so read its clock first. Handing
      // the IFrame the polled `currentTime` instead rewound the track by up to
      // a poll interval every time an effect was switched off.
      const resumeAt =
        livePlaybackPosition(s.current.youtubeId) ?? s.currentTime;
      getAudio().pause();
      void ytEngine
        .play(s.current.youtubeId, {
          volume: s.volume,
          muted: s.muted,
          startSeconds: resumeAt,
        })
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
    // Skip while stalled: seeking a buffering player only digs it deeper.
    if (!s.isPlaying || s.isBuffering) return;
    // Align the picture to the element's LIVE clock. `currentTime` is a
    // polled snapshot that lags by up to a tick, so correcting against it
    // could visibly yank the video backwards on every pass.
    //
    // The live read is only trustworthy once the element has metadata. Right
    // after a stream swap `audio.src` has just been reassigned and
    // `currentTime` reads 0 until `loadedmetadata` fires — correcting the
    // slave against that would snap the video to the start of the track while
    // the audio is already minutes in.
    const audio = getAudio();
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) return;
    const live = audio.currentTime;
    if (!Number.isFinite(live)) return;
    if (Math.abs(ytEngine.getEngineTime() - live) > 1.5) {
      ytEngine.seek(live);
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
    const retryLater = () => {
      if (attempts < 8) effectRetryTimer = setTimeout(tryResolve, 15_000);
    };
    const tryResolve = () => {
      attempts += 1;
      void ytResolve(videoId)
        .then((url) => {
          if (url) {
            const s = usePlayerStore.getState();
            // Only swap if this song is still playing AND the effect is still
            // wanted — never hijack playback after the user moved on.
            if (s.current?.youtubeId !== videoId || s.audioFilter === "off")
              return;
            swapToFilteredStream(s.current, s.currentTime);
            const label =
              AUDIO_FILTERS.find((f) => f.id === s.audioFilter)?.label ??
              "Effect";
            toast.success(`${label} applied`, { id: "fx-retry" });
            return;
          }
          retryLater();
        })
        // A rejected resolve (dropped connection, aborted fetch) must not end
        // the chain: with no catch the retry timer was never armed again, so
        // one network blip left the effect off for the rest of the session.
        .catch(() => retryLater());
    };
    effectRetryTimer = setTimeout(tryResolve, 12_000);
  };

  /**
   * The playhead of whichever source is ACTUALLY making sound right now.
   *
   * The store's `currentTime` is a polled snapshot — the IFrame reports it on
   * `onTime` a few times a second — so a value captured before resolving a
   * stream is already stale by the time it gets used. Re-seeking to such a
   * snapshot is what made an effect-enabled track jump back to the moment the
   * effect was switched on. Returns null when no source can be interrogated, so
   * callers fall back to the position they were handed rather than invent one.
   */
  const livePlaybackPosition = (videoId?: string): number | null => {
    const s = usePlayerStore.getState();
    if (!videoId || s.current?.youtubeId !== videoId) return null;
    if (audioElementIsSource(s.current)) {
      const t = getAudio().currentTime;
      return Number.isFinite(t) ? t : null;
    }
    const t = ytEngine.getEngineTime();
    return Number.isFinite(t) && t > 0 ? t : null;
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
    //
    // The outgoing source is deliberately NOT paused here. Resolution is a
    // network round-trip that regularly takes seconds, and pausing first left
    // the listener in dead silence for the whole of it — the audible delay on
    // every effect change. The old source keeps playing until the replacement
    // stream is actually in hand.
    void ytResolve(videoId)
      .then((url) => {
        if (!url || seq !== loadSeq || myFilterSeq !== filterLoadSeq) return;
        const audio = getAudio();
        // Read the clock HERE, at the moment the new stream takes over, rather
        // than reusing the position captured when the swap was requested.
        const from = livePlaybackPosition(videoId) ?? at;
        ytEngine.pause();
        audio.pause();
        audio.src = url;
        audio.playbackRate = get().rate;
        audio.load();
        if (from > 0) {
          const applyResume = () => {
            audio.currentTime = from;
            usePlayerStore.setState({ currentTime: from });
          };
          if (audio.readyState >= 1) applyResume();
          else
            audio.addEventListener("loadedmetadata", applyResume, {
              once: true,
            });
        }
        watchAudioErrors(audio, seq, track.id);
        void audio.play().catch(() => undefined);
        usePlayerStore.setState({
          current: { ...track, audioUrl: url },
          currentTime: from,
        });
        syncVideoSlave();
      })
      .catch(() => undefined);
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
          description:
            "This song's stream resists processing \u2014 try another track",
        });
        return;
      }
      // By now the <audio> element already owns the sound, so the graph is in
      // the path by construction. The only fault left is a suspended
      // AudioContext, and resuming it fixes that WITHOUT touching playback.
      //
      // This used to re-swap the stream instead — pause, re-resolve, reload,
      // seek — every time the analyser dipped below the threshold above. An
      // intro, a fade or any quiet passage dips below it routinely, so an
      // effect-enabled track would stop and jump mid-song for no reason, and
      // because the seek used a stale position it landed back at the point
      // where the effect had been enabled. That was the random jump.
      void resumeGraph().then((ok) => {
        if (!ok) {
          toast("Tap play once to activate audio processing", {
            id: "fx-verify",
            description: "Your browser needs a click before the EQ can start",
          });
        }
      });
      verifyTimer = setTimeout(() => check(attempt + 1), 2500);
    };
    verifyTimer = setTimeout(() => check(0), 1800);
  };

  const resolveAndPlayWithFilter = (
    track: Playable,
    resumeAt: number,
    forEffect = false,
  ) => {
    const videoId = track.youtubeId;
    if (!videoId) return;
    // Build the audio graph NOW (this runs inside the user-gesture click
    // that started playback) — creating it later from a non-gesture context
    // leaves the AudioContext suspended and the effects silent.
    ensureGraph();
    const seq = ++loadSeq;
    const myFilterSeq = ++filterLoadSeq;
    // A "hot swap" is the same song already playing through the other source:
    // the user just turned an effect on, or nudged an EQ slider. Nothing is
    // wrong with the current playback, so it must not be interrupted — not
    // paused, not flagged buffering, and not rewound to wherever the playhead
    // happened to be when the effect was switched on. Freezing the position
    // and tearing the source down up front is what produced the gap before an
    // effect engaged.
    const prev = usePlayerStore.getState();
    const hotSwap =
      !!prev.current?.youtubeId && prev.current?.youtubeId === videoId;
    if (!hotSwap) {
      // A genuine load. Update UI immediately — resolution can take seconds
      // (or fail), and the player must never show the previous song while the
      // new one plays.
      set({
        current: track,
        currentTime: resumeAt,
        duration: track.duration,
        bufferedEnd: 0,
        isBuffering: true,
        abA: null,
        abB: null,
        introTrimSkipped: null,
      });
      syncMediaSession(track, true);
      // Only one source at a time: stop the IFrame engine before the filtered
      // stream takes over, or both play and the effect is inaudible.
      ytEngine.pause();
      getAudio().pause();
    }
    ytResolve(videoId)
      .then((url) => {
        if (seq !== loadSeq || myFilterSeq !== filterLoadSeq) return; // superseded
        if (!url) throw new Error("no stream");
        const audio = getAudio();
        // The clock is read HERE, where the new stream takes over. For a hot
        // swap the old source has been playing throughout the resolve, so
        // reusing the position captured up front rewound the track by however
        // long resolution took.
        const from = hotSwap
          ? (livePlaybackPosition(videoId) ?? resumeAt)
          : resumeAt;
        ytEngine.pause();
        audio.pause();
        audio.src = url;
        audio.playbackRate = get().rate;
        audio.load();
        if (from > 0) {
          const applyResume = () => {
            audio.currentTime = from;
            usePlayerStore.setState({ currentTime: from });
          };
          if (audio.readyState >= 1) applyResume();
          else
            audio.addEventListener("loadedmetadata", applyResume, {
              once: true,
            });
        }
        // A blocked stream host fails silently here otherwise: the element
        // never errors, `play()` never rejects, and the listener just gets
        // nothing on the very path that exists to rescue playback.
        watchAudioErrors(audio, seq, track.id);
        void audio.play().catch(() => undefined);
        set({ current: { ...track, audioUrl: url }, currentTime: from });
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
            description:
              "Resolving an audio stream \u2014 it kicks in automatically",
          });
          scheduleEffectRetry(videoId);
        }
        if (hotSwap) {
          // The outgoing source was never stopped and is a real source, so
          // starting the IFrame engine here would play the song twice at once.
          // Leave it alone; the background retry moves it onto the filtered
          // path as soon as any resolver succeeds.
          set({ isBuffering: false });
          return;
        }
        const from = livePlaybackPosition(videoId) ?? resumeAt;
        getAudio().pause();
        ytEngine
          .play(videoId, {
            volume: get().volume,
            muted: get().muted,
            startSeconds: from || undefined,
          })
          .catch(() => {
            set({
              isPlaying: false,
              isBuffering: false,
              errorNonce: get().errorNonce + 1,
            });
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
        // Both decks: the sleep timer must stop the music outright, including
        // a track that a crossfade had already started fading in.
        pauseAllDecks();
        ytEngine.pause();
        if (sleepCheckInterval) {
          clearInterval(sleepCheckInterval);
          sleepCheckInterval = null;
        }
        set({ sleepEndsAt: null, isPlaying: false });
      }
    }, 1000);
  };

  const toggleIntroTrim = () => {
    const next = !get().introTrim;
    writeSetting("ss.introTrim", next ? "1" : "0");
    set({ introTrim: next, introTrimSkipped: null });
  };

  const skipIntro = (seconds?: number) => {
    const s = get();
    const requested =
      seconds ??
      (s.introTrimSkipped !== null
        ? // Already trimmed once: a second press walks further in, so the
          // control stays useful on a 60s+ cinematic intro.
          s.introTrimSkipped * 2
        : DEFAULT_MANUAL_INTRO_SKIP);
    const skip = clampIntroSkip(
      requested,
      s.duration || DEFAULT_INTRO_TRIM_OPTIONS.maxSkipSeconds * 10,
    );
    if (skip < 1) return 0;
    seek(skip);
    set({ introTrimSkipped: skip });
    return skip;
  };

  const undoIntroTrim = () => {
    const s = get();
    if (s.introTrimSkipped === null) return;
    seek(0);
    set({ introTrimSkipped: null });
  };

  const setAbPoint = (which: "a" | "b", seconds: number | null) => {
    set(which === "a" ? { abA: seconds } : { abB: seconds });
  };

  const clearAb = () => set({ abA: null, abB: null });

  const setLikeMutation = (fn: LikeMutation | null) => {
    likeMutation = fn;
  };

  const toggleLike = (trackId: string, remote?: RemoteLikeSnapshot) => {
    // Gated BEFORE the optimistic flip. Flipping first would light the heart
    // for someone with no account to save it to, and then the prompt appears
    // over a control showing the wrong state — so if they dismiss it, the
    // heart stays lit and lies about being saved.
    if (
      !gateAccount("save", {
        kind: "like",
        trackId,
        ...(remote ? { remote } : {}),
      })
    )
      return;
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
    exploration: initialExploration,
    setExploration: (value) => {
      const next = Number.isFinite(value)
        ? Math.min(100, Math.max(0, Math.round(value)))
        : DEFAULT_EXPLORATION;
      writeSetting(EXPLORATION_KEY, String(next));
      set({ exploration: next });
    },
    introTrim: initialIntroTrim,
    introTrimSkipped: null,
    crossfade: initialCrossfade,
    setCrossfade: (seconds: number) => {
      const next = normalizeCrossfade(seconds);
      writeSetting("ss.crossfade", String(next));
      // Changing the length mid-playback must never leave a half-finished
      // blend running, so any armed transition is recomputed from scratch.
      cancelTransition("setting-changed");
      set({ crossfade: next });
    },
    gapless: initialGapless,
    toggleGapless: () =>
      set((state) => {
        writeSetting("ss.gapless", state.gapless ? "0" : "1");
        return { gapless: !state.gapless };
      }),
    unshuffledQueue: null,
    unshuffledIndex: -1,
    repeat: initialRepeat,
    rate: initialRate,
    audioFilter: "off",

    autoplay: initialAutoplay,
    // Radio is session-only, like sound effects: restoring a persisted
    // endless queue on startup would silently keep fetching tracks for
    // someone who just wanted their playlist back.
    radioActive: false,
    radioSource: null,
    toggleAutoplay: () =>
      set((state) => {
        writeSetting("ss.autoplay", state.autoplay ? "0" : "1");
        return { autoplay: !state.autoplay };
      }),

    videoEnabled: initialVideoEnabled,
    toggleVideo: () =>
      set((state) => {
        const next = !state.videoEnabled;
        writeSetting("ss.video", next ? "1" : "0");
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
        writeSetting("ss.accentTheme", id);
        return { accentTheme: id };
      }),
    compactMode: initialCompact,
    toggleCompactMode: () =>
      set((state) => {
        writeSetting("ss.compact", state.compactMode ? "0" : "1");
        return { compactMode: !state.compactMode };
      }),
    ambientGlow: initialGlow,
    toggleAmbientGlow: () =>
      set((state) => {
        writeSetting("ss.ambientGlow", state.ambientGlow ? "0" : "1");
        return { ambientGlow: !state.ambientGlow };
      }),
    visualizerEnabled: initialVisualizer,
    toggleVisualizer: () =>
      set((state) => {
        writeSetting("ss.visualizer", state.visualizerEnabled ? "0" : "1");
        return { visualizerEnabled: !state.visualizerEnabled };
      }),
    performanceMode: initialPerformanceMode,
    togglePerformanceMode: () =>
      set((state) => {
        writeSetting("ss.performanceMode", state.performanceMode ? "0" : "1");
        return { performanceMode: !state.performanceMode };
      }),
    pointerEffects: initialPointerEffects,
    togglePointerEffects: () =>
      set((state) => {
        writeSetting("ss.pointerEffects", state.pointerEffects ? "0" : "1");
        return { pointerEffects: !state.pointerEffects };
      }),

    themeMode: localStorage.getItem("ss.themeMode") ?? "dark",
    setThemeMode: (mode) =>
      set(() => {
        writeSetting("ss.themeMode", mode);
        const root = document.documentElement;
        root.classList.toggle("light", mode === "light");
        root.classList.toggle("amoled", mode === "amoled");
        return { themeMode: mode };
      }),

    hideExplicit: localStorage.getItem("ss.hideExplicit") === "1",
    toggleHideExplicit: () =>
      set((state) => {
        writeSetting("ss.hideExplicit", state.hideExplicit ? "0" : "1");
        return { hideExplicit: !state.hideExplicit };
      }),

    liquidGlass: localStorage.getItem("ss.liquidGlass") !== "0",
    cardTransparency: readCardTransparency(),
    setCardTransparency: (value) => {
      const next = applyCardTransparency(value);
      writeSetting(CARD_TRANSPARENCY_KEY, String(next));
      set({ cardTransparency: next });
    },
    toggleLiquidGlass: () =>
      set((state) => {
        const next = !state.liquidGlass;
        writeSetting("ss.liquidGlass", next ? "1" : "0");
        document.documentElement.classList.toggle("no-glass", !next);
        return { liquidGlass: next };
      }),

    hideSidebarEmail: localStorage.getItem("ss.hideSidebarEmail") === "1",
    toggleSidebarCollapsed: () =>
      set((state) => {
        const next = !state.sidebarCollapsed;
        writeSetting("ss.sidebarCollapsed", next ? "1" : "0");
        return { sidebarCollapsed: next };
      }),
    sidebarCollapsed: localStorage.getItem("ss.sidebarCollapsed") === "1",
    toggleHideSidebarEmail: () =>
      set((state) => {
        const next = !state.hideSidebarEmail;
        writeSetting("ss.hideSidebarEmail", next ? "1" : "0");
        return { hideSidebarEmail: next };
      }),

    wallpaper: initialWallpaper,
    wallpaperType: initialWallpaperType,
    setWallpaperType: (type) =>
      set(() => {
        writeSetting("ss.wallpaperType", type);
        return { wallpaperType: type };
      }),
    setWallpaper: (value, type = "image") =>
      set(() => {
        try {
          if (value) writeSetting("ss.wallpaper", value);
          else removeSetting("ss.wallpaper");
          writeSetting("ss.wallpaperType", type);
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
    toggleLikedAlbum: (albumId) => {
      if (!gateAccount("save", { kind: "likeAlbum", albumId })) return;
      set((state) => {
        const next = { ...state.likedAlbums };
        if (next[albumId]) delete next[albumId];
        else next[albumId] = true;
        writeIdSet("ss.likedAlbums", next);
        return { likedAlbums: next };
      });
    },
    toggleFollowArtist: (artistId) => {
      if (!gateAccount("save", { kind: "followArtist", artistId })) return;
      set((state) => {
        const next = { ...state.followedArtists };
        if (next[artistId]) delete next[artistId];
        else next[artistId] = true;
        writeIdSet("ss.followedArtists", next);
        return { followedArtists: next };
      });
    },

    playTrack,
    playListOrdered,
    startPlaylistRadio,
    stopRadio,
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
    cycleShuffle,
    startShuffle,
    toggleSmartShuffle,
    cycleRepeat,
    setRate,
    setSleepTimer,
    toggleIntroTrim,
    skipIntro,
    undoIntroTrim,
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
        const queueIndex2 =
          index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex;
        lastRemoved = { item, index };
        saveQueue(queue, queueIndex2, state.current?.id ?? null);
        // Deleting an automatically generated track is a real rejection. A
        // manually queued track is NOT — the listener arranged that queue
        // themselves, so removing it says nothing about their taste.
        if (item.queueOrigin === "autoplay") {
          try {
            signalBridge?.removal({ trackId: item.id });
          } catch {
            /* ignore */
          }
        }
        return { queue, queueIndex: queueIndex2 };
      }),
    undoRemoveFromQueue: () => {
      if (!lastRemoved) return;
      const { item, index } = lastRemoved;
      lastRemoved = null;
      set((state) => {
        const i = Math.min(index, state.queue.length);
        const queue = [
          ...state.queue.slice(0, i),
          item,
          ...state.queue.slice(i),
        ];
        const queueIndex =
          i <= state.queueIndex ? state.queueIndex + 1 : state.queueIndex;
        // The remove path persists, so the undo has to as well. Without this
        // the queue looked restored in the UI, but a reload (or a crash) brought
        // the track straight back off the queue.
        saveQueue(queue, queueIndex, state.current?.id ?? null);
        return { queue, queueIndex };
      });
    },
    insertInQueue: (track, index) => {
      const item = norm(track);
      set((state) => {
        const i = Math.max(0, Math.min(index, state.queue.length));
        const queue = [
          ...state.queue.slice(0, i),
          item,
          ...state.queue.slice(i),
        ];
        const queueIndex =
          i <= state.queueIndex ? state.queueIndex + 1 : state.queueIndex;
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
      // Starts audio, so it is gated like any other playback request.
      if (
        !gatePlayback({
          kind: "playTrack",
          track: intentPlayable(item),
          list: s.queue.map((t) => intentPlayable(t)),
        })
      )
        return;
      set((state) => ({
        history: state.history.filter((_, i) => i !== index),
      }));
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
        const fresh = related.filter(
          (t) => !state.queue.some((q) => q.id === t.id),
        );
        if (fresh.length === 0) {
          toast.error("Couldn't find more songs like this right now");
          return;
        }
        const picks = state.shuffle
          ? [...fresh].sort(() => Math.random() - 0.5)
          : fresh;
        usePlayerStore.setState((st) => ({
          queue: [...st.queue, ...picks],
          unshuffledQueue: st.unshuffledQueue
            ? [...st.unshuffledQueue, ...picks]
            : null,
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
    reorderUpcoming: (upcoming, base) =>
      set((state) => {
        const start = state.queueIndex >= 0 ? state.queueIndex + 1 : 0;
        const liveUpcoming = state.queue.slice(start);
        // Staleness is judged against `base` — the list the panel RENDERED —
        // and never against `upcoming`. Comparing the NEW order to the live
        // queue cannot tell a genuine reorder from a stale render, because a
        // genuine reorder differs by definition, so the guard rejected every
        // single one: neither the up/down arrows nor drag-to-reorder did
        // anything. If a track ended (or the queue changed) between that
        // render and the drop, `base` no longer matches and the reorder is
        // ignored rather than duplicating and dropping tracks.
        if (
          !Array.isArray(base) ||
          liveUpcoming.length !== base.length ||
          liveUpcoming.some((track, i) => track.id !== base[i]?.id)
        ) {
          return {};
        }
        // A new order that does not hold exactly what is queued would lose or
        // invent tracks, so it is refused too.
        if (upcoming.length !== liveUpcoming.length) return {};
        const queue = [...state.queue.slice(0, start), ...upcoming];
        saveQueue(queue, state.queueIndex, state.current?.id ?? null);
        return { queue };
      }),
    removeQueueDuplicates: () => {
      let removed = 0;
      set((s2) => {
        const seen = new Set<string>();
        const queue: Playable[] = [];
        for (const track of s2.queue) {
          if (seen.has(track.id)) {
            removed += 1;
            continue;
          }
          seen.add(track.id);
          queue.push(track);
        }
        if (removed === 0) return {};
        // The playing track is the one entry that must survive, and the index
        // has to follow it: deduping rows above it would otherwise leave
        // queueIndex pointing at a different song and "next" would skip one.
        const playing =
          s2.current ??
          (s2.queueIndex >= 0 ? s2.queue[s2.queueIndex] : undefined);
        const found = playing
          ? queue.findIndex((t) => t.id === playing.id)
          : -1;
        const queueIndex =
          found >= 0 ? found : Math.min(s2.queueIndex, queue.length - 1);
        saveQueue(queue, queueIndex, playing?.id ?? null);
        // Same reasoning as clearQueue: an unshuffle snapshot taken before the
        // cleanup would bring every removed repeat back.
        return {
          queue,
          queueIndex,
          unshuffledQueue: null,
          unshuffledIndex: -1,
        };
      });
      return removed;
    },
    clearPlayedTracks: () => {
      let removed = 0;
      set((s2) => {
        if (s2.queueIndex <= 0) return {};
        const playing = s2.queue[s2.queueIndex] ?? s2.current;
        const upcoming = s2.queue.slice(s2.queueIndex + 1);
        const queue = playing ? [playing, ...upcoming] : upcoming;
        removed = s2.queueIndex;
        saveQueue(queue, playing ? 0 : -1, playing?.id ?? null);
        return {
          queue,
          queueIndex: playing ? 0 : -1,
          unshuffledQueue: null,
          unshuffledIndex: -1,
        };
      });
      return removed;
    },
    shuffleUpcoming: () => {
      set((s2) => {
        const start = s2.queueIndex >= 0 ? s2.queueIndex + 1 : 0;
        if (s2.queue.length - start < 2) return {};
        const head = s2.queue.slice(0, start);
        const tail = [...s2.queue.slice(start)];
        for (let i = tail.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [tail[i], tail[j]] = [tail[j], tail[i]];
        }
        const queue = [...head, ...tail];
        // The head is untouched, so queueIndex stays valid by construction.
        saveQueue(queue, s2.queueIndex, s2.current?.id ?? null);
        return { queue, unshuffledQueue: null, unshuffledIndex: -1 };
      });
    },
    clearQueue: () => {
      // A blend targeting a track that is being removed must not commit later.
      cancelTransition("queue-cleared");
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
      });
    },
    resetForSignOut: () => {
      // A blend targeting a track that is about to be discarded must not
      // commit after the sign-out and start playing on the new account.
      cancelTransition("sign-out");
      // Both decks: a crossfade can have the incoming song audible already,
      // so pausing only the live one leaves music playing with no session.
      pauseAllDecks();
      ytEngine.pause();
      // The persisted queue is the real leak — it survives the reload that
      // follows a sign-out, and it is what restores the old queue for whoever
      // signs in next.
      removeSetting(QUEUE_KEY);
      set({
        queue: [],
        queueIndex: -1,
        current: null,
        isPlaying: false,
        isBuffering: false,
        currentTime: 0,
        duration: 0,
        bufferedEnd: 0,
        history: [],
        unshuffledQueue: null,
        unshuffledIndex: -1,
        liked: {},
        likedLoaded: false,
      });
    },
    setHistoryRecorder: (fn) => {
      // Retained for compatibility. SYNQ installs the signal bridge instead,
      // so nothing currently calls it; the play it used to record is recorded
      // by SignalBridge.playStart.
      void fn;
    },
    setSignalBridge: (bridge) => {
      signalBridge = bridge;
    },
    setPendingOrigin: (origin) => {
      pendingOrigin = origin;
    },

    setLiked: (liked) => set({ liked, likedLoaded: true }),
    setLikeMutation,
    toggleLike,
  };
});
