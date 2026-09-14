import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { PlaylistCard } from "@/components/playlists/PlaylistCard";
import { PlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { AlbumCard } from "@/components/tracks/AlbumCard";
import { api } from "@/convex/_generated/api";
import {
  albumById,
  ALBUMS,
  albumsByNewest,
  artistById,
  artistTracks,
  ARTISTS,
  topTracks,
  type Album,
  type Artist,
} from "@/lib/catalog";
import { usePlayerStore } from "@/store/player";
import { coverArt } from "@/lib/covers";
import { useQuery, useAction, useMutation } from "convex/react";
import { Heart, ListMusic, Plus, Play, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { toPlayableYoutube } from "@/lib/playable";
import type { YtItem } from "@/lib/youtube";
import { cn } from "@/lib/utils";

type SortMode = "recent" | "alpha" | "creator";
type FilterMode = "all" | "liked";

/**
 * Curated editorial mixes shown in the Library. Each one is backed by a live
 * search across our music sources when played — the entries themselves are
 * provider-agnostic.
 */
const POPULAR_MIXES = [
  { id: "today-top", title: "Today's Top Hits", desc: "The biggest songs on the planet right now.", query: "top hits today", gradient: "from-sky-500/30 via-blue-500/15 to-transparent" },
  { id: "chill-vibes", title: "Chill Vibes", desc: "Relaxed tracks to unwind, study, and drift to.", query: "chill relaxing songs", gradient: "from-teal-500/30 via-emerald-500/15 to-transparent" },
  { id: "workout", title: "Beast Mode", desc: "High-energy bangers built for the gym.", query: "workout energy hits", gradient: "from-orange-500/30 via-red-500/15 to-transparent" },
  { id: "throwbacks", title: "All Out Throwbacks", desc: "The greatest hits of the 2000s and 2010s.", query: "2000s 2010s greatest hits", gradient: "from-fuchsia-500/30 via-purple-500/15 to-transparent" },
  { id: "indie", title: "Indie Pulse", desc: "Fresh indie sounds from rising voices.", query: "indie hits", gradient: "from-rose-500/30 via-pink-500/15 to-transparent" },
  { id: "lofi", title: "Late Night Lo-fi", desc: "Mellow beats for late nights and deep focus.", query: "lo-fi beats late night", gradient: "from-indigo-500/30 via-slate-500/15 to-transparent" },
] as const;

function PopularMixCard({ mix }: { mix: (typeof POPULAR_MIXES)[number] }) {
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
      const [first, ...rest] = items;
      const playable = items.slice(0, 10).map((it: YtItem, i: number) =>
        toPlayableYoutube(it, it.id, i === 0 ? rest : items.slice(i + 1)),
      );
      playTrack(playable[0], playable);
      toast.success(`Playing ${mix.title}`);
      void first;
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
        "group relative flex h-36 flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-left ring-1 ring-white/10 transition-transform hover:scale-[1.02]",
        mix.gradient,
      )}
    >
      <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/50 text-foreground opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
      </span>
      <span className="font-display text-base font-bold tracking-tight">{mix.title}</span>
      <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{mix.desc}</span>
    </button>
  );
}

