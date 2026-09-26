import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import * as ytEngine from "@/lib/youtubePlayer";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { PlayerBar } from "@/components/player/PlayerBar";
import { QueuePanel } from "@/components/player/QueuePanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Logo } from "@/components/brand/Logo";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { useAuth } from "@/hooks/use-auth";
import { BookOpen, Briefcase, House, ListMusic, Moon, Search, Settings, UserRound, WifiOff } from "lucide-react";
import { usePlayerStore, type RemoteLikeSnapshot } from "@/store/player";
import { track } from "@/lib/analytics";
import {
  getWallpaperKey,
  getWallpaperUrl,
  IMAGE_WALLPAPER_MARKER,
  LIVE_WALLPAPER_MARKER,
} from "@/lib/wallpaperStorage";

const MOBILE_NAV = [
  { to: "/home", label: "Home", icon: House },
  { to: "/search", label: "Search", icon: Search },
  { to: "/playlists", label: "Library", icon: ListMusic },
  { to: "/profile", label: "Profile", icon: UserRound },
];

const DEFAULT_TINT = "203 244 143";
const DEFAULT_WALLPAPER_BLUR_AMOUNT = 24;
const MAX_WALLPAPER_BLUR_AMOUNT = 48;
const FOCUS_LAYOUT_IDS = ["off", "study", "work", "sleep"] as const;
type FocusLayout = (typeof FOCUS_LAYOUT_IDS)[number];
type FocusLayoutMeta = {
  label: string;
  detail: string;
  icon: typeof BookOpen;
};

const FOCUS_LAYOUTS: Record<Exclude<FocusLayout, "off">, FocusLayoutMeta> = {
  study: { label: "Study", detail: "A calm, wide reading canvas", icon: BookOpen },
  work: { label: "Work", detail: "Compact controls for deep focus", icon: Briefcase },
  sleep: { label: "Sleep", detail: "Low-light listening with an end-of-song timer", icon: Moon },
};

function isFocusLayout(value: string | null): value is FocusLayout {
  return FOCUS_LAYOUT_IDS.includes(value as FocusLayout);
}

function parseTint(value: string): [number, number, number] {
  const channels = value.trim().split(/\s+/).map(Number);
  return [
    Number.isFinite(channels[0]) ? channels[0] : 203,
    Number.isFinite(channels[1]) ? channels[1] : 244,
    Number.isFinite(channels[2]) ? channels[2] : 143,
  ];
}

