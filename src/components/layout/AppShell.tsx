import { useEffect } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { toast } from "sonner";
import { FullscreenPlayer } from "@/components/player/FullscreenPlayer";
import { PlayerBar } from "@/components/player/PlayerBar";
import { QueuePanel } from "@/components/player/QueuePanel";
import { Sidebar } from "@/components/layout/Sidebar";
import { Logo } from "@/components/brand/Logo";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Heart, House, LibraryBig, Search } from "lucide-react";
import { usePlayerStore, type RemoteLikeSnapshot } from "@/store/player";

const MOBILE_NAV = [
  { to: "/home", label: "Home", icon: House },
  { to: "/search", label: "Search", icon: Search },
  { to: "/library", label: "Library", icon: LibraryBig },
  { to: "/liked", label: "Liked", icon: Heart },
];

const DEFAULT_TINT = "203 244 143";

export function AppShell() {
  const navigate = useNavigate();
  const accent = usePlayerStore((s) => s.accent);
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
        (current && current.id === trackId && current.source !== "catalog"
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

  // Fire-and-forget play history recording (recently / most played).
  useEffect(() => {
    setHistoryRecorder((trackId: string) => {
      void recordPlay({ trackId }).catch(() => undefined);
    });
  }, [recordPlay, setHistoryRecorder]);

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
        s.setVolume(Math.min(1, s.volume + 0.05));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        s.setVolume(Math.max(0, s.volume - 0.05));
      } else if (e.key === "ArrowUp" && e.shiftKey) {
        /* handled above */
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

  const tint = accent ? `${accent.r} ${accent.g} ${accent.b}` : DEFAULT_TINT;

  return (
    <div
      className="flex h-dvh overflow-hidden bg-background text-foreground"
      style={{ "--tint": tint } as React.CSSProperties}
    >
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <div className="glass sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4 lg:hidden">
          <Logo to="/home" />
          <nav className="flex items-center gap-1">
            {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                className={({ isActive }) =>
                  cn(
                    "rounded-full p-2 transition-colors",
                    isActive
                      ? "bg-white/[0.08] text-[rgb(var(--tint))]"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                <Icon className="size-[18px]" />
              </NavLink>
            ))}
          </nav>
        </div>

        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {/* ambient accent glow follows the current album art */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-[380px] opacity-60"
            style={{
              background: `radial-gradient(60% 100% at 50% 0%, rgb(${tint} / 0.14), transparent 70%)`,
            }}
          />
          <div className="relative mx-auto w-full max-w-6xl px-4 pt-6 pb-10 sm:px-6 lg:px-8 lg:pt-8">
            <Outlet />
          </div>
        </main>

        <PlayerBar />
      </div>

      <QueuePanel />
      <FullscreenPlayer />
    </div>
  );
}

export default AppShell;