export default function Library() {
  const navigate = useNavigate();
  const playlists = useQuery(api.playlists.myPlaylists);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const liked = usePlayerStore((s) => s.liked);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedAlbumIds = usePlayerStore((s) => s.likedAlbums);
  const toggleLikedAlbum = usePlayerStore((s) => s.toggleLikedAlbum);
  const followedArtistIds = usePlayerStore((s) => s.followedArtists);
  const toggleFollowArtist = usePlayerStore((s) => s.toggleFollowArtist);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Sort + filter state for the albums grid.
  const [albumSort, setAlbumSort] = useState<SortMode>("recent");
  const [albumFilter, setAlbumFilter] = useState<FilterMode>("all");

  const albums = useMemo(() => {
    let list: Album[] = [...ALBUMS];
    if (albumFilter === "liked") {
      list = list.filter((a) => likedAlbumIds[a.id]);
    }
    if (albumSort === "recent") return albumsByNewest().filter((a) => list.some((l) => l.id === a.id));
    if (albumSort === "alpha") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return [...list].sort((a, b) =>
      artistById(a.artistId).name.localeCompare(artistById(b.artistId).name),
    );
  }, [albumSort, albumFilter, likedAlbumIds]);

  const likedArtists = useMemo(
    () => ARTISTS.filter((a) => followedArtistIds[a.id]),
    [followedArtistIds],
  );

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Your Library
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything you collect, in one place.
        </p>
      </header>

      {/* quick links */}
      <section className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => navigate("/liked")}
          className="group flex h-28 items-center gap-4 rounded-2xl bg-gradient-to-br from-rose-500/25 via-fuchsia-500/15 to-transparent p-5 text-left ring-1 ring-white/10 transition-transform hover:scale-[1.015]"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-fuchsia-600 text-white shadow-lg">
            <Heart className="size-6 fill-current" />
          </span>
          <span>
            <span className="block font-display text-lg font-bold">Liked Songs</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {likedLoaded ? `${likedCount} ${likedCount === 1 ? "song" : "songs"}` : "Loading…"}
            </span>
          </span>
        </button>

        <button
          type="button"
          onClick={() => navigate("/playlists")}
          className="group flex h-28 items-center gap-4 rounded-2xl bg-gradient-to-br from-emerald-500/25 via-teal-500/15 to-transparent p-5 text-left ring-1 ring-white/10 transition-transform hover:scale-[1.015]"
        >
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg">
            <ListMusic className="size-6" />
          </span>
          <span>
            <span className="block font-display text-lg font-bold">Playlists</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">
              {playlists === undefined
                ? "Loading…"
                : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`}
            </span>
          </span>
        </button>
      </section>

      {/* imported playlists from other services */}
      <ImportedPlaylists />

      {/* followed artists */}
      <section>
        <div className="mb-3">
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            Following
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Artists you follow — their releases feed your Release Radar.
          </p>
        </div>
        {likedArtists.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-muted-foreground">
            You&apos;re not following anyone yet. Hit the bell on an artist below.
          </p>
        ) : (
          <div className="slider-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {likedArtists.map((artist: Artist) => {
              const top = artistTracks(artist.id).sort((a, b) => b.popularity - a.popularity);
              return (
                <div key={artist.id} className="group w-24 shrink-0 text-left">
                  <button
                    type="button"
                    onClick={() => {
                      if (top.length > 0) {
                        const s = usePlayerStore.getState();
                        s.playTrack(top[0], top);
                      }
                    }}
                    className="block w-full"
                  >
                    <img
                      src={top[0] ? coverArt(albumById(top[0].albumId)) : ""}
                      alt=""
                      className="aspect-square w-full rounded-full object-cover ring-1 ring-white/10"
                    />
                    <p className="mt-2 truncate text-sm font-semibold">{artist.name}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleFollowArtist(artist.id)}
                    className="mt-1 w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Unfollow
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* playlists */}
      <section>
        <div className="mb-3">
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            Popular playlists
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Curated mixes the world is listening to — one tap to play.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {POPULAR_MIXES.map((mix) => (
            <PopularMixCard key={mix.id} mix={mix} />
          ))}
        </div>
      </section>

      {/* playlists */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Playlists
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Collections you build from the catalog.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium transition-colors hover:bg-white/[0.08]"
          >
            <Plus className="size-4" />
            New playlist
          </button>
        </div>
        {playlists !== undefined && playlists.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 py-10 text-center">
            <ListMusic className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No playlists yet. Create one and start adding songs.
            </p>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="mt-1 text-sm font-semibold text-[rgb(var(--tint))] hover:underline"
            >
              Create your first playlist
            </button>
          </div>
        ) : (
          <div className="slider-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {playlists?.map((p) => (
              <PlaylistCard key={p._id} playlist={p} />
            ))}
            {playlists === undefined &&
              [0, 1, 2].map((i) => (
                <div key={i} className="w-36 shrink-0 sm:w-44">
                  <div className="aspect-square animate-pulse rounded-xl bg-white/[0.05]" />
                  <div className="mt-2.5 h-4 w-2/3 animate-pulse rounded bg-white/[0.05]" />
                </div>
              ))}
          </div>
        )}
      </section>

      {/* albums with sort + filter */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Albums
            </h2>
            <p className="-mt-2 mt-0.5 text-sm text-muted-foreground">
              {albumFilter === "liked" ? "Your liked albums" : "The complete SYNQ catalog"} ·{" "}
              {albums.length} {albums.length === 1 ? "album" : "albums"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* sort */}
            <select
              value={albumSort}
              onChange={(e) => setAlbumSort(e.target.value as SortMode)}
              className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-foreground outline-none"
              aria-label="Sort albums"
            >
              <option value="recent">Recently added</option>
              <option value="alpha">Alphabetical</option>
              <option value="creator">By artist</option>
            </select>
            {/* filter */}
            <div className="flex overflow-hidden rounded-full border border-white/10">
              {(["all", "liked"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAlbumFilter(mode)}
                  className={cn(
                    "px-3 py-1.5 text-xs capitalize transition-colors",
                    albumFilter === mode
                      ? "bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </div>
        {albums.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
            No albums match this filter yet. Tap the heart on an album to save it here.
          </p>
        ) : (
          <div className="slider-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {albums.map((album) => (
              <div key={album.id} className="relative">
                <AlbumCard album={album} />
                <button
                  type="button"
                  aria-label={likedAlbumIds[album.id] ? "Remove from liked albums" : "Add to liked albums"}
                  onClick={() => toggleLikedAlbum(album.id)}
                  className={cn(
                    "absolute -top-1.5 -right-1.5 z-10 rounded-full border border-white/10 bg-black/70 p-1.5 backdrop-blur transition-colors",
                    likedAlbumIds[album.id]
                      ? "text-[rgb(var(--tint))]"
                      : "text-muted-foreground/60 hover:text-foreground",
                  )}
                >
                  <Heart className={cn("size-3.5", likedAlbumIds[album.id] && "fill-current")} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <PlaylistDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

/**
 * Playlists imported from other music services (Settings → Import). Each
 * track is a title/artist snapshot, resolved to a playable track via a live
 * search when the playlist starts.
 */
function ImportedPlaylists() {
  const imported = useQuery(api.playlists.myImportedPlaylists);
  const searchYt = useAction(api.youtube.searchYoutube);
  const removeImported = useMutation(api.playlists.removeImported);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const [playingId, setPlayingId] = useState<string | null>(null);

  if (imported !== undefined && imported.length === 0) return null;

  const play = async (pl: { _id: string; name: string; tracks: { title: string; artist: string; duration?: number }[] }) => {
    if (playingId) return;
    setPlayingId(pl._id);
    try {
      // Resolve the first few tracks concurrently, then queue them in order.
      const resolved = await Promise.all(
        pl.tracks.slice(0, 25).map(async (t) => {
          try {
            const { items } = await searchYt({
              query: `${t.title} ${t.artist}`.trim(),
            });
            return items[0] ?? null;
          } catch {
            return null;
          }
        }),
      );
      const found = resolved.filter((it): it is YtItem => it !== null);
      if (found.length === 0) {
        toast.error(`Couldn't find playable tracks for "${pl.name}"`);
        return;
      }
      const queue = found.map((it, i) =>
        toPlayableYoutube(it, it.id, found.slice(i + 1)),
      );
      playTrack(queue[0], queue);
      toast.success(
        `Playing "${pl.name}" — ${found.length} of ${pl.tracks.length} songs found`,
      );
    } catch {
      toast.error("Couldn't play this playlist — try again");
    } finally {
      setPlayingId(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            Imported playlists
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Brought over from your other music services.
          </p>
        </div>
      </div>
      {imported === undefined ? (
        <div className="flex items-center gap-2 px-1 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {imported.map((pl) => (
            <div
              key={pl._id}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 transition-colors hover:bg-white/[0.05]"
            >
              <button
                type="button"
                aria-label={`Play ${pl.name}`}
                onClick={() => void play(pl)}
                disabled={playingId !== null}
                className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[rgb(var(--tint)/0.8)] to-purple-500/70 text-white disabled:opacity-60"
              >
                {playingId === pl._id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-5 fill-current" />
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{pl.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {pl.tracks.length} {pl.tracks.length === 1 ? "song" : "songs"}
                </p>
              </div>
              <button
                type="button"
                aria-label={`Remove ${pl.name}`}
                onClick={() => {
                  void removeImported({ playlistId: pl._id });
                  toast.success(`Removed "${pl.name}"`);
                }}
                className="shrink-0 rounded-full p-2 text-muted-foreground/60 opacity-0 transition-all hover:bg-white/10 hover:text-red-400 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
