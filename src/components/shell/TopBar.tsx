import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { PanelRight, Search, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShellStore, type SearchSource } from "@/lib/shell";

/**
 * The reference layout's global search row: one search input plus the
 * music-source selector, spanning the top of the three-column workspace.
 *
 * The sources are REAL, not decorative: "YouTube Music" navigates to SYNQ's
 * music-only search (the InnerTube-backed pipeline the app has always used),
 * and "SoundCloud" flips the search page onto SYNQ's SoundCloud index. The
 * active source lives in the shell store (persisted), so the selector, the
 * search page and the results all agree without prop-drilling.
 *
 * There is deliberately no third "YouTube" pill: SYNQ's search is music-only
 * by design (video and creator results never enter discovery), so a second
 * button returning identical results would be decoration pretending to be a
 * feature. The desktop window keeps its NATIVE title bar — the Electron main
 * process documents that choice ("the window keeps the native frame and
 * system controls … instead of being re-implemented badly") — so this row is
 * the in-app equivalent of the reference's compact top area: search + source,
 * nothing else.
 */
const SOURCES: Array<{ id: SearchSource; label: string }> = [
  { id: "youtube", label: "YouTube Music" },
  { id: "soundcloud", label: "SoundCloud" },
];

export function TopBar() {
  const navigate = useNavigate();
  const searchSource = useShellStore((s) => s.searchSource);
  const setSearchSource = useShellStore((s) => s.setSearchSource);
  const rightPanelOpen = useShellStore((s) => s.rightPanelOpen);
  const setRightPanelOpen = useShellStore((s) => s.setRightPanelOpen);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useShellStore((s) => s.setSidebarCollapsed);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input in sync when the Search page pushes ?q= deep links.
  useEffect(() => {
    const sync = () => {
      const q = new URLSearchParams(window.location.search).get("q");
      if (q !== null) setQuery(q);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const submit = () => {
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  };

  return (
    /*
      A THREE-COLUMN GRID, not `justify-between`.

      With a flex row the search only LOOKED centred when the two side groups
      happened to be the same width — they are not: the left group is one 32px
      button and the right holds that plus two source pills. So the input sat
      left of centre and drifted further as the source labels grew. Equal
      `1fr` outer columns pin the middle column at the row's true centre no
      matter what either side contains.
    */
    <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,36rem)_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 sm:px-6">
      {/* Sidebar collapse/expand toggle — only on desktop where sidebar exists */}
      <button
        type="button"
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        className="hidden size-8 shrink-0 items-center justify-center justify-self-start rounded-lg border border-white/[0.08] text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground lg:flex"
      >
        {sidebarCollapsed ? (
          <ChevronRight className="size-4" />
        ) : (
          <ChevronLeft className="size-4" />
        )}
      </button>

      {/* Centered search form — takes available space between sidebar toggle and right controls */}
      <form
        className="relative w-full"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tracks, artists, or albums"
          aria-label="Search tracks, artists, or albums"
          className="h-9 w-full rounded-full border border-white/[0.08] bg-[var(--surface-container)] pr-9 pl-9 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-[rgb(var(--tint)_/_0.5)]"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      {/* Right controls group: lyrics panel toggle + source selector */}
      <div className="flex shrink-0 items-center justify-self-end gap-2">
        {/* Lyrics panel toggle — on the RIGHT side, near the right panel it controls */}
        <button
          type="button"
          aria-label={rightPanelOpen ? "Hide lyrics panel" : "Show lyrics panel"}
          title={rightPanelOpen ? "Hide lyrics panel" : "Show lyrics panel"}
          onClick={() => setRightPanelOpen(!rightPanelOpen)}
          className="shrink-0 flex size-8 items-center justify-center rounded-lg border border-white/[0.08] text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
        >
          {rightPanelOpen ? (
            <X className="size-4" />
          ) : (
            <PanelRight className="size-4" />
          )}
        </button>

        {/* Source selector — the active pill writes the shell store; the search
            page reads the same value, so this is the one source of truth. */}
        <div
          className="flex shrink-0 items-center gap-1"
          role="group"
          aria-label="Music source"
        >
          {SOURCES.map((source) => {
            const active = searchSource === source.id;
            return (
              <button
                key={source.id}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSearchSource(source.id);
                  // Switching sources jumps to the results for the current
                  // query (or the search page) so the change is never silent.
                  const q = query.trim();
                  navigate(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  active
                    ? "bg-white text-black"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {source.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

