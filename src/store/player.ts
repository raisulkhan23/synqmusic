import { create } from "zustand";
import { getAudio, setAudioFilter, type AudioFilterId } from "@/lib/audio";
import { trackById, type Track } from "@/lib/catalog";
import { similarTracks } from "@/lib/catalog";
import type { RGB } from "@/lib/covers";
import { isPlayable, toPlayable, toPlayableYoutube, type Playable } from "@/lib/playable";
import * as ytEngine from "@/lib/youtubePlayer";
import type { YtItem } from "@/lib/youtube";
import { api } from "@/convex/_generated/api";
import { ConvexClient } from "convex/browser";

/**
 * Resolve a direct audio stream URL for a YouTube video via the Convex
 * backend (vanilla client — usable outside React). Used only when an audio
 * effect needs the stream on the <audio> element. Returns null on failure.
 */
let ytResolveClient: ConvexClient | null = null;
let ytSearchClient: ConvexClient | null = null;
const ytResolve = async (videoId: string): Promise<string | null> => {
  try {
    ytResolveClient = ytResolveClient ?? new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
    const res = await ytResolveClient.action(api.youtube.resolveStream, { videoId });
    return res?.url ?? null;
  } catch {
    return null;
  }
};

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
  playTrack: (track: Track | Playable, list?: (Track | Playable)[]) => void;
  /** Start an endless related-mix radio from any track (any source). */
  startRadio: (track: Track | Playable) => void;
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
  insertInQueue: (track: Track | Playable, index: number) => void;
  addToQueue: (track: Track | Playable) => void;
  playFromHistory: (index: number) => void;
  replaceUpcoming: (upcoming: Playable[]) => void;
  clearQueue: () => void;
  setHistoryRecorder: (fn: ((trackId: string) => void) | null) => void;

  setLiked: (liked: Record<string, number>) => void;
  setLikeMutation: (fn: LikeMutation | null) => void;
  toggleLike: (trackId: string, remote?: RemoteLikeSnapshot) => void;
}

// --- queue persistence (survives refresh) -----------------------------------

