import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";
import * as ytEngine from "@/lib/youtubePlayer";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { PlayerBar } from "@/components/player/PlayerBar";
import { QueuePanel } from "@/components/player/QueuePanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { useAuth } from "@/hooks/use-auth";
import { House, ListMusic, Search, Settings, UserRound, WifiOff } from "lucide-react";
import { usePlayerStore, type RemoteLikeSnapshot } from "@/store/player";
import { track } from "@/lib/analytics";

const MOBILE_NAV = [
  { to: "/home", label: "Home", icon: House },
  { to: "/search", label: "Search", icon: Search },
  { to: "/playlists", label: "Library", icon: ListMusic },
  { to: "/profile", label: "Profile", icon: UserRound },
];

const DEFAULT_TINT = "203 244 143";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

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
  const setLiked = usePlayerStore((s) => s.setLiked);
  const setLikeMutation = usePlayerStore((s) => s.setLikeMutation);
  const setHistoryRecorder = usePlayerStore((s) => s.setHistoryRecorder);

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

  /**
   * Self-heal for "the UI won't let me click anything".
   *
   * Radix menus/dialogs/sheets lock the page by setting
   * `document.body.style.pointerEvents = "none"` while they are open. If a
   * layer is unmounted or re-rendered while open (which happens here when an
   * effect selection re-renders the player), that lock is sometimes never
   * released and EVERY click is swallowed until the same button is pressed
   * again. Nothing in Soniq should hold a body-level click lock with no layer
   * on screen, so clear the stale lock.
   */
  const radixLockWatch = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    const clearStaleBodyLock = () => {
      if (document.body.style.pointerEvents !== "none") return;
      const hasOpenLayer =
        document.querySelector(
          '[data-radix-popper-content-wrapper], [role="dialog"]:not([hidden]), [data-slot="sheet-content"], [data-slot="dropdown-menu-content"]',
        ) !== null;
      if (!hasOpenLayer) document.body.style.pointerEvents = "";
    };
    radixLockWatch.current = setInterval(clearStaleBodyLock, 300);
    // Also check right after a click, so recovery is instant.
    const onPointerDown = () => clearStaleBodyLock();
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      if (radixLockWatch.current) clearInterval(radixLockWatch.current);
      radixLockWatch.current = null;
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
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
  const tint =
    accentTheme !== "auto" && FIXED_TINTS[accentTheme]
      ? FIXED_TINTS[accentTheme]
      : accent
        ? `${accent.r} ${accent.g} ${accent.b}`
        : DEFAULT_TINT;

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background text-foreground"
      style={{ "--tint": tint } as React.CSSProperties}
    >
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {offline && (
          <div className="z-50 flex items-center justify-center gap-2 bg-amber-500/90 py-1 text-xs font-semibold text-black">
            <WifiOff className="size-3.5" />
            You're offline — check your connection
          </div>
        )}
        {/* mobile top bar */}
        <div className="liquid-glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 lg:hidden">
          <Logo to="/home" />
          <button
            type="button"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="size-[18px]" />
          </button>
        </div>

        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {/* ambient accent glow follows the current album art */}
          {ambientGlow && (
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
              compactMode && "max-w-7xl",
            )}
          >
            <Outlet />
          </div>
        </main>

        <PlayerBar compact={compactMode} />

        {/* mobile bottom nav */}
        <nav className="liquid-glass z-30 flex h-14 shrink-0 items-center justify-around border-t border-white/[0.06] pb-[env(safe-area-inset-bottom)] lg:hidden">
          {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              aria-label={label}
              className={({ isActive }) =>
                cn(
                  "flex flex-col items-center gap-0.5 px-3 py-1.5 text-[10px] font-medium transition-colors",
                  isActive
                    ? "text-[rgb(var(--tint))]"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              <Icon className="size-[20px]" />
              {label}
            </NavLink>
          ))}
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