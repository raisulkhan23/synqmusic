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
import { useQuery } from "convex/react";
import { Heart, ListMusic, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

type SortMode = "recent" | "alpha" | "creator";
type FilterMode = "all" | "liked";

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
          <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
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
          <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
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
              {albumFilter === "liked" ? "Your liked albums" : "The complete SoundCore catalog"} ·{" "}
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
          <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
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