interface PersistedPlayable {
  id: string;
  catalogId?: string;
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
  catalogId: p.catalogTrack?.id,
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
      if (p.catalogId) {
        const t = trackById(p.catalogId);
        if (t) { items.push(toPlayable(t)); continue; }
      }
      if (p.youtubeId && p.title) {
        items.push({
          id: p.id,
          source: "youtube",
          youtubeId: p.youtubeId,
          title: p.title,
          artistName: p.artistName ?? "Unknown artist",
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
const initialVideoEnabled = readBool("ss.video", true);
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

// --- last-played memory (any source) ------------------------------------------

const LAST_PLAYED_KEY = "ss.lastPlayed";

export interface LastPlayedSnapshot {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  coverUrl: string;
  duration: number;
  source: "catalog" | "youtube";
  youtubeId?: string;
  audioUrl: string;
  at: number;
}

export function readLastPlayed(): LastPlayedSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_PLAYED_KEY);
    if (!raw) return null;
    const snap = JSON.parse(raw) as LastPlayedSnapshot;
    return snap && snap.id ? snap : null;
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

function loadHistory(): HistoryEntry[] {
  if (historyCache) return historyCache;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    historyCache = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
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
  const history = loadHistory();
  const existing = history.find((h) => h.id === track.id);
  if (existing) {
    existing.playCount += 1;
    existing.at = Date.now();
    const i = history.indexOf(existing);
    history.splice(i, 1);
    history.unshift(existing);
  } else {
    history.unshift({ ...lastSnapshotOf(track), playCount: 1 });
  }
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable */
  }
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
}

const randomIndex = (length: number, exclude: number): number => {
  if (length <= 1) return 0;
  let i = Math.floor(Math.random() * length);
  if (i === exclude) i = (i + 1) % length;
  return i;
};

/** Random queue index that prefers tracks not recently heard. */
function smartIndex(length: number, exclude: number): number {
  if (length <= 1) return 0;
  const candidates: number[] = [];
  for (let i = 0; i < length; i++) {
    if (i === exclude) continue;
    const id = usePlayerStore.getState().queue[i]?.id;
    if (id && recentTrackIds.includes(id)) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return randomIndex(length, exclude);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- shared end-of-track handling ----------------------------------------------

let sleepCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastResumeSave = 0;

function restartCurrent(): void {
  const s = usePlayerStore.getState();
  s.seek(0);
  if (s.current?.youtubeId) ytEngine.resume();
  else void getAudio().play().catch(() => undefined);
}

/**
 * Local similar tracks for a seed (catalog-aware; empty for YouTube seeds).
 * Returned as Playables ready for the queue.
 */
function similarTracksFor(seed: Playable): Playable[] {
  if (seed.catalogTrack) {
    return similarTracks(seed.catalogTrack.id, 10).map(toPlayable);
  }
  return [];
}

/** In-flight related-mix fetch, deduped per seed so track-end doesn't double-fire. */
let relatedMixInFlight: { seedId: string; promise: Promise<Playable[]> } | null = null;

/**
 * Fetch a related-mix from YouTube Music based on the seed track's title +
 * artist. Returns Playables ready for the queue (empty on failure).
 */
async function fetchRelatedMix(seed: Playable, existingQueue: Playable[], count: number): Promise<Playable[]> {
  if (relatedMixInFlight?.seedId === seed.id) return relatedMixInFlight.promise;
  const promise = (async () => {
    try {
      ytSearchClient = ytSearchClient ?? new ConvexClient(import.meta.env.VITE_CONVEX_URL as string);
      const query = `${seed.title} ${seed.artistName.split(",")[0]?.trim() ?? ""} similar songs`.trim();
      const res = await ytSearchClient.action(api.youtube.searchYoutube, { query });
      const items = res?.items ?? [];
      const existing = new Set(existingQueue.map((t) => t.id));
      existing.add(seed.id);
      return items
        .filter((it: YtItem) => !existing.has(it.id))
        .slice(0, count)
        .map((it: YtItem) => toPlayableYoutube(it, ""));
    } catch {
      return [];
    }
  })();
  relatedMixInFlight = { seedId: seed.id, promise };
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
    // Queue is physically shuffled when shuffle is on — advance in order.
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
  // Works for ANY source: catalog tracks use the local similarity index,
  // YouTube tracks (and the catalog fallback) fetch a related mix from
  // YouTube Music so the music never stops.
  if (s.autoplay && s.current) {
    const seed = s.current;
    const known = similarTracksFor(seed)
      .filter((t) => !s.queue.some((q) => q.id === t.id) && t.id !== seed.id)
      .slice(0, 5);
    if (known.length > 0) {
      usePlayerStore.setState((state) => ({
        queue: [...state.queue, ...known],
      }));
      s.playIndex(s.queue.length);
      return;
    }
    // No local candidates (e.g. a YouTube track) — fetch related tracks
    // from YouTube Music, then keep playing without user interaction.
    void fetchRelatedMix(seed, s.queue, 5).then((related) => {
      const state = usePlayerStore.getState();
      const fresh = related.filter((t) => !state.queue.some((q) => q.id === t.id));
      if (fresh.length === 0) return;
      usePlayerStore.setState((st) => ({
        queue: [...st.queue, ...fresh],
      }));
      // Only auto-advance if nothing else started playing meanwhile.
      const after = usePlayerStore.getState();
      if (after.current?.id === seed.id && !after.isPlaying) {
        after.playIndex(after.queue.length - fresh.length);
      }
    });
    return;
  }
  getAudio().pause();
  ytEngine.pause();
  s.seek(0);
  usePlayerStore.setState({ isPlaying: false, currentTime: 0 });
}

/** A-B repeat + resume-position bookkeeping, run on every time update. */
function onTimeUpdate(t: number, duration: number): void {
  const s = usePlayerStore.getState();
  if (s.abA !== null && s.abB !== null && t >= s.abB) {
    if (s.current?.youtubeId) ytEngine.seek(s.abA);
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
function wireAudio() {
  if (wired) return;
  wired = true;
  const audio = getAudio();
  audio.volume = initialVolume;
  audio.muted = initialMuted;
  audio.playbackRate = initialRate;

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

  audio.addEventListener("waiting", () => usePlayerStore.setState({ isBuffering: true }));
  audio.addEventListener("playing", () => usePlayerStore.setState({ isBuffering: false, isPlaying: true }));
  audio.addEventListener("pause", () => usePlayerStore.setState({ isPlaying: false, isBuffering: false }));
  audio.addEventListener("play", () => usePlayerStore.setState({ isPlaying: true }));

  audio.addEventListener("ended", () => {
    handleEnded();
  });

  audio.addEventListener("error", () => {
    usePlayerStore.setState((s) => ({
      isBuffering: false,
      isPlaying: false,
      errorNonce: s.errorNonce + 1,
    }));
  });
}

// --- youtube iframe engine wiring --------------------------------------------

let ytWired = false;
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
      if (ytEngine.isFatalError(code)) {
        usePlayerStore.setState((s) => ({
          isBuffering: false,
          isPlaying: false,
          errorNonce: s.errorNonce + 1,
        }));
      }
    },
  });
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

  const norm = (t: Track | Playable): Playable => (isPlayable(t) ? t : toPlayable(t));

  let lastRemoved: { item: Playable; index: number } | null = null;

  /** Route loading/playback to the right engine for the given track. */
  const loadTrack = (track: Playable, startSeconds?: number) => {
    const prev = get().current;

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
    if (track.catalogTrack && historyRecorder) {
      try {
        historyRecorder(track.catalogTrack.id);
      } catch {
        /* ignore */
      }
    }

    const resumeAt = startSeconds ?? getResumePosition(track.id, track.duration);

    // Route to the YouTube IFrame engine by video id; otherwise use the audio element.
    // EXCEPTION: when an audio effect is active, YouTube tracks play through
    // the <audio> element with a resolved direct stream instead — the IFrame
    // engine can't be tapped by Web Audio, so effects would be silent no-ops.
    if (track.youtubeId) {
      const wantFilter = get().audioFilter !== "off";
      if (wantFilter && track.youtubeId) {
        void resolveAndPlayWithFilter(track, resumeAt);
        return;
      }
      getAudio().pause();
      ytEngine
        .play(track.youtubeId, { volume: get().volume, muted: get().muted, startSeconds: resumeAt || undefined })
        .catch(() => {
          set({ isPlaying: false, isBuffering: false, errorNonce: get().errorNonce + 1 });
        });
    } else {
      ytEngine.pause();
      const audio = getAudio();
      audio.src = track.audioUrl;
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
      // Actually start playback. loadTrack is always reached from a user
      // gesture (row click) or auto-advance, so autoplay is permitted —
      // without this the song only loads and needs a second click.
      void audio.play().catch(() => undefined);
    }
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
    syncMediaSession(track, true);
  };

  const playTrack = (track: Track | Playable, list?: (Track | Playable)[]) => {
    const list2 =
      list && list.length > 0 ? list.map(norm) : [norm(track)];
    const idx = list2.findIndex((t) => t.id === track.id);
    const index = idx >= 0 ? idx : 0;
    set({ queue: list2, queueIndex: index });
    loadTrack(list2[index]);
  };

  const startRadio = (track: Track | Playable) => {
    const seed = norm(track);
    const local = similarTracksFor(seed).filter((t) => t.id !== seed.id).slice(0, 15);
    // Build a queue immediately: seed first, local mix if available; if the
    // seed is a YouTube track (or the local mix is empty), fetch the related
    // mix from YouTube Music in the background and append as it arrives.
    const initial: Playable[] = [seed, ...local];
    set({ queue: initial, queueIndex: 0 });
    loadTrack(seed);
    if (local.length < 5) {
      void fetchRelatedMix(seed, initial, 15).then((related) => {
        const fresh = related.filter((t) => !get().queue.some((q) => q.id === t.id));
        if (fresh.length === 0) return;
        usePlayerStore.setState((st) => ({ queue: [...st.queue, ...fresh] }));
        saveQueue(
          usePlayerStore.getState().queue,
          usePlayerStore.getState().queueIndex,
          usePlayerStore.getState().current?.id ?? null,
        );
      });
    }
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
  };

  const togglePlay = () => {
    const s = get();
    if (s.current) {
      if (s.current.youtubeId) {
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
    // Queue is physically shuffled when shuffle is on, so just advance.
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
    if (s.current?.youtubeId) {
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
    const next = !get().shuffle;
    localStorage.setItem("ss.shuffle", next ? "1" : "0");
    // Physically reorder the queue so shuffle takes effect immediately and the
    // queue panel reflects it. The currently playing track keeps its slot; the
    // rest are Fisher–Yates shuffled. Turning shuffle off restores the saved
    // original order.
    const s = get();
    if (s.queue.length > 2) {
      const currentId = s.queueIndex >= 0 ? s.queue[s.queueIndex]?.id : null;
      if (next) {
        if (s.unshuffledQueue === null) {
          set({ unshuffledQueue: [...s.queue], unshuffledIndex: s.queueIndex });
        }
        const current = currentId ? s.queue[s.queueIndex] : null;
        const rest = s.queue.filter((_, i) => i !== s.queueIndex);
        for (let i = rest.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [rest[i], rest[j]] = [rest[j], rest[i]];
        }
        const newQueue = current ? [current, ...rest] : rest;
        set({ queue: newQueue, queueIndex: current ? 0 : -1 });
        saveQueue(newQueue, current ? 0 : -1, currentId);
      } else if (s.unshuffledQueue !== null) {
        const restored = s.unshuffledQueue;
        let idx = s.unshuffledIndex;
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
    setAudioFilter(id);
    set({ audioFilter: id });
    // If a YouTube track is currently playing via the IFrame engine and an
    // effect was just activated, hot-swap it onto the filtered audio path.
    const s = get();
    if (id !== "off" && s.current?.youtubeId && !s.current.audioUrl.includes("googlevideo")) {
      const resumeAt = s.currentTime;
      void resolveAndPlayWithFilter(s.current, resumeAt);
    }
    // If the effect was turned off while a YouTube track is on the audio
    // element, swap back to the IFrame engine (better quality/reliability).
    if (id === "off" && s.current?.youtubeId && s.current.audioUrl.includes("googlevideo")) {
      const resumeAt = s.currentTime;
      getAudio().pause();
      void ytEngine
        .play(s.current.youtubeId, { volume: s.volume, muted: s.muted, startSeconds: resumeAt })
        .catch(() => undefined);
    }
  };

  /**
   * Resolve a direct audio URL for a YouTube track and play it through the
   * audio element so the Web Audio effect chain applies. Falls back to the
   * IFrame engine when resolution fails.
   */
  const resolveAndPlayWithFilter = (track: Playable, resumeAt: number) => {
    const videoId = track.youtubeId;
    if (!videoId) return;
    set({ isBuffering: true });
    ytResolve(videoId)
      .then((url) => {
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
      })
      .catch(() => {
        // Fall back to the unfiltered IFrame engine so playback never dies.
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
    set((s) => (which === "a" ? { abA: seconds } : { abB: seconds }));
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
        return { videoEnabled: next };
      }),

    sleepEndsAt: null,
    sleepAtSongEnd: false,

    abA: null,
    abB: null,

    queueOpen: false,
    fullscreen: false,
    accent: null,

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
    setFullscreen: (fullscreen) => set({ fullscreen }),
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
    replaceUpcoming: (upcoming) =>
      set((state) => {
        const current = state.queue[state.queueIndex] ?? null;
        const queue = current ? [current, ...upcoming] : [...upcoming];
        saveQueue(queue, current ? 0 : -1, current?.id ?? null);
        return { queue, queueIndex: current ? 0 : -1, current };
      }),
    clearQueue: () =>
      set((s2) => {
        const queue = s2.current ? [s2.current] : [];
        saveQueue(queue, s2.current ? 0 : -1, s2.current?.id ?? null);
        return { queue, queueIndex: s2.current ? 0 : -1, current: s2.current };
      }),
    setHistoryRecorder: (fn) => {
      historyRecorder = fn;
    },

    setLiked: (liked) => set({ liked, likedLoaded: true }),
    setLikeMutation,
    toggleLike,
  };
});