/** Smoothly interpolates between track colors without re-rendering the app shell. */
function useAnimatedCssTint(target: string, elementRef: RefObject<HTMLElement | null>) {
  const currentRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const from = parseTint(currentRef.current);
    const to = parseTint(target);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const element = elementRef.current;
    if (!element) return;
    if (reducedMotion || from.every((channel, index) => channel === to[index])) {
      currentRef.current = target;
      element.style.setProperty("--tint", target);
      return;
    }

    const startedAt = performance.now();
    const duration = 650;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from.map((channel, index) =>
        Math.round(channel + (to[index] - channel) * eased),
      ).join(" ");
      currentRef.current = next;
      element.style.setProperty("--tint", next);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
      else frameRef.current = null;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [target, elementRef]);
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [sceneTheme, setSceneTheme] = useState(
    () => localStorage.getItem("ss.sceneTheme") ?? "studio",
  );
  const [trackPalettes, setTrackPalettes] = useState(
    () => localStorage.getItem("ss.trackPalettes") !== "0",
  );
  const [focusLayout, setFocusLayout] = useState<FocusLayout>(() => {
    const saved = localStorage.getItem("ss.focusLayout");
    if (isFocusLayout(saved)) return saved;
    return localStorage.getItem("ss.focusMode") === "1" ? "study" : "off";
  });
  const focusMode = focusLayout !== "off";
  const [wallpaperEnabled, setWallpaperEnabled] = useState(
    () => localStorage.getItem("ss.wallpaperEnabled") !== "0",
  );
  const [wallpaperBlurAmount, setWallpaperBlurAmount] = useState(() => {
    const storedAmount = Number(localStorage.getItem("ss.wallpaperBlurAmount"));
    if (Number.isFinite(storedAmount) && storedAmount > 0) {
      return Math.min(MAX_WALLPAPER_BLUR_AMOUNT, Math.round(storedAmount));
    }
    return localStorage.getItem("ss.wallpaperBlur") === "0" ? 0 : DEFAULT_WALLPAPER_BLUR_AMOUNT;
  });
  const rippleLayerRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLElement>(null);
  const cursorTrailRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const touchGlowTimeoutRef = useRef<number | null>(null);
  const wallpaperVideoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const pointerPositionRef = useRef({ x: 0, y: 0, target: null as HTMLDivElement | null });

  // Reset the page scroll on every navigation. `<main>` is the scroll
  // container, not the document, and the browser only resets the *document*
  // scroll — so leaving the bottom of a long Search results page and opening
  // Home dropped you in halfway down the new page. Worst on mobile, where the
  // top bar is the only thing marking the top of the content.
  useEffect(() => {
    mainScrollRef.current?.scrollTo({ top: 0, left: 0 });
  }, [location.pathname, location.search]);

  // Restore an uploaded wallpaper from IndexedDB after a page reload.
  useEffect(() => {
    const initial = usePlayerStore.getState();
    const storedWallpaperKey = getWallpaperKey(initial.wallpaper);
    const isLiveFile = initial.wallpaperType === "video" && storedWallpaperKey !== null;
    const isImageFile = initial.wallpaperType === "image" && storedWallpaperKey !== null;
    if (!isLiveFile && !isImageFile) return;

    let restoredUrl: string | null = null;
    const restore = getWallpaperUrl(storedWallpaperKey);
    void restore
      .then((url) => {
        if (!url) {
          initial.setWallpaper(null, initial.wallpaperType);
          return;
        }
        restoredUrl = url;
        initial.setWallpaper(url, initial.wallpaperType);
        // setWallpaper receives a session-only blob URL; keep only the marker.
        localStorage.setItem("ss.wallpaper", isLiveFile ? LIVE_WALLPAPER_MARKER : IMAGE_WALLPAPER_MARKER);
      })
      .catch(() => initial.setWallpaper(null, initial.wallpaperType));

    return () => {
      if (restoredUrl) URL.revokeObjectURL(restoredUrl);
    };
  }, []);

  useEffect(() => {
    const onSceneChange = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (typeof next === "string" && next) setSceneTheme(next);
    };
    const onTrackPaletteChange = (event: Event) => {
      const next = (event as CustomEvent<boolean>).detail;
      if (typeof next === "boolean") setTrackPalettes(next);
    };
    const onFocusLayoutChange = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (isFocusLayout(next)) setFocusLayout(next);
    };
    window.addEventListener("synq:scene-change", onSceneChange);
    window.addEventListener("synq:track-palettes-change", onTrackPaletteChange);
    window.addEventListener("synq:focus-layout-change", onFocusLayoutChange);
    return () => {
      window.removeEventListener("synq:scene-change", onSceneChange);
      window.removeEventListener("synq:track-palettes-change", onTrackPaletteChange);
      window.removeEventListener("synq:focus-layout-change", onFocusLayoutChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.scene = sceneTheme;
  }, [sceneTheme]);

  useEffect(() => {
    const onWallpaperEnabledChange = (event: Event) => {
      const enabled = (event as CustomEvent<boolean>).detail;
      if (typeof enabled === "boolean") setWallpaperEnabled(enabled);
    };
    const onWallpaperBlurChange = (event: Event) => {
      const nextAmount = (event as CustomEvent<number>).detail;
      if (typeof nextAmount === "number" && Number.isFinite(nextAmount)) {
        setWallpaperBlurAmount(Math.max(0, Math.min(MAX_WALLPAPER_BLUR_AMOUNT, nextAmount)));
      }
    };
    window.addEventListener("ss:wallpaper-enabled-change", onWallpaperEnabledChange);
    window.addEventListener("ss:wallpaper-blur-change", onWallpaperBlurChange);
    return () => {
      window.removeEventListener("ss:wallpaper-enabled-change", onWallpaperEnabledChange);
      window.removeEventListener("ss:wallpaper-blur-change", onWallpaperBlurChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (touchGlowTimeoutRef.current !== null) {
        window.clearTimeout(touchGlowTimeoutRef.current);
      }
      if (pointerFrameRef.current !== null) cancelAnimationFrame(pointerFrameRef.current);
    };
  }, []);

  // Offline mode banner — react to connectivity changes live.
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => {
      setOffline(true);
      toast.error("You're offline — playback may be interrupted");
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  const accent = usePlayerStore((s) => s.accent);
  const accentTheme = usePlayerStore((s) => s.accentTheme);
  const compactMode = usePlayerStore((s) => s.compactMode);
  const ambientGlow = usePlayerStore((s) => s.ambientGlow);
  const wallpaper = usePlayerStore((s) => s.wallpaper);
  const wallpaperType = usePlayerStore((s) => s.wallpaperType);
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const pointerEffects = usePlayerStore((s) => s.pointerEffects);
  const setLiked = usePlayerStore((s) => s.setLiked);
  const setLikeMutation = usePlayerStore((s) => s.setLikeMutation);
  const setHistoryRecorder = usePlayerStore((s) => s.setHistoryRecorder);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);

  // Do not keep decoding the background video while the maximized player has
  // its own full-screen media layer active.
  useEffect(() => {
    const video = wallpaperVideoRef.current;
    if (!video) return;
    if (fullscreen || isBuffering) {
      video.pause();
    } else {
      void video.play().catch(() => undefined);
    }
  }, [fullscreen, isBuffering, wallpaper, wallpaperType]);

  const likedQuery = useQuery(api.likes.myLikedTrackIds);
  const toggleLikeMutation = useMutation(api.likes.toggleLike);
  const recordPlay = useMutation(api.history.recordPlay);
  const currentUser = useQuery(api.users.currentUser);
  const claimAdminIfEmpty = useMutation(api.admin.claimAdminIfEmpty);

  // First account on the deployment becomes an admin (bootstrap).
  useEffect(() => {
    if (currentUser) void claimAdminIfEmpty();
  }, [currentUser, claimAdminIfEmpty]);

  // Route-change safety net: park any stale fullscreen video overlay and
  // guarantee the player bar is visible outside the fullscreen player.
  // (Fixes the player bar disappearing after visiting pages like /admin.)
  useEffect(() => {
    const s = usePlayerStore.getState();
    if (!s.fullscreen) ytEngine.dismissVideo();
    s.setQueueOpen(false);
     
  }, [location.pathname]);
  // Keep the player store's liked map in sync with Convex.
  useEffect(() => {
    if (likedQuery) {
      setLiked(Object.fromEntries(likedQuery.map((d) => [d.trackId, d.createdAt])));
    }
  }, [likedQuery, setLiked]);

  // Wire the store's optimistic toggle to the Convex mutation.
  // Remote tracks (YouTube/Spotify) aren't in the catalog, so we include a
  // snapshot of the currently-playing track so they can be rendered from
  // Liked Songs later.
  useEffect(() => {
    setLikeMutation((trackId: string, remote?: RemoteLikeSnapshot) => {
      const current = usePlayerStore.getState().current;
      const snapshot =
        remote ??
        (current && current.id === trackId
          ? {
              title: current.title,
              artistName: current.artistName,
              coverUrl: current.coverUrl,
              duration: current.duration,
              youtubeId: current.youtubeId,
              source: current.source,
            }
          : undefined);
      return toggleLikeMutation({ trackId, remote: snapshot });
    });
  }, [toggleLikeMutation, setLikeMutation]);

  // Fire-and-forget play history recording — records EVERY play (any source)
  // with a title/artist/cover snapshot so stats cover all music, not just one
  // provider's catalog.
  useEffect(() => {
    setHistoryRecorder((trackId: string) => {
      const current = usePlayerStore.getState().current;
      const snapshot = current && current.id === trackId
        ? {
            source: current.source,
            title: current.title,
            artistName: current.artistName,
            coverUrl: current.coverUrl,
            duration: current.duration,
          }
        : undefined;
      void recordPlay({ trackId, ...snapshot }).catch(() => undefined);
    });
  }, [recordPlay, setHistoryRecorder]);

  // Self-heal stale Radix body locks only when the user interacts. The old
  // 300ms interval ran a large selector query forever and caused needless
  // main-thread work even while the app was idle.
  useEffect(() => {
    const clearStaleBodyLock = () => {
      if (document.body.style.pointerEvents !== "none") return;
      const hasOpenLayer = document.querySelector(
        '[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-dialog-content], [data-radix-popover-content], [data-radix-hover-card-content], [data-radix-tooltip-content], [data-radix-select-content], [role="dialog"]:not([hidden]), [role="menu"], [data-slot="sheet-content"], [data-slot="dropdown-menu-content"]',
      ) !== null;
      if (!hasOpenLayer) document.body.style.pointerEvents = "";
    };
    window.addEventListener("pointerdown", clearStaleBodyLock, true);
    return () => window.removeEventListener("pointerdown", clearStaleBodyLock, true);
  }, []);

  // Session start (one per app load) + a page view on every route change.
  useEffect(() => {
    track("session_start", {
      path: window.location.pathname,
      referrer: document.referrer || "direct",
    });
  }, []);
  useEffect(() => {
    // Skip the very first render: session_start already covers the entry page.
    track("page_view", { path: location.pathname });
  }, [location.pathname]);

  // Keyboard "/" (and other nav shortcuts) route via this event.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const to = (e as CustomEvent<string>).detail;
      if (typeof to === "string") void navigate(to);
    };
    window.addEventListener("ss:navigate", onNavigate);
    return () => window.removeEventListener("ss:navigate", onNavigate);
  }, [navigate]);

  // Global keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing) return;

      const s = usePlayerStore.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.togglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        const t = s.duration > 0 ? Math.min(s.duration, s.currentTime + 5) : s.currentTime + 5;
        s.seek(t);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        s.seek(Math.max(0, s.currentTime - 5));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.05;
        s.setVolume(Math.min(1, s.volume + step));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        const step = e.shiftKey ? 0.1 : 0.05;
        s.setVolume(Math.max(0, s.volume - step));
      } else if (e.key.toLowerCase() === "m") {
        s.toggleMute();
        toast(s.muted ? "Unmuted" : "Muted");
      } else if (e.key.toLowerCase() === "n") {
        s.next();
      } else if (e.key.toLowerCase() === "p") {
        s.prev();
      } else if (e.key.toLowerCase() === "s") {
        s.toggleShuffle();
        toast(s.shuffle ? "Shuffle off" : "Shuffle on");
      } else if (e.key.toLowerCase() === "r") {
        s.cycleRepeat();
        toast(`Repeat: ${s.repeat}`);
      } else if (e.key.toLowerCase() === "q") {
        s.setQueueOpen(!s.queueOpen);
      } else if (e.key.toLowerCase() === "f") {
        s.setFullscreen(!s.fullscreen);
      } else if (e.key.toLowerCase() === "l") {
        if (s.current) s.toggleLike(s.current.id);
      } else if (e.key === "/") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("ss:navigate", { detail: "/search" }));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Fixed accent themes override the album-art-following tint.
  const FIXED_TINTS: Record<string, string> = {
    lime: "203 244 143",
    violet: "167 139 250",
    blue: "96 165 250",
    rose: "251 113 133",
    amber: "251 191 36",
    teal: "45 212 191",
    orange: "251 146 60",
  };
  const targetTint =
    trackPalettes && accent
      ? `${accent.r} ${accent.g} ${accent.b}`
      : accentTheme !== "auto" && FIXED_TINTS[accentTheme]
        ? FIXED_TINTS[accentTheme]
        : DEFAULT_TINT;
  const tint = targetTint;
  useAnimatedCssTint(targetTint, shellRef);
  const paletteForeground =
    accent && accent.r * 0.299 + accent.g * 0.587 + accent.b * 0.114 > 155
      ? "rgb(12 15 18)"
      : "rgb(250 252 255)";
  const dynamicPaletteStyle =
    trackPalettes && accent
      ? {
          "--primary": `rgb(${accent.r} ${accent.g} ${accent.b})`,
          "--primary-foreground": paletteForeground,
          "--ring": `rgb(${accent.r} ${accent.g} ${accent.b} / 0.58)`,
          "--sidebar-primary": `rgb(${accent.r} ${accent.g} ${accent.b})`,
          "--sidebar-ring": `rgb(${accent.r} ${accent.g} ${accent.b} / 0.48)`,
          "--brand": `rgb(${accent.r} ${accent.g} ${accent.b})`,
          "--brand-foreground": paletteForeground,
        }
      : {};

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointerEffects || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    pointerPositionRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      target: event.currentTarget,
    };
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const { x, y, target } = pointerPositionRef.current;
      if (!target) return;
      target.style.setProperty("--pointer-x", `${x}px`);
      target.style.setProperty("--pointer-y", `${y}px`);
      for (const mote of cursorTrailRefs.current) {
        if (!mote) continue;
        mote.style.left = `${x}px`;
        mote.style.top = `${y}px`;
      }
    });
  };

  const handlePointerEnter = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerEffects && event.pointerType !== "touch") {
      event.currentTarget.style.setProperty("--pointer-opacity", "1");
    }
  };

  const handlePointerLeave = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.style.setProperty("--pointer-opacity", "0");
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointerEffects || !rippleLayerRef.current) return;

    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--pointer-x", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--pointer-y", `${event.clientY - rect.top}px`);

    // Touch devices have no cursor to trail. A short accent bloom at the
    // contact point gives them the same liquid-light response without
    // rendering desktop cursor motes.
    if (event.pointerType === "touch") {
      event.currentTarget.style.setProperty("--pointer-opacity", "1");
      if (touchGlowTimeoutRef.current !== null) {
        window.clearTimeout(touchGlowTimeoutRef.current);
      }
      touchGlowTimeoutRef.current = window.setTimeout(() => {
        event.currentTarget.style.setProperty("--pointer-opacity", "0");
        touchGlowTimeoutRef.current = null;
      }, 720);
    }

    const layer = rippleLayerRef.current;
    const ripple = document.createElement("span");
    ripple.className = "click-ripple";
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    layer.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 720);
  };

  return (
    <div
      ref={shellRef}
      className={cn(
        "theme-surface relative isolate flex h-dvh overflow-hidden bg-background text-foreground",
        compactMode && "compact-shell",
        focusLayout === "study" && "focus-study",
        focusLayout === "work" && "focus-work",
        focusLayout === "sleep" && "focus-sleep",
      )}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      style={
        {
          "--tint": tint,
          "--pointer-x": "50%",
          "--pointer-y": "50%",
          "--pointer-opacity": "0",
          ...dynamicPaletteStyle,
        } as unknown as React.CSSProperties
      }
    >
      {!focusMode && (
        <>
          <div className="ambient-grid pointer-events-none absolute inset-0 -z-20 opacity-70" aria-hidden="true" />
          <div className="aurora-orb aurora-orb-one pointer-events-none absolute -top-48 -left-32 -z-10 size-[34rem] rounded-full" aria-hidden="true" />
          <div className="aurora-orb aurora-orb-two pointer-events-none absolute -right-48 bottom-[-16rem] -z-10 size-[42rem] rounded-full" aria-hidden="true" />
        </>
      )}
      {pointerEffects && !focusMode && (
        <>
          <div className="pointer-glow pointer-events-none absolute inset-0 -z-[5]" aria-hidden="true" />
          <div
            className="cursor-trail-layer pointer-events-none absolute inset-0 z-[90] overflow-hidden"
            aria-hidden="true"
          >
            {Array.from({ length: 5 }, (_, index) => (
              <span
                key={index}
                ref={(node) => {
                  cursorTrailRefs.current[index] = node;
                }}
                className="cursor-trail"
              />
            ))}
          </div>
          <div ref={rippleLayerRef} className="touch-ripple-layer pointer-events-none absolute inset-0 -z-[4] overflow-hidden" aria-hidden="true" />
        </>
      )}
      {wallpaperEnabled && wallpaper && wallpaper !== LIVE_WALLPAPER_MARKER && wallpaper !== IMAGE_WALLPAPER_MARKER && (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-background/35" aria-hidden="true">
          {wallpaperType === "video" ? (
            <video
              ref={wallpaperVideoRef}
              src={wallpaper}
              autoPlay
              muted
              loop
              playsInline
              className="size-full scale-110 object-cover"
              style={{ filter: wallpaperBlurAmount > 0 ? `blur(${wallpaperBlurAmount}px)` : undefined }}
            />
          ) : (
            <img
              src={wallpaper}
              alt=""
              className="size-full scale-110 object-cover"
              style={{ filter: wallpaperBlurAmount > 0 ? `blur(${wallpaperBlurAmount}px)` : undefined }}
            />
          )}
          <div className="absolute inset-0 bg-background/45" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/10 to-background/55" />
        </div>
      )}
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {offline && (
          <div className="z-50 flex items-center justify-center gap-2 bg-amber-500/90 py-1 text-xs font-semibold text-black">
            <WifiOff className="size-3.5" />
            You're offline — check your connection
          </div>
        )}
        {/* mobile top bar */}
        {/* `env(safe-area-inset-top)` is added to the height AND used as padding:
            the shell is h-dvh, so on a notched phone the logo and settings
            button were rendering underneath the status bar / notch. */}
        <div className="mobile-topbar liquid-glass sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] shrink-0 items-center justify-between border-b border-white/[0.06] px-4 pt-[env(safe-area-inset-top)] lg:hidden">
          <Logo to="/home" />
          <button
            type="button"
            aria-label="Settings"
            onClick={() => void navigate("/settings")}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="size-[18px]" />
          </button>
        </div>

        {focusMode && (
          <div className="focus-session-bar liquid-glass flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-2.5 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              {(() => {
                const Icon = FOCUS_LAYOUTS[focusLayout].icon;
                return <Icon className="size-4 shrink-0 text-[rgb(var(--tint))]" />;
              })()}
              <div className="min-w-0">
                <p className="text-xs font-semibold">Listening session · {FOCUS_LAYOUTS[focusLayout].label}</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {FOCUS_LAYOUTS[focusLayout].detail}
                </p>
              </div>
            </div>
            {focusLayout === "sleep" && (
              <button
                type="button"
                onClick={() => setSleepTimer(sleepAtSongEnd ? null : "end")}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                  sleepAtSongEnd
                    ? "border-[rgb(var(--tint))] bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))]"
                    : "border-white/10 text-muted-foreground hover:border-white/25 hover:text-foreground",
                )}
              >
                {sleepAtSongEnd ? "Timer armed" : "Stop after this song"}
              </button>
            )}
          </div>
        )}

        {/* overflow-x is clipped: a single over-wide row must never give the
            page a horizontal scrollbar on a phone. Nested `overflow-x-auto`
            rails inside a page still scroll normally. */}
        <main
          ref={mainScrollRef}
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          {/* ambient accent glow follows the current album art */}
          {ambientGlow && !focusMode && (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-[380px] opacity-60"
              style={{
                background: `radial-gradient(60% 100% at 50% 0%, rgb(${tint} / 0.14), transparent 70%)`,
              }}
            />
          )}
          <div
            className={cn(
              "relative mx-auto w-full max-w-6xl px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8",
              compactMode && "max-w-5xl",
              focusLayout === "study" && "max-w-7xl",
              focusLayout === "work" && "max-w-5xl",
              focusLayout === "sleep" && "max-w-4xl",
            )}
          >
            <Outlet />
          </div>

          {/* Site footer, shared with the landing page so every route ends the
              same way. It lives INSIDE <main> (the scroll container) rather
              than beside the player: as a sibling it would become a fixed
              flex item that eats vertical space and squeezes the app on a
              phone. Hidden in a focus session, where a footer is exactly the
              kind of thing the mode exists to remove. */}
          {!focusMode && <SiteFooter />}
        </main>

        <PlayerBar compact={compactMode || focusLayout === "work" || focusLayout === "sleep"} />

        {/* Mobile bottom nav. Display, column count, stacking AND the desktop
            hide are all owned by `.mobile-bottom-nav` in index.css. They were
            inline styles, which silently overrode `lg:hidden` — an inline
            declaration wins over any stylesheet rule without `!important` — so
            the phone nav rendered on desktop right next to the real sidebar. */}
        <nav
          className="mobile-bottom-nav liquid-glass h-[calc(3.5rem+env(safe-area-inset-bottom))] shrink-0 border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)]"
        >
          {MOBILE_NAV.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to;
            return (
              <button
                key={to}
                type="button"
                onClick={() => void navigate(to)}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                style={{
                  display: "flex",
                  width: "100%",
                  minWidth: 0,
                  height: "100%",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  touchAction: "manipulation",
                }}
                className={cn(
                  "mobile-nav-item touch-manipulation select-none rounded-2xl px-1 py-1.5 text-[10px] font-medium transition-colors duration-150",
                  isActive
                    ? "mobile-nav-item-active text-[rgb(var(--tint))]"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="size-[20px] shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      <QueuePanel />
      <FullscreenPlayer />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSignOut={async () => {
          await signOut();
          navigate("/");
        }}
      />
    </div>
  );
}

export default AppShell;