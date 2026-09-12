import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AlbumCard } from "@/components/tracks/AlbumCard";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { TrackRow } from "@/components/tracks/TrackRow";
import { api } from "@/convex/_generated/api";
import {
  ALBUMS,
  ARTISTS,
  artistTracks,
  searchCatalog,
} from "@/lib/catalog";
import { coverArt } from "@/lib/covers";
import { toPlayableYoutube } from "@/lib/playable";
import { type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { useAction } from "convex/react";
import {
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  SearchX,
  Youtube,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const MOOD_CHIPS = [
  "night",
  "chill",
  "dance",
  "synth",
  "ambient",
  "lo-fi",
  "dream",
  "golden",
  "indie",
];

export default function Search() {
  const [query, setQuery] = useState("");
  const [ytResults, setYtResults] = useState<YtItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const navigate = useNavigate();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const searchYt = useAction(api.youtube.searchYoutube);

  const debouncedQuery = useDebounced(query, 450);

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
              "YouTube is unreachable right now. Try searching on YouTube directly, or browse the catalog below.",
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
      // Playback goes through the hidden YouTube IFrame player, so no stream
      // resolution is needed — the video id is all the engine requires.
      const alternatives = ytResults?.filter((r) => r.id !== item.id) ?? [];
      playTrack(toPlayableYoutube(item, item.id, alternatives));
      toast.success("Now playing");
    },
    [playTrack, ytResults],
  );

  const results = useMemo(() => searchCatalog(query), [query]);
  const hasQuery = query.trim().length > 0;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find any song — search YouTube and stream it instantly, or browse the
          SoundCore catalog.
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
        <BrowseView onPick={setQuery} onAlbum={(id) => navigate(`/album/${id}`)} />
      ) : (
        <div className="flex flex-col gap-10">
          {/* YouTube results */}
          <section>
            <div className="mb-2 flex items-center gap-2">
              <Youtube className="size-4 text-[rgb(var(--tint))]" />
              <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Results from YouTube
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
                <a
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium transition-colors hover:bg-white/[0.08]"
                >
                  <ExternalLink className="size-3.5" />
                  Open on YouTube
                </a>
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
                No YouTube results for "{query}". Try a different spelling or
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

          {/* catalog matches */}
          {(results.tracks.length > 0 ||
            results.albums.length > 0 ||
            results.artists.length > 0) && (
            <section>
              <h2 className="mb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                From the SoundCore catalog
              </h2>
              {results.tracks.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  {results.tracks.slice(0, 6).map((track, i) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      list={results.tracks}
                      index={i + 1}
                    />
                  ))}
                </div>
              )}
              {results.albums.length > 0 && (
                <div className="hide-scrollbar -mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2">
                  {results.albums.map((album) => (
                    <AlbumCard key={album.id} album={album} />
                  ))}
                </div>
              )}
              {results.artists.length > 0 && (
                <div className="hide-scrollbar -mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2">
                  {results.artists.map((artist) => {
                    const album = ALBUMS.find(
                      (a) => a.artistId === artist.id,
                    );
                    return (
                      <button
                        key={artist.id}
                        type="button"
                        onClick={() => album && navigate(`/album/${album.id}`)}
                        className="group w-32 shrink-0 text-center"
                      >
                        <div className="mx-auto size-28 overflow-hidden rounded-full ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105">
                          {album && (
                            <img
                              src={coverArt(album)}
                              alt=""
                              className="size-full object-cover"
                            />
                          )}
                        </div>
                        <p className="mt-2 truncate text-sm font-semibold">
                          {artist.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          Artist
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
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
  onAlbum,
}: {
  onPick: (q: string) => void;
  onAlbum: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          Browse by mood
        </h2>
        <div className="flex flex-wrap gap-2">
          {MOOD_CHIPS.map((mood) => (
            <button
              key={mood}
              type="button"
              onClick={() => onPick(mood)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-sm font-medium text-foreground/90 transition-all hover:border-[rgb(var(--tint)_/_0.5)] hover:bg-[rgb(var(--tint)_/_0.1)]"
            >
              {mood}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          All albums
        </h2>
        <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
          {ALBUMS.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          All artists
        </h2>
        <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
          {ARTISTS.map((artist) => {
            const album = ALBUMS.find((a) => a.artistId === artist.id);
            const tracks = artistTracks(artist.id);
            return (
              <button
                key={artist.id}
                type="button"
                onClick={() => album && onAlbum(album.id)}
                className="group w-32 shrink-0 text-center"
              >
                <div className="mx-auto size-28 overflow-hidden rounded-full ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105">
                  {album && (
                    <img
                      src={coverArt(album)}
                      alt=""
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <p className="mt-2 truncate text-sm font-semibold">
                  {artist.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {tracks.length} songs
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
