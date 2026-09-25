import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { toPlayableYoutube } from "@/lib/playable";
import { type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { track as trackEvent } from "@/lib/analytics";
import { GravitySponsor } from "@/components/ads/GravitySponsor";
import { useAction } from "convex/react";
import {
  Dices,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  SearchX,
  Globe,
  Music2,
  Play,
  X,
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
  { id: "daily-discovery", title: "Daily Discovery", desc: "A fresh batch of songs worth hearing today.", query: "new music discoveries today", gradient: "from-cyan-500/30 via-sky-500/15 to-transparent" },
  { id: "global-vibes", title: "Global Sounds", desc: "Latin, African, Asian and worldwide favorites.", query: "worldwide music hits", gradient: "from-orange-500/30 via-rose-500/15 to-transparent" },
  { id: "deep-focus", title: "Deep Focus", desc: "Instrumental textures for concentration and flow.", query: "instrumental focus music", gradient: "from-blue-500/30 via-indigo-500/15 to-transparent" },
  { id: "after-hours", title: "After Hours", desc: "Smooth R&B and soul for the quiet hours.", query: "r&b soul after hours", gradient: "from-violet-500/30 via-purple-500/15 to-transparent" },
  { id: "acoustic-sunrise", title: "Acoustic Sunrise", desc: "Easy acoustic songs for starting the day.", query: "acoustic morning songs", gradient: "from-yellow-500/30 via-orange-500/15 to-transparent" },
  { id: "electronic-energy", title: "Electronic Energy", desc: "Fresh electronic sounds to move to right now.", query: "electronic dance music hits", gradient: "from-emerald-500/30 via-cyan-500/15 to-transparent" },
  { id: "retro-arcade", title: "Retro Arcade", desc: "Bright synths and nostalgic hooks on repeat.", query: "retro synth pop hits", gradient: "from-pink-500/30 via-fuchsia-500/15 to-transparent" },
  { id: "global-peace", title: "Peaceful World", desc: "Calm, expansive sounds for reset and reflection.", query: "calm ambient world music", gradient: "from-teal-500/30 via-blue-500/15 to-transparent" },
  { id: "viral", title: "Viral Right Now", desc: "The songs taking over every feed today.", query: "viral songs this week", gradient: "from-pink-500/30 via-rose-500/15 to-transparent" },
  { id: "rnb-vibes", title: "R&B After Dark", desc: "Smooth late-night R&B with a little bounce.", query: "r&b vibes after dark", gradient: "from-fuchsia-500/30 via-purple-500/15 to-transparent" },
  { id: "indie-discovery", title: "Indie Discovery", desc: "The next favorite artist is already here.", query: "new indie artists discovery", gradient: "from-lime-500/30 via-emerald-500/15 to-transparent" },
  { id: "dance-floor", title: "Dance Floor", desc: "Big hooks, bright lights, no warm-up needed.", query: "dance pop party hits", gradient: "from-cyan-500/30 via-blue-500/15 to-transparent" },
  { id: "acoustic-slow", title: "Acoustic Slowdown", desc: "Stripped-back songs for a softer pace.", query: "acoustic chill songs", gradient: "from-orange-500/30 via-amber-500/15 to-transparent" },
  { id: "90s", title: "90s Forever", desc: "The songs that still own the aux.", query: "90s hits classics", gradient: "from-purple-500/30 via-indigo-500/15 to-transparent" },
  { id: "00s", title: "00s Rewind", desc: "Early pop, R&B, and hip-hop essentials.", query: "2000s music hits", gradient: "from-blue-500/30 via-sky-500/15 to-transparent" },
  { id: "feel-good", title: "Feel Good Frequency", desc: "Instant mood-lifting songs, no skips.", query: "feel good upbeat songs", gradient: "from-yellow-500/30 via-orange-500/15 to-transparent" },
  { id: "global-pop", title: "Global Pop", desc: "Bright pop favorites from around the world.", query: "international pop hits", gradient: "from-cyan-500/30 via-teal-500/15 to-transparent" },
  { id: "soft-edges", title: "Soft Edges", desc: "Warm, hazy songs for the in-between moments.", query: "dreamy chill music", gradient: "from-violet-500/30 via-indigo-500/15 to-transparent" },
  { id: "new-music", title: "New Music Radar", desc: "Fresh tracks from the artists on the rise.", query: "best new music this week", gradient: "from-rose-500/30 via-pink-500/15 to-transparent" },
] as const;

const POPULAR_MIX_REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
const POPULAR_MIX_REFRESH_KEY = "synq:popular-mixes-refreshed-at";
const POPULAR_MIX_COUNT = 10;

function popularMixCycle() {
  const now = Date.now();
  if (typeof window === "undefined") return Math.floor(now / POPULAR_MIX_REFRESH_INTERVAL);

  try {
    const stored = Number(window.localStorage.getItem(POPULAR_MIX_REFRESH_KEY));
    if (!stored || now - stored >= POPULAR_MIX_REFRESH_INTERVAL) {
      window.localStorage.setItem(POPULAR_MIX_REFRESH_KEY, String(now));
      return Math.floor(now / POPULAR_MIX_REFRESH_INTERVAL);
    }
    return Math.floor(stored / POPULAR_MIX_REFRESH_INTERVAL);
  } catch {
    return Math.floor(now / POPULAR_MIX_REFRESH_INTERVAL);
  }
}

function usePopularMixCycle() {
  const [cycle, setCycle] = useState(popularMixCycle);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCycle(popularMixCycle());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return cycle;
}

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
        "group relative flex h-36 w-36 shrink-0 flex-col justify-end overflow-hidden rounded-2xl border border-white/20 bg-gradient-to-br p-3.5 text-left outline outline-1 outline-white/10 ring-1 ring-white/10 transition-[transform,border-color,outline-color,box-shadow] hover:scale-[1.03] hover:border-white/40 hover:outline-white/20 hover:ring-white/25 sm:w-44",
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
  // Shared links open with ?q=… pre-filled — share → open → play.
  // Seeded during the initial render (not in an effect) so the shared query
  // is available on the very first search without a cascading render.
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedQuery = searchParams.get("q");
  const [query, setQuery] = useState(() => sharedQuery ?? "");
  const [ytResults, setYtResults] = useState<YtItem[] | null>(null);
  // Kept separate from the primary Songs results by design. These uploads
  // must never be merged into the first result list or its radio queue.
  const [lyricResults, setLyricResults] = useState<YtItem[] | null>(null);
  const [lyricSearching, setLyricSearching] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Drop ?q= from the URL after it has been consumed (no setState in effect).
  useEffect(() => {
    if (sharedQuery) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedQuery]);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const searchYt = useAction(api.youtube.searchYoutube);
  const searchLyricVideos = useAction(api.youtube.searchLyricVideos);

  const debouncedQuery = useDebounced(query, 450);

  // Search history — persisted locally, capped at 8 entries.
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ss.searchHistory") ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  /** Record a query in the local search history (called when a search runs). */
  const rememberQuery = useCallback((raw: string) => {
    const q = raw.trim();
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
  }, []);
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
        setLyricResults(null);
        setSearchError(null);
        setSearching(false);
        setLyricSearching(false);
        return;
      }
      let cancelled = false;
      let retryTimer: number | undefined;
      setSearching(true);
      setLyricSearching(true);
      setSearchError(null);
      rememberQuery(q);
      trackEvent("search_performed", { query: q.slice(0, 120) });
      const requestPrimary = (attempt: number) => {
        searchYt({ query: q })
          .then(({ items }) => {
            if (cancelled) return;
            if (items.length === 0 && attempt === 0) {
              retryTimer = window.setTimeout(() => requestPrimary(1), 300);
              return;
            }
            setYtResults(items);
            setSearching(false);
            trackEvent("search_results", {
              query: q.slice(0, 120),
              result_count: items.length,
            });
          })
          .catch(() => {
            if (cancelled) return;
            if (attempt === 0) {
              retryTimer = window.setTimeout(() => requestPrimary(1), 300);
              return;
            }
            setYtResults([]);
            setSearching(false);
            setSearchError(
              "Couldn't reach our music sources right now. Try again in a moment.",
            );
          });
      };
      requestPrimary(0);
      // The original query is sent unchanged. The backend derives its own
      // narrowly scoped lyric-video query and keeps these results separate.
      searchLyricVideos({ query: q })
        .then(({ items }) => {
          if (!cancelled) setLyricResults(items);
        })
        .catch(() => {
          if (!cancelled) setLyricResults([]);
        })
        .finally(() => {
          if (!cancelled) setLyricSearching(false);
        });
      return () => {
        cancelled = true;
        if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      };
    };
    run();
  }, [debouncedQuery, searchYt, searchLyricVideos, retryKey, rememberQuery]);

  const playRemote = useCallback(
    (item: YtItem) => {
      // Start the clicked song, then fill the queue with songs from the SAME
      // search (same genre/vibe) — never the raw result list, which is full
      // of duplicate uploads, and never generic "similar artist" filler.
      trackEvent("search_result_played", {
        query: (debouncedQuery || query).slice(0, 120),
        track_id: item.id,
        title: item.title.slice(0, 120),
        artist: item.artist.slice(0, 120),
      });
      void startRadio(toPlayableYoutube(item, item.id), debouncedQuery || query);
    },
    [startRadio, debouncedQuery, query],
  );

  const hasQuery = query.trim().length > 0;
  const surpriseMe = () => {
    const pick = MOOD_CHIPS[Math.floor(Math.random() * MOOD_CHIPS.length)];
    setQuery(pick);
    toast.success(`Surprise mix: ${pick}`);
  };
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
            Search
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Find any song — search across all our music sources and stream it instantly.
          </p>
        </div>
        <button
          type="button"
          onClick={surpriseMe}
          className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:bg-[rgb(var(--tint)_/_0.1)] hover:text-foreground"
        >
          <Dices className="h-3.5 w-3.5 text-[rgb(var(--tint))]" />
          Surprise me
        </button>
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
        {!searching && hasQuery && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery("")}
            className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
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
                {/* Contextual sponsor slot: one clearly-labelled card, after
                    the third result, so it never crowds the first songs a
                    user is actually looking for. Renders nothing when unset. */}
                {ytResults?.map((item, i) => (
                  <div key={item.id}>
                    {i === 2 && hasQuery ? (
                      <GravitySponsor
                        context={query.trim()}
                        placement="search_results"
                        className="my-3"
                      />
                    ) : null}
                    <RemoteTrackRow
                      item={item}
                      index={i + 1}
                      onPlay={playRemote}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {!lyricSearching && lyricResults !== null && lyricResults.length > 0 && (
            <section aria-labelledby="lyric-video-results-heading">
              <div className="mb-2 flex items-center gap-2">
                <Music2 className="size-4 text-[rgb(var(--tint))]" />
                <h2
                  id="lyric-video-results-heading"
                  className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase"
                >
                  Lyric & lo-fi videos
                </h2>
                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
                  Separate uploads
                </span>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">
                Carefully filtered music and lyric uploads. These are not mixed into the Songs results above.
              </p>
              <div className="flex flex-col gap-0.5">
                {lyricResults.map((item, i) => (
                  <RemoteTrackRow
                    key={`lyric-${item.id}`}
                    item={item}
                    index={i + 1}
                    onPlay={playRemote}
                  />
                ))}
              </div>
            </section>
          )}

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
  const mixCycle = usePopularMixCycle();
  const popularMixes = useMemo(() => {
    const start = (mixCycle * 3) % POPULAR_MIXES.length;
    return [
      ...POPULAR_MIXES.slice(start, start + POPULAR_MIX_COUNT),
      ...POPULAR_MIXES.slice(0, Math.max(0, start + POPULAR_MIX_COUNT - POPULAR_MIXES.length)),
    ];
  }, [mixCycle]);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Popular mixes
        </h2>
        <div className="slider-rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {popularMixes.map((mix) => (
            <MixCard key={mix.id} mix={mix} />
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground/70">Live from YouTube Music · picks rotate every 12 hours</p>
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
              className="rounded-full border border-white/20 bg-white/[0.06] px-4 py-1.5 text-sm font-medium text-foreground/90 outline outline-1 outline-white/10 transition-all hover:border-[rgb(var(--tint)_/_0.65)] hover:bg-[rgb(var(--tint)_/_0.12)] hover:outline-[rgb(var(--tint)_/_0.3)]"
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
              className="rounded-full border border-white/20 bg-gradient-to-br from-white/[0.09] to-white/[0.025] px-4 py-1.5 text-sm font-medium text-foreground/90 outline outline-1 outline-white/10 transition-all hover:border-[rgb(var(--tint)_/_0.65)] hover:from-[rgb(var(--tint)_/_0.14)] hover:outline-[rgb(var(--tint)_/_0.3)]"
            >
              {genre}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
