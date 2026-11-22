import { useMemo } from "react";
import { Link } from "react-router";
import { Disc3, Play } from "lucide-react";
import { toast } from "sonner";

import { albumPath } from "@/lib/artistLinks";
import { usePlayerStore } from "@/store/player";

/**
 * The Albums page — the reference sidebar's "Albums" section.
 *
 * SYNQ's album identity lives on two real surfaces, so this page reads both
 * rather than inventing a third: the albums named in the listener's play
 * history (each entry carries the album + cover it was played from) and the
 * albums saved via the like-album action (ids that match history rows carry
 * their artwork; the rest render as named entries awaiting a first play).
 * Everything links to the real album page, which owns the tracklist.
 */

export default function Albums() {
  const history = usePlayerStore((s) => s.history);
  const likedAlbums = usePlayerStore((s) => s.likedAlbums);
  const likedAlbumIds = useMemo(() => Object.keys(likedAlbums), [likedAlbums]);

  // History rows with a real album name become album cards. Two entries of
  // the same release collapse into one card (artist + album is the key the
  // album route parses, so it is also the dedupe key here).
  const fromHistory = useMemo(() => {
    const seen = new Map<
      string,
      { key: string; album: string; artist: string; cover: string }
    >();
    for (const entry of history) {
      const album = entry.albumName?.trim();
      if (!album) continue;
      const artist = entry.artistName?.trim() || "";
      const key = `${artist}—${album.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          album,
          artist,
          cover: entry.coverUrl ?? "",
        });
      }
    }
    return [...seen.values()];
  }, [history]);

  const savedButUnplayed = likedAlbumIds.filter((id) => {
    const album = id.split("—").slice(1)?.[0]?.toLowerCase();
    return !fromHistory.some(
      (entry) => entry.album.toLowerCase() === album,
    );
  });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Albums
        </h1>
        <p className="text-sm text-muted-foreground">
          The releases you've played and saved, gathered from your own
          listening — not a store catalogue.
        </p>
      </header>

      {fromHistory.length === 0 && savedButUnplayed.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[var(--radius-panel)] border border-white/[0.07] bg-white/[0.02] px-6 py-14 text-center">
          <Disc3 className="size-10 text-muted-foreground/40" />
          <p className="font-display text-lg font-bold">No albums yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Play songs that belong to a release and it will show up here.
          </p>
        </div>
      ) : null}

      {fromHistory.length > 0 ? (
        <section aria-labelledby="albums-played">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2
              id="albums-played"
              className="font-display text-lg font-bold tracking-tight"
            >
              From your listening
            </h2>
            <span className="text-xs text-muted-foreground">
              {fromHistory.length} {fromHistory.length === 1 ? "album" : "albums"}
            </span>
          </div>
          <div className="stagger-in grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {fromHistory.map((entry) => (
              <Link
                key={entry.key}
                to={albumPath(entry.artist, entry.album) ?? "#"}
                onClick={(event) => {
                  const target = albumPath(entry.artist, entry.album);
                  if (!target) {
                    event.preventDefault();
                    toast.error("That album doesn't have a page yet");
                  }
                }}
                className="press-98 group flex flex-col gap-2 rounded-[var(--radius-card)] p-2 text-left transition-[color,background-color,transform] duration-200 hover:-translate-y-1 hover:bg-[var(--surface-container)]"
              >
                <span className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-cover)] bg-white/[0.04] ring-1 ring-white/10">
                  {entry.cover ? (
                    <img
                      src={entry.cover}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <span className="flex size-full items-center justify-center">
                      <Disc3 className="size-6 text-muted-foreground/40" />
                    </span>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                    <Play className="size-8 fill-current text-white" />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">
                    {entry.album}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {entry.artist || "Unknown artist"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {savedButUnplayed.length > 0 ? (
        <section aria-labelledby="albums-saved">
          <h2 id="albums-saved" className="font-display text-lg font-bold">
            Saved, not played yet
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {savedButUnplayed.length} saved{" "}
            {savedButUnplayed.length === 1 ? "album" : "albums"} will appear
            with artwork once a song from them plays.
          </p>
        </section>
      ) : null}
    </div>
  );
}
