import { create } from "zustand";
import { getAudio } from "@/lib/audio";
import type { Track } from "@/lib/catalog";
import type { RGB } from "@/lib/covers";
import { isPlayable, toPlayable, type Playable } from "@/lib/playable";
import * as ytEngine from "@/lib/youtubePlayer";

export type RepeatMode = "off" | "all" | "one";

let likeMutation: LikeMutation | null = null;

export interface LikeMutation {
  (trackId: string): Promise<boolean>;
}

/** Fire-and-forget recorder for catalog plays (wired to Convex in AppShell). */
let historyRecorder: ((trackId: string) => void) | null = null;

interface PlayerStore {
  // playback
  queue: Playable[];
  queueIndex: number;
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

  // liked songs (synced with Convex, optimistic)
  liked: Record<string, number>;
  likedLoaded: boolean;

  // actions
  playTrack: (track: Track | Playable, list?: (Track | Playable)[]) => void;
  playIndex: (index: number) => void;
  replaceCurrentStream: (playable: Playable) => void;
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
  toggleLike: (trackId: string) => void;
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
    if (s.shuffle && s.queue.length > 1) {
      const idx = s.smartShuffle ? smartIndex(s.queue.length, s.queueIndex) : randomIndex(s.queue.length, s.queueIndex);
      s.playIndex(idx);
      return;
    }
    if (s.queueIndex < s.queue.length - 1) {
      s.playIndex(s.queueIndex + 1);
      return;
    }
    if (s.repeat === "all") {
      s.playIndex(0);
      return;
    }
  }
  // end of queue, repeat off
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
  const loadTrack = (track: Playable) => {
    const prev = get().current;

    // queue history: remember what was playing before this
    if (prev && prev.id !== track.id) {
      set((state) => ({
        history: [prev, ...state.history.filter((h) => h.id !== prev.id)].slice(0, 50),
      }));
    }
    rememberTrack(track.id);

    // record catalog plays for history / most-played
    if (track.catalogTrack && historyRecorder) {
      try {
        historyRecorder(track.catalogTrack.id);
      } catch {
        /* ignore */
      }
    }

    const resumeAt = getResumePosition(track.id, track.duration);

    // Route to the YouTube IFrame engine by video id; otherwise use the audio element.
    if (track.youtubeId) {
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

  const replaceCurrentStream = (playable: Playable) => {
    const s = get();
    const index = Math.max(0, s.queueIndex);
    const queue = s.queue.map((t, i) => (i === index ? playable : t));
    set({ queue, queueIndex: index });
    loadTrack(playable);
  };

  const playIndex = (index: number) => {
    const s = get();
    if (index < 0 || index >= s.queue.length) return;
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
    if (s.shuffle && s.queue.length > 1) {
      playIndex(s.smartShuffle ? smartIndex(s.queue.length, s.queueIndex) : randomIndex(s.queue.length, s.queueIndex));
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
    if (s.shuffle && s.queue.length > 1) {
      playIndex(randomIndex(s.queue.length, s.queueIndex));
      return;
    }
    if (s.queueIndex > 0) {
      playIndex(s.queueIndex - 1);
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

  const toggleLike = (trackId: string) => {
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
    likeMutation(trackId)
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
    repeat: initialRepeat,
    rate: initialRate,

    sleepEndsAt: null,
    sleepAtSongEnd: false,

    abA: null,
    abB: null,

    queueOpen: false,
    fullscreen: false,
    accent: null,

    history: [],

    liked: {},
    likedLoaded: false,

    playTrack,
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
        return { queue, queueIndex };
      });
    },
    addToQueue: (track) => {
      const item = norm(track);
      set((state) => ({ queue: [...state.queue, item] }));
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
        return { queue, queueIndex: 0, current };
      }),
    clearQueue: () =>
      set((s2) => ({
        queue: s2.current ? [s2.current] : [],
        queueIndex: s2.current ? 0 : -1,
        current: s2.current,
      })),
    setHistoryRecorder: (fn) => {
      historyRecorder = fn;
    },

    setLiked: (liked) => set({ liked, likedLoaded: true }),
    setLikeMutation,
    toggleLike,
  };
});
