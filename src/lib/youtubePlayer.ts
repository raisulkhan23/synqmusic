// ---------------------------------------------------------------------------
// Hidden YouTube IFrame Player engine.
//
// YouTube bot-blocks datacenter IPs that try to resolve raw stream URLs, but
// the official IFrame Player API is designed to run in the user's browser and
// is not subject to that check. This module owns one hidden iframe player and
// exposes a small imperative API that mirrors the pieces of HTMLAudioElement
// the player store relies on (play / pause / seek / volume / state events).
// ---------------------------------------------------------------------------

interface YtPlayerLike {
  loadVideoById: (id: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
}

interface YtNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: {
      height?: string;
      width?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (e: { target: YtPlayerLike }) => void;
        onStateChange?: (e: { data: number; target: YtPlayerLike }) => void;
        onError?: (e: { data: number }) => void;
      };
    },
  ) => YtPlayerLike;
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export interface YtEngineHandlers {
  /** Mirrors YT player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued */
  onStateChange?: (state: number) => void;
  /** Fired ~4x/second while playing or buffering. */
  onTime?: (currentTime: number, duration: number) => void;
  /** 2 invalid param, 5 html5 error, 100 not found, 101/150 embed disabled */
  onError?: (code: number) => void;
}

let handlers: YtEngineHandlers = {};
let player: YtPlayerLike | null = null;
let lastState = -1;
let pollTimer: ReturnType<typeof setInterval> | null = null;

let apiPromise: Promise<void> | null = null;

function loadApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    document.head.appendChild(tag);
  });
  return apiPromise;
}

// Warm the API script as early as possible so the first play click is fast.
void loadApi();

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!player) return;
    if (lastState !== 1 && lastState !== 3) return;
    let t = 0;
    let d = 0;
    try {
      t = player.getCurrentTime() ?? 0;
      d = player.getDuration() ?? 0;
    } catch {
      return;
    }
    handlers.onTime?.(t, d);
  }, 250);
}

async function ensurePlayer(): Promise<YtPlayerLike> {
  await loadApi();
  if (player) return player;
  const YT = window.YT;
  if (!YT?.Player) throw new Error("YouTube IFrame API unavailable");

  const host = document.createElement("div");
  // Off-screen but rendered — fully display:none players can refuse autoplay.
  host.style.cssText =
    "position:fixed;left:-9999px;top:0;width:200px;height:200px;opacity:0;pointer-events:none;border:0;";
  document.body.appendChild(host);

  player = await new Promise<YtPlayerLike>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("YT player init timed out")), 10_000);
    try {
      new YT.Player(host, {
        height: "200",
        width: "200",
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
        },
        events: {
          onReady: (e) => {
            clearTimeout(timeout);
            resolve(e.target);
          },
          onStateChange: (e) => {
            lastState = e.data;
            handlers.onStateChange?.(e.data);
          },
          onError: (e) => {
            handlers.onError?.(e.data);
          },
        },
      });
    } catch (err) {
      clearTimeout(timeout);
      reject(err instanceof Error ? err : new Error("YT player init failed"));
    }
  });

  startPolling();
  return player;
}

export function setHandlers(next: YtEngineHandlers): void {
  handlers = next;
}

/** Load a video and start playing. Safe to call repeatedly (reuses the player). */
export async function play(
  videoId: string,
  opts: { volume: number; muted: boolean },
): Promise<void> {
  const p = await ensurePlayer();
  p.setVolume(Math.round(Math.min(1, Math.max(0, opts.volume)) * 100));
  if (opts.muted) p.mute();
  else p.unMute();
  lastState = -1;
  p.loadVideoById(videoId);
}

export function resume(): void {
  try {
    player?.playVideo();
  } catch {
    /* not ready yet */
  }
}

export function pause(): void {
  try {
    player?.pauseVideo();
  } catch {
    /* not ready yet */
  }
}

export function seek(seconds: number): void {
  try {
    player?.seekTo(Math.max(0, seconds), true);
  } catch {
    /* not ready yet */
  }
}

/** volume in [0,1] */
export function setVolume(v: number): void {
  try {
    player?.setVolume(Math.round(Math.min(1, Math.max(0, v)) * 100));
  } catch {
    /* not ready yet */
  }
}

export function setMuted(muted: boolean): void {
  try {
    if (muted) player?.mute();
    else player?.unMute();
  } catch {
    /* not ready yet */
  }
}

/** YT error code → human message (100/101/150 = unusable video). */
export function isFatalError(code: number): boolean {
  return code === 2 || code === 5 || code === 100 || code === 101 || code === 150;
}
