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
  loadVideoById: (id: string, startSeconds?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (rate: number) => void;
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

let currentRate = 1;

let handlers: YtEngineHandlers = {};
let player: YtPlayerLike | null = null;
let hostEl: HTMLDivElement | null = null;
let lastState = -1;
let pollTimer: ReturnType<typeof setInterval> | null = null;

// Video presentation: when set, the (otherwise hidden) player iframe is
// positioned over this rect provider's target so the fullscreen view can show
// the actual video. Pure CSS — the iframe is never re-parented, so playback
// never interrupts.
let presentTarget: (() => DOMRect | null) | null = null;

const OFFSCREEN_STYLE =
  "position:fixed;left:-9999px;top:0;width:640px;height:360px;opacity:0;pointer-events:none;border:0;overflow:hidden;";
const PRESENT_BASE_STYLE =
  "position:fixed;z-index:80;opacity:1;pointer-events:auto;border:0;border-radius:16px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,0.6);";

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

  // IMPORTANT: YT.Player *replaces* the element you pass it with an iframe.
  // So we pass an inner div and keep a stable wrapper (hostEl) in the DOM —
  // presentation CSS targets the wrapper, and the iframe fills it.
  const host = document.createElement("div");
  // Off-screen but rendered — fully display:none players can refuse autoplay.
  host.style.cssText = OFFSCREEN_STYLE;
  const mount = document.createElement("div");
  mount.style.cssText = "width:100%;height:100%;";
  host.appendChild(mount);
  document.body.appendChild(host);
  hostEl = host;

  player = await new Promise<YtPlayerLike>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("YT player init timed out")), 10_000);
    try {
      new YT.Player(mount, {
        height: "100%",
        width: "100%",
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
            try {
              e.target.setPlaybackRate(currentRate);
            } catch {
              /* rate applied later on load */
            }
            resolve(e.target);
          },
          onStateChange: (e) => {
            lastState = e.data;
            handlers.onStateChange?.(e.data);
            // State 0 (ended) doesn't fire onTime again — push a final time
            // sample so the store can run A-B repeat / auto-advance logic.
            if (e.data === 0) {
              try {
                const d = e.target.getDuration() ?? 0;
                handlers.onTime?.(d > 0 ? d : 0, d);
              } catch {
                /* ignore */
              }
            }
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

  // The mount element has been replaced by the iframe — make the iframe fill
  // the wrapper so presentVideo() can size the wrapper freely.
  const iframe = mount.querySelector("iframe") ?? (mount.nextElementSibling instanceof HTMLIFrameElement ? mount.nextElementSibling : null);
  if (iframe) {
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
  }

  return player;
}

export function setHandlers(next: YtEngineHandlers): void {
  handlers = next;
}

/** Load a video and start playing. Safe to call repeatedly (reuses the player). */
export async function play(
  videoId: string,
  opts: { volume: number; muted: boolean; startSeconds?: number },
): Promise<void> {
  const p = await ensurePlayer();
  p.setVolume(Math.round(Math.min(1, Math.max(0, opts.volume)) * 100));
  if (opts.muted) p.mute();
  else p.unMute();
  try {
    p.setPlaybackRate(currentRate);
  } catch {
    /* ignore */
  }
  lastState = -1;
  p.loadVideoById(videoId, Math.max(0, opts.startSeconds ?? 0));
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

/** Playback speed 0.5–2. Applied to the current player and remembered. */
export function setRate(rate: number): void {
  currentRate = Math.min(2, Math.max(0.5, rate));
  try {
    // Apply now for the playing track...
    player?.setPlaybackRate(currentRate);
  } catch {
    /* not ready yet */
  }
  try {
    // ...and once more after the player finishes buffering, since a fresh
    // loadVideoById can reset the rate back to 1 while it prepares.
    player?.getDuration ?? null;
    const p = player;
    if (p) {
      setTimeout(() => {
        try {
          p.setPlaybackRate(currentRate);
        } catch {
          /* gone */
        }
      }, 400);
    }
  } catch {
    /* ignore */
  }
}

/** YT error code → human message (100/101/150 = unusable video). */
export function isFatalError(code: number): boolean {
  return code === 2 || code === 5 || code === 100 || code === 101 || code === 150;
}

// --- video presentation (fullscreen video mode) ------------------------------

let rafId: number | null = null;

function syncPresentation(): void {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!hostEl) return;
    if (!presentTarget) {
      hostEl.style.cssText = OFFSCREEN_STYLE;
      return;
    }
    const rect = presentTarget();
    if (!rect) {
      hostEl.style.cssText = OFFSCREEN_STYLE;
      return;
    }
    hostEl.style.cssText =
      PRESENT_BASE_STYLE +
      `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  });
}

/**
 * Show the live YouTube video over the element described by `getRect` (its
 * bounding box). The iframe is moved with CSS only, so playback continues
 * uninterrupted. While presented, position is kept in sync on resize/scroll.
 */
export function presentVideo(getRect: () => DOMRect | null): void {
  presentTarget = getRect;
  syncPresentation();
  window.addEventListener("resize", syncPresentation);
  window.addEventListener("scroll", syncPresentation, true);
}

/** Hide the video again — the player returns off-screen, still playing. */
export function dismissVideo(): void {
  presentTarget = null;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  if (hostEl) hostEl.style.cssText = OFFSCREEN_STYLE;
  window.removeEventListener("resize", syncPresentation);
  window.removeEventListener("scroll", syncPresentation, true);
}
