import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { toPlayableYoutube } from "@/lib/playable";
import { type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { useAction } from "convex/react";
import {
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  SearchX,
  Globe,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const MOOD_CHIPS = [
  "Chill",
  "Happy",
  "Sad",
  "Energetic",
  "Focus",
  "Workout",
  "Party",
  "Sleep",
  "Romantic",
  "Nostalgic",
];

const GENRE_CHIPS = [
  "Pop",
  "Hip-hop",
  "Rock",
  "R&B",
  "Electronic",
  "Indie",
  "Jazz",
  "Classical",
  "Lo-fi",
  "Metal",
  "Country",
  "Reggaeton",
  "Afrobeats",
  "K-pop",
  "Ambient",
  "Funk",
];

/** Map a mood chip to a search query that surfaces matching music. */
const MOOD_QUERIES: Record<string, string> = {
  Chill: "chill relaxing songs",
  Happy: "happy upbeat feel-good songs",
  Sad: "sad emotional songs",
  Energetic: "high energy songs",
  Focus: "focus concentration music",
  Workout: "workout gym motivation songs",
  Party: "party dance hits",
  Sleep: "sleep calm ambient music",
  Romantic: "romantic love songs",
  Nostalgic: "nostalgic throwback hits",
};
/**
 * Curated mixes shown on the empty-search browse view. Each plays a live
 * queue built from a search across our music sources — one tap, no setup.
 */
const POPULAR_MIXES = [
  { id: "top-hits", title: "Today's Top Hits", desc: "The biggest songs on the planet right now.", query: "top hits today", gradient: "from-sky-500/30 via-blue-500/15 to-transparent" },
  { id: "rap-caviar", title: "RapCaviar", desc: "The hottest hip-hop and rap, updated constantly.", query: "hip hop rap hits", gradient: "from-red-500/30 via-orange-500/15 to-transparent" },
  { id: "chill", title: "Chill Vibes", desc: "Relaxed tracks to unwind, study, and drift to.", query: "chill relaxing songs", gradient: "from-teal-500/30 via-emerald-500/15 to-transparent" },
  { id: "party", title: "Party Starters", desc: "Certified bangers to get the room moving.", query: "party dance hits", gradient: "from-fuchsia-500/30 via-purple-500/15 to-transparent" },
  { id: "throwback", title: "All Out Throwbacks", desc: "Greatest hits of the 2000s and 2010s.", query: "2000s 2010s greatest hits", gradient: "from-amber-500/30 via-yellow-500/15 to-transparent" },
  { id: "indie", title: "Indie Pulse", desc: "Fresh indie sounds from rising voices.", query: "indie hits", gradient: "from-rose-500/30 via-pink-500/15 to-transparent" },
  { id: "lofi", title: "Late Night Lo-fi", desc: "Mellow beats for late nights and deep focus.", query: "lo-fi beats late night", gradient: "from-indigo-500/30 via-slate-500/15 to-transparent" },
  { id: "workout", title: "Beast Mode", desc: "High-energy tracks built for the gym.", query: "workout energy hits", gradient: "from-lime-500/30 via-green-500/15 to-transparent" },
] as const;

function MixCard({ mix }: { mix: (typeof POPULAR_MIXES)[number] }) {
  const searchYt = useAction(api.youtube.searchYoutube);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [loading, setLoading] = useState(false);

  const play = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const { items } = await searchYt({ query: mix.query });
      if (items.length === 0) {
        toast.error("Couldn't load this mix — try again");
        return;
      }
      const queue = items.slice(0, 15).map((it, i) =>
        toPlayableYoutube(it, it.id, items.slice(i + 1)),
      );
      playTrack(queue[0], queue);
      toast.success(`Playing ${mix.title}`);
    } catch {
      toast.error("Couldn't load this mix — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void play()}
      className={cn(
        "group relative flex h-36 w-36 shrink-0 flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-3.5 text-left ring-1 ring-white/10 transition-transform hover:scale-[1.03] sm:w-44",
        mix.gradient,
      )}
    >
      <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/50 text-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
      </span>
      <span className="font-display text-sm font-bold tracking-tight sm:text-base">{mix.title}</span>
      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{mix.desc}</span>
    </button>
  );
}

export default function Search() {
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState<YtItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Shared links open with ?q=… pre-filled — share → open → play.
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedQuery = searchParams.get("q");
  useEffect(() => {
    if (sharedQuery && !query) {
      setQuery(sharedQuery);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedQuery]);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const searchYt = useAction(api.youtube.searchYoutube);

  const debouncedQuery = useDebounced(query, 450);

  // Search history — persisted locally, capped at 8 entries.
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ss.searchHistory") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (q.length < 2) return;
    setSearchHistory((prev) => {
      const next = [q, ...prev.filter((h) => h !== q)].slice(0, 8);
      try {
        localStorage.setItem("ss.searchHistory", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [debouncedQuery]);
  const clearSearchHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem("ss.searchHistory");
  };

  // Live YouTube search, debounced.
  useEffect(() => {
    const q = debouncedQuery.trim();
    const run = () => {
      if (!q) {
        setYtResults(null);
        setSearchError(null);
        setSearching(false);
        return;
      }
      let cancelled = false;
      setSearching(true);
      setSearchError(null);
      searchYt({ query: q })
        .then(({ items }) => {
          if (!cancelled) setYtResults(items);
        })
        .catch(() => {
          if (!cancelled) {
            setYtResults([]);
            setSearchError(
              "Couldn't reach our music sources right now. Try again in a moment.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
      return () => {
        cancelled = true;
      };
    };
    run();
  }, [debouncedQuery, searchYt, retryKey]);

  const playRemote = useCallback(
    (item: YtItem) => {
      // Start the clicked song, then fill the queue with RELATED songs from
      // across our sources — never the raw search results (those contain
      // duplicates and near-identical uploads of the same track).
      void startRadio(toPlayableYoutube(item, item.id));
    },
    [startRadio],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find any song — search across all our music sources and stream it
          instantly.
        </p>
      </header>

      {/* search input */}
      <div className="relative max-w-xl">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a song, artist or album…"
          className="h-12 w-full rounded-full border border-white/10 bg-white/[0.05] pr-12 pl-12 text-[15px] text-foreground placeholder:text-muted-foreground/70 focus:border-[rgb(var(--tint)_/_0.6)] focus:ring-2 focus:ring-[rgb(var(--tint)_/_0.25)] focus:outline-none"
        />
        {searching && (
          <Loader2
            className="absolute top-1/2 right-4 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        )}
      </div>

      {!hasQuery ? (
        <>
          {searchHistory.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-sm font-semibold tracking-widest text-muted-foreground uppercase">
                  Recent searches
                </h2>
                <button
                  type="button"
                  onClick={clearSearchHistory}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {searchHistory.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setQuery(h)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:text-foreground"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </section>
          )}
          <BrowseView onPick={setQuery} />
        </>
      ) : (
        <div className="flex flex-col gap-10">
          {/* Related results */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Globe className="size-4 text-[rgb(var(--tint))]" />
              <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Related results
              </h2>
            </div>

            {searching ? (
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl px-3 py-2"
                  >
                    <div className="size-10 animate-pulse rounded-md bg-white/[0.05]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-2/3 animate-pulse rounded bg-white/[0.05]" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-white/[0.05]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : searchError ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 py-12 text-center">
                <SearchX className="size-8 text-muted-foreground/40" />
                <p className="max-w-sm text-sm text-muted-foreground">
                  {searchError}
                </p>
                <button
                  type="button"
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.08]"
                >
                  <RefreshCw className="size-3.5" />
                  Try again
                </button>
              </div>
            ) : ytResults !== null && ytResults.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-muted-foreground">
                No related results for "{query}". Try a different spelling or
                an artist name.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {ytResults?.map((item, i) => (
                  <RemoteTrackRow
                    key={item.id}
                    item={item}
                    index={i + 1}
                    onPlay={playRemote}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}


/** Debounce a value with a trailing delay. */
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function BrowseView({
  onPick,
}: {
  onPick: (q: string) => void;
}) {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Popular mixes
        </h2>
        <div className="slider-rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {POPULAR_MIXES.map((mix) => (
            <MixCard key={mix.id} mix={mix} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Browse by mood
        </h2>
        <div className="flex flex-wrap gap-2">
          {MOOD_CHIPS.map((mood) => (
            <button
              key={mood}
              type="button"
              onClick={() => onPick(MOOD_QUERIES[mood] ?? mood)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm font-medium text-foreground/90 transition-all hover:border-[rgb(var(--tint)_/_0.5)] hover:bg-[rgb(var(--tint)_/_0.1)]"
            >
              {mood}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Explore genres
        </h2>
        <div className="flex flex-wrap gap-2">
          {GENRE_CHIPS.map((genre) => (
            <button
              key={genre}
              type="button"
              onClick={() => onPick(`${genre} music hits`)}
              className="rounded-full border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] px-4 py-1.5 text-sm font-medium text-foreground/90 transition-all hover:border-[rgb(var(--tint)_/_0.5)] hover:from-[rgb(var(--tint)_/_0.12)]"
            >
              {genre}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
