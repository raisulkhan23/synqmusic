import { useNavigate } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { TrackRow } from "@/components/tracks/TrackRow";
import { api } from "@/convex/_generated/api";
import { toPlayable } from "@/lib/playable";
import { trackById } from "@/lib/catalog";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import type { Playable } from "@/lib/playable";
import type { YtItem } from "@/lib/youtube";
import { toast } from "sonner";
import { usePlayerStore } from "@/store/player";
import { useAction, useQuery } from "convex/react";
import { Heart, Loader2, Play, Shuffle } from "lucide-react";
import { useState } from "react";

export default function Liked() {
  const navigate = useNavigate();
  const liked = usePlayerStore((s) => s.liked);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const searchYt = useAction(api.youtube.searchYoutube);

  const [resolvingRemoteId, setResolvingRemoteId] = useState<string | null>(null);
  const remoteQuery = useQuery(api.likes.myLikedRemote);
  const remoteLikes = remoteQuery ?? [];

  const likedTracks = Object.entries(liked)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => trackById(id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined)
    .filter((t) => remoteLikes.every((r) => r.trackId !== t.id));

  const totalCount = likedTracks.length + remoteLikes.length;
  const totalSeconds =
    likedTracks.reduce((sum, t) => sum + t.duration, 0) +
    remoteLikes.reduce((sum, r) => sum + r.duration, 0);

  const playRemoteLike = (row: (typeof remoteLikes)[number]) => {
    if (resolvingRemoteId) return;
    setResolvingRemoteId(row.trackId);
    searchYt({ query: `${row.title} ${row.artistName.split(",")[0]?.trim() ?? row.artistName}` })
      .then(({ items }) => {
        const best = items[0];
        if (!best) {
          toast.error(`Couldn't load "${row.title}" — try another song`);
          return;
        }
        const item: YtItem = {
          id: row.trackId,
          title: row.title,
          artist: row.artistName,
          thumbnail: row.coverUrl,
          duration: row.duration,
        };
        const playable = {
          ...toPlayableYoutube(item, `https://youtu.be/${best.id}`, items.slice(1)),
          youtubeId: best.id,
        };
        playTrack(playable, buildLikedQueue(playable));
      })
      .catch(() => toast.error("Playback failed — try again in a moment"))
      .finally(() => setResolvingRemoteId(null));
  };

  /**
   * Resolve the full Liked Songs list into a playable queue: catalog tracks
   * are instant, remote likes are matched through a live search. Used by both
   * Play All and Shuffle All so the ENTIRE playlist lands in the queue.
   */
  const buildLikedQueue = (firstPlayable: Playable, firstIsRemote?: string): Playable[] => {
    const out: Playable[] = [];
    const remoteById = new Map(remoteLikes.map((r) => [r.trackId, r]));
    let firstInserted = false;
    for (const row of remoteLikes) {
      if (firstIsRemote === row.trackId) {
        out.push(firstPlayable);
        firstInserted = true;
        continue;
      }
      // Unresolved remote likes get a placeholder stream entry — the player's
      // auto-rescue handles them when they come up in the queue.
      const item: YtItem = {
        id: row.trackId,
        title: row.title,
        artist: row.artistName,
        thumbnail: row.coverUrl,
        duration: row.duration,
      };
      out.push({
        ...toPlayableYoutube(item, row.youtubeId ?? item.id),
        youtubeId: row.youtubeId ?? undefined,
      });
    }
    for (const t of likedTracks) out.push(toPlayable(t));
    void firstInserted;
    return out;
  };

  const playAll = () => {
    if (totalCount === 0) return;
    // Catalog tracks play directly with the full list in the queue.
    if (remoteLikes.length === 0) {
      playTrack(likedTracks[0], likedTracks);
      return;
    }
    // Mixed/remote list: resolve the first remote like, queue everything.
    const first = remoteLikes[0];
    playRemoteLike(first);
  };

  const shuffleAll = () => {
    if (totalCount === 0) return;
    // Catalog-only: use the player's built-in shuffle queue.
    if (remoteLikes.length === 0) {
      const shuffled = [...likedTracks].sort(() => Math.random() - 0.5);
      usePlayerStore.getState().playTrack(shuffled[0], shuffled);
      // Enable shuffle so subsequent skips stay shuffled.
      if (!usePlayerStore.getState().shuffle) usePlayerStore.getState().toggleShuffle();
      toast.success(`Shuffling ${shuffled.length} liked songs`);
      return;
    }
    // Remote list: pick a random remote like and let the queue play through.
    const row = remoteLikes[Math.floor(Math.random() * remoteLikes.length)];
    playRemoteLike(row);
    if (!usePlayerStore.getState().shuffle) usePlayerStore.getState().toggleShuffle();
    toast.success("Shuffling your liked songs");
  };

  // (Liked Songs header copy will be re-branded once SYNQ copy is in place.)


  const total = totalSeconds;

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/25 via-fuchsia-500/10 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-70" />
        <div className="relative flex items-end gap-5">
          <div className="flex size-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-500 to-fuchsia-600 shadow-2xl sm:size-32">
            <Heart className="size-12 fill-white text-white sm:size-16" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
              Playlist
            </p>
            <h1 className="mt-1 truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Liked Songs
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {likedLoaded
              ? totalCount > 0
                ? `${totalCount} ${totalCount === 1 ? "song" : "songs"} · ${formatTime(total)}`
                  : "Nothing here yet"
                : "Loading…"}
            </p>
          </div>
        </div>
      </div>

      {totalCount > 0 ? (
        <>
          <div className="flex items-center gap-3 px-2">
            <button
              type="button"
              onClick={playAll}
              disabled={resolvingRemoteId !== null}
              className="flex shrink-0 items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-60"
            >
              <Play className="size-4 fill-current" />
              Play all
            </button>
            <button
              type="button"
              onClick={shuffleAll}
              disabled={resolvingRemoteId !== null}
              className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.1] disabled:opacity-60"
            >
              {resolvingRemoteId !== null ? <Loader2 className="size-4 animate-spin" /> : <Shuffle className="size-4" />}
              Shuffle
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            {remoteLikes.map((row, i) => (
              <RemoteTrackRow
                key={row.trackId}
                item={{
                  id: row.trackId,
                  title: row.title,
                  artist: row.artistName,
                  thumbnail: row.coverUrl,
                  duration: row.duration,
                }}
                index={i + 1}
                resolving={resolvingRemoteId === row.trackId}
                onPlay={() => playRemoteLike(row)}
                source={row.source === "spotify" ? "spotify" : "youtube"}
              />
            ))}
            {likedTracks.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                list={likedTracks}
                index={remoteLikes.length + i + 1}
                onRemove={() => toggleLike(track.id)}
              />
            ))}
          </div>
        </>
      ) : likedLoaded ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Heart className="size-10 text-muted-foreground/30" />
          <div>
            <p className="font-display text-lg font-semibold">No liked songs yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Tap the heart on any track to save it here for quick playback.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/search")}
            className="mt-1 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-transform hover:scale-[1.03]"
          >
            Find music
          </button>
        </div>
      ) : null}
    </div>
  );
}