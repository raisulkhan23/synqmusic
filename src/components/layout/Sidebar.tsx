import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import {
  BarChart3,
  Disc3,
  Heart,
  History,
  House,
  Library,
  ListVideo,
  Plus,
  Radio,
  Settings,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  FolderClosed,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Logo } from "@/components/brand/Logo";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { CommandPaletteHint } from "@/components/core/CommandPalette";
import { PlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { usePlayerStore } from "@/store/player";
import { useAuth } from "@/hooks/use-auth";
import { nativeDownloadsSupported } from "@/lib/nativeDownloads";
import { useShellStore } from "@/lib/shell";

/**
 * The reference layout's labelled navigation sidebar: text items with icons,
 * a left active-indicator, section separators, and Settings anchored at the
 * bottom. Can be collapsed to an icon-only rail.
 *
 * The nav list maps onto SYNQ's real routes — the brief's sections first,
 * then a quiet secondary group so no existing page loses its only entry
 * point. "Queue" opens the queue sheet rather than a page: the sheet owns
 * reordering, Play Next and remove, and a second queue surface would just
 * drift out of sync with it.
 */

const PRIMARY_NAV = [
  { to: "/home", label: "Home", icon: House },
  { to: "/liked", label: "Favorites", icon: Heart },
  { to: "/albums", label: "Albums", icon: Disc3 },
  ...(nativeDownloadsSupported()
    ? [{ to: "/downloads", label: "My files", icon: FolderClosed }]
    : []),
  { to: "/recent", label: "History", icon: History },
] as const;

const SECONDARY_NAV = [
  { to: "/discover", label: "Discover", icon: Sparkles },
  { to: "/social", label: "Listening rooms", icon: Radio },
  { to: "/stats", label: "Stats", icon: BarChart3 },
] as const;

const itemCls = (active: boolean) =>
  cn(
    "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
    active
      ? "bg-white/[0.07] text-foreground"
      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
  );

function Indicator({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[rgb(var(--tint))] transition-opacity",
        active ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

function NavItem({
  to,
  label,
  icon: Icon,
  isActive,
  collapsed,
}: {
  to: string;
  label: string;
  icon: typeof House;
  isActive: boolean;
  collapsed: boolean;
}) {
  return (
    <NavLink key={to + label} to={to} className={({ isActive }) => itemCls(isActive)}>
      <Indicator active={isActive} />
      <Icon className="size-[18px] shrink-0" />
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
}

export function Sidebar() {
  const location = useLocation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { user } = useAuth();
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);

  return (
    <aside
      aria-label="Primary navigation"
      className={cn(
        "hidden shrink-0 flex-col gap-0.5 border-r border-white/[0.06] bg-[var(--surface-low)] py-4 transition-all duration-200 lg:flex",
        sidebarCollapsed ? "w-[56px] px-1" : "w-[200px] px-3",
      )}
    >
      <div className={cn("px-2 pb-4", "transition-opacity duration-200")}>
        <Logo to="/home" />
      </div>

      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {PRIMARY_NAV.map(({ to, label, icon: Icon }) => (
          <NavItem
            key={to + label}
            to={to}
            label={label}
            icon={Icon}
            isActive={location.pathname === to}
            collapsed={sidebarCollapsed}
          />
        ))}

        {/* Queue opens the sheet: one queue surface, always in sync. */}
        <button
          type="button"
          onClick={() => setQueueOpen(!queueOpen)}
          className={cn(itemCls(queueOpen), "w-full justify-start")}
        >
          <Indicator active={queueOpen} />
          <ListVideo className="size-[18px] shrink-0" />
          {!sidebarCollapsed && <span>Queue</span>}
        </button>
      </nav>

      <div className={cn("my-2 h-px bg-white/[0.06]", "role=\"separator\"")} role="separator" />

      <nav className="flex flex-col gap-0.5" aria-label="Library and sound">
        {/* Audio presets → Settings, where the equalizer and vibe presets
            actually live; Playlists gets an inline create button. */}
        <NavLink to="/settings" className={({ isActive }) => itemCls(isActive)}>
          <Indicator active={location.pathname === "/settings"} />
          <SlidersHorizontal className="size-[18px] shrink-0" />
          {!sidebarCollapsed && <span>Audio presets</span>}
        </NavLink>
        <div className="relative">
          <NavLink to="/playlists" className={({ isActive }) => itemCls(isActive)}>
            <Indicator active={location.pathname === "/playlists"} />
            <Library className="size-[18px] shrink-0" />
            {!sidebarCollapsed && <span>Playlists</span>}
          </NavLink>
          {!sidebarCollapsed && (
            <button
              type="button"
              aria-label="New playlist"
              title="New playlist"
              onClick={() => setDialogOpen(true)}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <Plus className="size-4" />
            </button>
          )}
        </div>
      </nav>

      <div className={cn("my-2 h-px bg-white/[0.06]", "role=\"separator\"")} role="separator" />

      {/* Secondary group: everything else SYNQ ships, quiet by design. */}
      <nav className="flex flex-col gap-0.5" aria-label="More">
        {SECONDARY_NAV.map(({ to, label, icon: Icon }) => (
          <NavItem
            key={to + label}
            to={to}
            label={label}
            icon={Icon}
            isActive={location.pathname === to}
            collapsed={sidebarCollapsed}
          />
        ))}
        {user?.role === "admin" && (
          <NavLink to="/admin" className={({ isActive }) => itemCls(isActive)}>
            <Indicator active={location.pathname === "/admin"} />
            <ShieldCheck className="size-[18px] shrink-0 text-[rgb(var(--tint))]" />
            {!sidebarCollapsed && <span>Admin</span>}
          </NavLink>
        )}
        <NavItem
          to="/profile"
          label="Profile"
          icon={UserRound}
          isActive={location.pathname === "/profile"}
          collapsed={sidebarCollapsed}
        />
      </nav>

      <div className={cn("my-2 h-px bg-white/[0.06]", "role=\"separator\"")} role="separator" />

      <div className="mt-auto flex flex-col gap-0.5">
        {/* The full pill fits the 200px labelled sidebar, and the palette is
            the fastest path to anything in the app — keep it discoverable. */}
        <div className={cn("px-2 pb-2", sidebarCollapsed && "px-0")}>
          <CommandPaletteHint />
        </div>
        <NavLink to="/settings" className={({ isActive }) => itemCls(isActive)}>
          <Indicator active={location.pathname === "/settings"} />
          <Settings className="size-[18px] shrink-0" />
          {!sidebarCollapsed && <span>Settings</span>}
        </NavLink>
        <div className={cn("mt-2 border-t border-white/[0.06] pt-3", sidebarCollapsed && "hidden")}>
          <AccountMenu variant="expanded" className="min-w-0" />
        </div>
      </div>

      <PlaylistDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}