import { create } from "zustand";

/**
 * The desktop shell's layout state — the pieces the three-column workspace
 * needs that are NOT playback state:
 *
 *  - `searchSource` — which provider the global search bar queries. Persisted
 *    (`ss.searchSource`) so the selector survives reloads. "youtube" is
 *    SYNQ's music-only YouTube search; "soundcloud" queries SYNQ's own
 *    SoundCloud index. There is deliberately no separate "YouTube" vs
 *    "YouTube Music" pair: SYNQ's search is music-only by design, so a
 *    second button returning the same results would be a lie.
 *  - `rightPanelOpen` — the lyrics / now-playing column (desktop). Persisted.
 *  - `queueOpen` — the queue sheet.
 *  - `sidebarCollapsed` — whether the left sidebar is in collapsed (icon-only)
 *    or expanded (labeled) mode. Persisted (`ss.sidebarCollapsed`).
 *
 * A tiny dedicated store rather than player-store fields: the shell layout
 * is presentation state, not playback state, and mixing them would make the
 * player's persisted queue logic care about UI toggles.
 */

export type SearchSource = "youtube" | "soundcloud";

const SEARCH_SOURCE_KEY = "ss.searchSource";
const RIGHT_PANEL_KEY = "ss.rightPanel";
const SIDEBAR_COLLAPSED_KEY = "ss.sidebarCollapsed";

function readSearchSource(): SearchSource {
  try {
    return localStorage.getItem(SEARCH_SOURCE_KEY) === "soundcloud"
      ? "soundcloud"
      : "youtube";
  } catch {
    return "youtube";
  }
}

function readRightPanel(): boolean {
  try {
    // Default OPEN: the reference layout always shows the panel.
    return localStorage.getItem(RIGHT_PANEL_KEY) !== "0";
  } catch {
    return true;
  }
}

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface ShellState {
  searchSource: SearchSource;
  setSearchSource: (source: SearchSource) => void;
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useShellStore = create<ShellState>()((set) => ({
  searchSource: readSearchSource(),
  setSearchSource: (source) => {
    set({ searchSource: source });
    try {
      localStorage.setItem(SEARCH_SOURCE_KEY, source);
    } catch {
      /* storage unavailable */
    }
  },
  rightPanelOpen: readRightPanel(),
  setRightPanelOpen: (open) => {
    set({ rightPanelOpen: open });
    try {
      localStorage.setItem(RIGHT_PANEL_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  },
  sidebarCollapsed: readSidebarCollapsed(),
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  },
}));
