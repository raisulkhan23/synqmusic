import { useMemo, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { PlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { usePlayerStore } from "@/store/player";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import {
  ArrowRightFromLine,
  ArrowRightToLine,
  BarChart3,
  Heart,
  History,
  House,
  Library,
  ListMusic,
  Plus,
  Radio,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Link, NavLink, useNavigate } from "react-router";

type Filter = "playlists" | "liked" | "recent";

export function Sidebar() {
  const { user, signOut } = useAuth();
  const hideEmail = usePlayerStore((s) => s.hideSidebarEmail);
  const collapsed = usePlayerStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = usePlayerStore((s) => s.toggleSidebarCollapsed);
  const navigate = useNavigate();
  const playlists = useQuery(api.playlists.myPlaylists);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter | "all">("all");

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const visiblePlaylists = useMemo(() => {
    if (!playlists) return playlists;
    if (filter === "all" || filter === "playlists") return playlists;
    return [];
  }, [playlists, filter]);

  const initials =
    user?.name
      ?.split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() ?? "U";

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
      isActive
        ? "bg-white/[0.07] text-foreground"
        : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
    );

  if (collapsed) {
    return (
      <aside className="liquid-glass hidden w-[72px] shrink-0 flex-col items-center overflow-hidden border-r border-white/[0.06] py-3 lg:flex">
        <Logo
          to="/home"
          iconOnly
          className="mb-2 flex size-10 items-center justify-center rounded-lg hover:bg-white/[0.05]"
        />
        {[
          { to: "/home", label: "Home", icon: House },
          { to: "/search", label: "Search", icon: Search },
          { to: "/playlists", label: "Your Library", icon: Library },
          { to: "/liked", label: "Liked Songs", icon: Heart },
          { to: "/recent", label: "Recently Played", icon: History },
          { to: "/social", label: "Listening Rooms", icon: Radio },
        ].map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to + label}
            to={to}
            title={label}
            aria-label={label}
            className={({ isActive }) =>
              cn(
                "mb-0.5 flex size-10 items-center justify-center rounded-lg transition-colors",
                isActive
                  ? "bg-white/[0.07] text-foreground"
                  : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )
            }
          >
            <Icon className="size-[20px]" />
          </NavLink>
        ))}
        {user?.role === "admin" && (
          <NavLink
            to="/admin"
            title="Admin"
            className={({ isActive }) =>
              cn(
                "mb-0.5 flex size-10 items-center justify-center rounded-lg transition-colors",
                isActive ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:text-foreground",
              )
            }
          >
            <ShieldCheck className="size-[20px] text-[rgb(var(--tint))]" />
          </NavLink>
        )}

        <div className="my-2 h-px w-8 bg-white/[0.06]" />

        <button
          type="button"
          aria-label="New playlist"
          title="New playlist"
          onClick={() => setDialogOpen(true)}
          className="mb-0.5 flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
        >
          <Plus className="size-[20px]" />
        </button>
        <Link
          to="/playlists"
          title="All playlists"
          className="mb-0.5 flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
        >
          <ListMusic className="size-[20px]" />
        </Link>

        {/* playlist covers, Spotify collapsed style */}
        <div className="mt-2 flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
          {playlists?.slice(0, 12).map((p) => (
            <Link
              key={p._id}
              to={`/playlist/${p._id}`}
              title={p.name}
              className="size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10 transition-transform hover:scale-105"
            >
            <span
              className="size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10 transition-transform hover:scale-105"
              style={{ background: "linear-gradient(135deg, rgb(var(--tint) / 0.35), rgb(var(--tint) / 0.1))" }}
            >
              <span className="flex size-full items-center justify-center">
                <ListMusic className="size-4 text-[rgb(var(--tint))]" />
              </span>
            </span>
            </Link>
          ))}
        </div>

        <button
          type="button"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          onClick={toggleCollapsed}
          className="flex size-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
        >
          <ArrowRightFromLine className="size-[18px]" />
        </button>

        <div className="mt-2 flex flex-col items-center gap-1 border-t border-white/[0.06] pt-3">
          <NavLink
            to="/profile"
            title="Profile"
            className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-[rgb(var(--tint))] text-sm font-bold text-black ring-2 ring-white/10"
          >
            {user?.image ? <img src={user.image} alt="" className="size-full object-cover" /> : initials}
          </NavLink>
          <button
            type="button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          >
            <Settings className="size-4" />
          </button>
        </div>

        <PlaylistDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} onSignOut={handleSignOut} />
      </aside>
    );
  }

  return (
    <aside className="liquid-glass hidden w-60 shrink-0 flex-col border-r border-white/[0.06] lg:flex">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo to="/home" />
        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
          onClick={toggleCollapsed}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <ArrowRightToLine className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3">
        {[
          { to: "/home", label: "Home", icon: House },
          { to: "/search", label: "Search", icon: Search },
          { to: "/social", label: "Listening Rooms", icon: Radio },
        ].map(({ to, label, icon: Icon }) => (
          <NavLink key={to + label} to={to} className={linkCls}>
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
        {user?.role === "admin" && (
          <NavLink to="/admin" className={linkCls}>
            <ShieldCheck className="size-[18px] text-[rgb(var(--tint))]" />
            Admin
          </NavLink>
        )}
      </nav>

      {/* Spotify-style Library card */}
      <div className="glass-card mx-3 mt-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => navigate("/playlists")}
            className="flex items-center gap-2 text-sm font-semibold text-foreground transition-colors hover:text-[rgb(var(--tint))]"
          >
            <Library className="size-[18px]" />
            Your Library
          </button>
          <button
            type="button"
            aria-label="New playlist"
            title="Create playlist"
            onClick={() => setDialogOpen(true)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <Plus className="size-4" />
          </button>
        </div>

        {/* filter chips */}
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2">
          {(
            [
              { id: "playlists", label: "Playlists" },
              { id: "liked", label: "Liked" },
              { id: "recent", label: "Recent" },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => {
                setFilter(filter === chip.id ? "all" : chip.id);
                if (chip.id === "liked") navigate("/liked");
                if (chip.id === "recent") navigate("/recent");
                if (chip.id === "playlists") navigate("/playlists");
              }}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                filter === chip.id
                  ? "bg-foreground text-background"
                  : "bg-white/[0.06] text-muted-foreground hover:bg-white/[0.1]",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <NavLink
            to="/liked"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )
            }
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-300">
              <Heart className="size-4 fill-current text-white" />
            </span>
            <span className="min-w-0">
              <span className="block truncate">Liked Songs</span>
              <span className="block text-xs text-muted-foreground">Playlist</span>
            </span>
          </NavLink>

          <NavLink
            to="/recent"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-white/[0.07] text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
              )
            }
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-emerald-600 to-teal-300">
              <History className="size-4 text-white" />
            </span>
            <span className="min-w-0">
              <span className="block truncate">Recently Played</span>
              <span className="block text-xs text-muted-foreground">History</span>
            </span>
          </NavLink>

          {playlists === undefined && (
            <div className="space-y-2 px-2 py-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-2">
                  <div className="size-10 animate-pulse rounded-md bg-white/[0.06]" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 animate-pulse rounded bg-white/[0.06]" />
                    <div className="h-2.5 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {visiblePlaylists?.map((p) => (
            <NavLink
              key={p._id}
              to={`/playlist/${p._id}`}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-white/[0.07] font-medium text-foreground"
                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )
              }
            >
              <span className="size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10">
              <span
                className="size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10"
                style={{ background: "linear-gradient(135deg, rgb(var(--tint) / 0.35), rgb(var(--tint) / 0.1))" }}
              >
                <span className="flex size-full items-center justify-center">
                  <ListMusic className="size-4 text-[rgb(var(--tint))]" />
                </span>
              </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground group-hover:text-foreground">{p.name}</span>
                <span className="block text-xs text-muted-foreground">Playlist</span>
              </span>
            </NavLink>
          ))}

          {playlists !== undefined && playlists.length === 0 && (
            <p className="px-2 py-3 text-xs leading-5 text-muted-foreground/70">
              Playlists you create appear here.
            </p>
          )}
        </div>
      </div>

      <p className="px-5 pb-2 text-[10px] tracking-wide text-muted-foreground/50">
        Currently in beta
      </p>

      <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[rgb(var(--tint))] text-sm font-bold text-black ring-2 ring-white/10">
          {user?.image ? <img src={user.image} alt="" className="size-full object-cover" /> : initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {user?.name ?? (user?.isAnonymous ? "Guest" : "Listener")}
          </p>
          {hideEmail ? null : (
            <p className="truncate text-xs text-muted-foreground">
              {user?.email ?? "Anonymous session"}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <Settings className="size-4" />
        </button>
        <NavLink
          to="/profile"
          aria-label="Profile"
          title="Profile"
          className={({ isActive }) =>
            cn(
              "rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground",
              isActive && "text-[rgb(var(--tint))]",
            )
          }
        >
          <UserRound className="size-4" />
        </NavLink>
        <NavLink
          to="/stats"
          aria-label="Your stats"
          title="Your stats"
          className={({ isActive }) =>
            cn(
              "rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground",
              isActive && "text-[rgb(var(--tint))]",
            )
          }
        >
          <BarChart3 className="size-4" />
        </NavLink>
      </div>

      <PlaylistDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSignOut={handleSignOut}
      />
    </aside>
  );
}
