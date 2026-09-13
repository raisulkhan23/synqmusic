// ---------------------------------------------------------------------------
// YouTube IFrame Player engine.
//
// YouTube bot-blocks datacenter IPs that try to resolve raw stream URLs, but
// the official IFrame Player API is designed to run in the user's browser and
// is not subject to that check. This module owns one YouTube player and
// exposes a small imperative API that mirrors the pieces of HTMLAudioElement
// the player store relies on (play / pause / seek / volume / state events).
//
// The player element lives inside `hostEl`. Normally the host is parked off-
// screen (audio-only mode); when the fullscreen player is open, the host is
// APPENDED into the fullscreen video frame so the real video is visible —
// no CSS positioning tricks, no re-parenting glitches. Playback continues
// through the same player instance the whole time.
// ---------------------------------------------------------------------------

interface YtPlayerLike {
  loadVideoById: (id: string, startSeconds?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
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
let rateVerifyTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Apply the requested rate and VERIFY it actually took. YouTube silently
 * ignores setPlaybackRate while buffering/cued and resets it on state
 * changes, so a fire-and-forget call doesn't work. We poll getPlaybackRate()
 * and re-apply until it sticks (max ~5s), and re-apply whenever playback
 * (re)starts.
 */
function applyRate(): void {
  const target = currentRate;
  const attempt = () => {
    try {
      player?.setPlaybackRate(target);
    } catch {
      /* not ready */
    }
  };
  attempt();
  if (rateVerifyTimer !== null) clearInterval(rateVerifyTimer);
  let checks = 0;
  rateVerifyTimer = setInterval(() => {
    if (!player || rateVerifyTimer === null) {
      if (rateVerifyTimer !== null) clearInterval(rateVerifyTimer);
      rateVerifyTimer = null;
      return;
    }
    let actual = 0;
    try {
      actual = player.getPlaybackRate?.() ?? 0;
    } catch {
      actual = 0;
    }
    if (actual === 0 || Math.abs(actual - target) > 0.01) {
      attempt();
    }
    if (++checks > 20) {
      if (rateVerifyTimer !== null) clearInterval(rateVerifyTimer);
      rateVerifyTimer = null;
    }
  }, 250);
}

let handlers: YtEngineHandlers = {};
let player: YtPlayerLike | null = null;
let hostEl: HTMLDivElement | null = null;
let mountEl: HTMLDivElement | null = null;
let lastState = -1;
let pollTimer: ReturnType<typeof setInterval> | null = null;

const OFFSCREEN_STYLE =
  "position:fixed;left:-9999px;top:0;width:640px;height:360px;opacity:0;pointer-events:none;border:0;overflow:hidden;z-index:-1;";

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

  // YT.Player REPLACES the element you pass it with an iframe. So we pass an
  // inner div (mountEl) and keep a stable wrapper (hostEl) that we can move
  // between the off-screen parking spot and the fullscreen video frame.
  const host = document.createElement("div");
  host.style.cssText = OFFSCREEN_STYLE;
  const mount = document.createElement("div");
  mount.style.cssText = "width:100%;height:100%;";
  host.appendChild(mount);
  document.body.appendChild(host);
  hostEl = host;
  mountEl = mount;

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
          // Strip YouTube's own UI: no branding, no annotations, no captions,
          // no fullscreen button.
          modestbranding: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          fs: 0,
        },
        events: {
          onReady: (e) => {
            clearTimeout(timeout);
            applyRate();
            resolve(e.target);
          },
          onStateChange: (e) => {
            lastState = e.data;
            handlers.onStateChange?.(e.data);
            // YouTube resets the playback rate on state changes — re-apply
            // whenever the video (re)starts playing or buffers.
            if (e.data === 1 || e.data === 3) applyRate();
            // Hide YouTube's pause overlay (related-videos grid etc.) by
            // showing our own cover while not actively playing.
            setPauseCoverVisible(e.data !== 1);
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
  // A fresh load resets the rate — the verified re-apply loop handles it.
  applyRate();
  suppressYtOverlays();
}

/**
 * YouTube overlays (title bar, end-screen links, watch-later/share buttons)
 * are rendered inside the iframe, but some sit in a same-origin shell we can
 * style. This injects one suppression stylesheet, once per session.
 */
/**
 * YouTube's own stylesheet classes are unreachable (cross-origin iframe), so
 * instead we hide its UI with OUR OWN elements layered above the player:
 * 1. an always-on "chrome shield" strip covering the title bar / top-right
 *    buttons and the bottom-right controls strip, and
 * 2. a full pause cover (dark + logo) shown whenever the video isn't playing,
 *    which hides the related-videos grid / pause overlay entirely.
 * These live in the same stacking context as the iframe, so they work.
 */
let shieldEl: HTMLDivElement | null = null;
let pauseCoverEl: HTMLDivElement | null = null;

function ensureShields(): void {
  if (!hostEl) return;
  if (!shieldEl) {
    shieldEl = document.createElement("div");
    shieldEl.style.cssText =
      "position:absolute;inset:0;pointer-events:auto;z-index:5;";
    hostEl.appendChild(shieldEl);
  }
  if (!pauseCoverEl) {
    pauseCoverEl = document.createElement("div");
    pauseCoverEl.style.cssText =
      "position:absolute;inset:0;display:none;align-items:center;justify-content:center;" +
      "background:#090a0f;z-index:6;pointer-events:none;transition:opacity .2s;";
    const logo = document.createElement("img");
    logo.src = "/logo.svg";
    logo.style.cssText = "width:56px;opacity:.5;";
    logo.onerror = () => {
      logo.style.display = "none";
    };
    pauseCoverEl.appendChild(logo);
    hostEl.appendChild(pauseCoverEl);
  }
}

/** Toggle our pause cover on top of YouTube's pause UI. */
function setPauseCoverVisible(visible: boolean): void {
  if (pauseCoverEl) pauseCoverEl.style.display = visible ? "flex" : "none";
}

function suppressYtOverlays(): void {
  ensureShields();
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

/**
 * Playback speed 0.5–2. Applied immediately and re-applied shortly after —
 * YouTube resets the rate on fresh loads and sometimes on resume, so a single
 * call is not enough.
 */
export function setRate(rate: number): void {
  currentRate = Math.min(2, Math.max(0.5, rate));
  applyRate();
}

/**
 * IMPORTANT: re-parenting an iframe in the DOM RELOADS it, which would kill
 * playback. So "presenting" the video NEVER moves the player element —
 * instead the off-screen host is fixed-positioned exactly over the fullscreen
 * video frame's rectangle. Same DOM node, same iframe, playback continues.
 */
const OVERLAY_BASE =
  // Above the fullscreen player layer (z-[70]) so the video is visible;
  // it's sized exactly over the video frame, never covering the controls.
  "position:fixed;z-index:71;pointer-events:auto;border:0;overflow:hidden;opacity:1;border-radius:16px;";

/**
 * Overlay the live player over the given fullscreen frame element (measured
 * live from its bounding rect). Returns false while the frame isn't laid out
 * or the engine isn't ready — callers should retry.
 */
export function presentOverlay(frame: HTMLElement): boolean {
  if (!hostEl || !frame) return false;
  const r = frame.getBoundingClientRect();
  if (r.width < 10 || r.height < 10) return false;
  hostEl.style.cssText =
    OVERLAY_BASE +
    `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
  return true;
}

/** Return the player to its off-screen parking spot (audio-only mode). */
export function dismissVideo(): void {
  if (!hostEl) return;
  // Never touch the parent — only reset the styling. Re-parenting would
  // reload the iframe and stop playback.
  hostEl.style.cssText = OFFSCREEN_STYLE;
}

/** The engine's player host element, so consumers can check containment. */
export function getYtHost(): HTMLElement | null {
  return hostEl;
}

/**
 * Keep the overlay glued to the frame while it's visible (window resizes,
 * lyrics panel toggling, etc.). Returns a cleanup function.
 */
export function trackFrame(frame: HTMLElement): () => void {
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    presentOverlay(frame);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}

/** YT error code → human message (100/101/150 = unusable video). */
export function isFatalError(code: number): boolean {
  return code === 2 || code === 5 || code === 100 || code === 101 || code === 150;
}
