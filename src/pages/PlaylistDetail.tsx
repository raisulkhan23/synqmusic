import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAction, useMutation, useQuery } from "convex/react";
import { ListMusic, Play, Search as SearchIcon, Shuffle, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { AddToPlaylistMenu } from "@/components/playlists/AddToPlaylistMenu";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import { cleanArtistName, type YtItem } from "@/lib/youtube";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/store/player";

interface PlaylistRow {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: number;
  youtubeId?: string;
  hasSnapshot: boolean;
}

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playlist = useQuery(api.playlists.get, {
    playlistId: id as Id<"playlists">,
  });
  const removePlaylist = useMutation(api.playlists.remove);
  const removeTrack = useMutation(api.playlists.removeTrack);
  const addTrack = useMutation(api.playlists.addTrack);
  const searchYt = useAction(api.youtube.searchYoutube);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  if (playlist === undefined) {
    return (
      <div className="flex flex-col gap-3 py-10">
        <div className="h-40 w-40 animate-pulse rounded-2xl bg-white/[0.05]" />
        <div className="h-8 w-56 animate-pulse rounded bg-white/[0.05]" />
        <div className="h-4 w-40 animate-pulse rounded bg-white/[0.05]" />
      </div>
    );
  }

  if (playlist === null) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <ListMusic className="size-10 text-muted-foreground/40" />
        <div>
          <p className="font-display text-lg font-semibold">Playlist not found</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or it belongs to another account.
          </p>
        </div>
        <Link
          to="/playlists"
          className="mt-1 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black"
        >
          Back to playlists
        </Link>
      </div>
    );
  }

  const snapshots = new Map(
    (playlist.trackSnapshots ?? []).map((snapshot) => [snapshot.id, snapshot]),
  );
  const rows: PlaylistRow[] = playlist.trackIds.map((trackId) => {
    const snapshot = snapshots.get(trackId);
    return {
      id: trackId,
      title: snapshot?.title ?? "Playlist song",
      artist: cleanArtistName(snapshot?.artist, snapshot?.title),
      thumbnail: snapshot?.coverUrl ?? "",
      duration: snapshot?.duration ?? 0,
      youtubeId: snapshot?.youtubeId,
      hasSnapshot: snapshot !== undefined,
    };
  });
  const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.duration) ? row.duration : 0), 0);
  const query = filter.trim().toLocaleLowerCase();
  const visibleRows = rows
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => {
      if (!query) return true;
      return `${track.title} ${track.artist}`.toLocaleLowerCase().includes(query);
    });

  const directPlayable = (row: PlaylistRow): Playable | null => {
    if (!row.hasSnapshot) return null;
    const item: YtItem = {
      id: row.youtubeId ?? row.id,
      title: row.title,
      artist: cleanArtistName(row.artist, row.title),
      thumbnail: row.thumbnail,
      duration: row.duration,
    };
    return toPlayableYoutube(item, `https://youtu.be/${item.id}`);
  };

  const directQueue = rows.flatMap((row) => {
    const playable = directPlayable(row);
    return playable ? [playable] : [];
  });

  const resolveLegacyRow = async (row: PlaylistRow): Promise<Playable | null> => {
    const direct = directPlayable(row);
    if (direct) return direct;
    const searchQuery = row.hasSnapshot
      ? `${row.title} ${row.artist}`.trim()
      : row.id;
    const { items } = await searchYt({ query: searchQuery });
    const best =
      items.find((item) => item.id === row.youtubeId || item.id === row.id) ??
      items.find((item) => item.title.toLocaleLowerCase() === row.title.toLocaleLowerCase()) ??
      items[0];
    return best
      ? toPlayableYoutube(best, `https://youtu.be/${best.id}`, items.filter((item) => item.id !== best.id))
      : null;
  };

  const playRow = async (row: PlaylistRow) => {
    if (resolvingId) return;
    setResolvingId(row.id);
    try {
      const playable = await resolveLegacyRow(row);
      if (!playable) {
        toast.error(`Couldn't find a playable version of "${row.title}"`);
        return;
      }
      const queue = directQueue.length > 0 ? directQueue : [playable];
      playTrack(playable, queue);
    } catch {
      toast.error("Playback failed — try again in a moment");
    } finally {
      setResolvingId(null);
    }
  };

  const playAll = async () => {
    if (rows.length === 0 || resolvingId) return;
    setResolvingId("__all__");
    try {
      const resolved: Playable[] = [];
      // New playlists are fully playable without a network round-trip. Only
      // legacy id-only rows need the compatibility resolver.
      for (const row of rows) {
        const playable = await resolveLegacyRow(row);
        if (playable) resolved.push(playable);
      }
      if (resolved.length === 0) {
        toast.error("None of these tracks could be resolved right now");
        return;
      }
      playTrack(resolved[0], resolved);
      if (resolved.length < rows.length) {
        toast.warning(`Playing ${resolved.length} of ${rows.length} available tracks`);
      }
    } catch {
      toast.error("Couldn't start this playlist — try again");
    } finally {
      setResolvingId(null);
    }
  };

  const shuffleAll = () => {
    if (directQueue.length > 0) {
      // eslint-disable-next-line react-hooks/purity -- user-triggered shuffle
      const candidate = directQueue[Math.floor(Math.random() * directQueue.length)];
      if (!candidate) return;
      playTrack(candidate, directQueue);
    } else {
      // eslint-disable-next-line react-hooks/purity -- user-triggered shuffle
      const candidate = rows[Math.floor(Math.random() * rows.length)];
      if (!candidate) return;
      void playRow(candidate);
    }
    if (!usePlayerStore.getState().shuffle) usePlayerStore.getState().toggleShuffle();
    toast.success("Shuffling the playlist");
  };

  const handleDelete = async () => {
    try {
      await removePlaylist({ playlistId: playlist._id });
      toast.success(`Deleted "${playlist.name}"`);
      navigate("/playlists");
    } catch {
      toast.error("Could not delete the playlist");
    }
  };

  const handleRemove = async (row: PlaylistRow) => {
    try {
      await removeTrack({ playlistId: playlist._id, trackId: row.id, detail: row.title });
      toast("Removed from playlist", {
        action: {
          label: "Undo",
          onClick: () => {
            void addTrack({
              playlistId: playlist._id,
              trackId: row.id,
              detail: row.title,
              track: row.hasSnapshot
                ? {
                    id: row.id,
                    title: row.title,
                    artist: row.artist,
                    coverUrl: row.thumbnail,
                    duration: row.duration,
                    youtubeId: row.youtubeId,
                  }
                : undefined,
            }).catch(() => toast.error("Couldn't restore the song"));
          },
        },
      });
    } catch {
      toast.error("Couldn't remove the song");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end">
        <div className="flex size-40 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-white/[0.09] to-white/[0.03] shadow-2xl ring-1 ring-white/10 sm:size-48">
          <ListMusic className="size-10 text-muted-foreground/50" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Playlist
          </p>
          <h1 className="mt-1 truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">{playlist.description}</p>
          )}
          <p className="mt-2 text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? "song" : "songs"}
            {total > 0 && ` · ${formatTime(total)}`}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void playAll()}
              disabled={resolvingId !== null}
              className="flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-60"
            >
              <Play className="size-4 fill-current" />
              {resolvingId === "__all__" ? "Loading…" : "Play all"}
            </button>
            {rows.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={shuffleAll}
                  className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.1]"
                >
                  <Shuffle className="size-4" />
                  Shuffle
                </button>
                <button
                  type="button"
                  aria-label="Delete playlist"
                  onClick={() => void handleDelete()}
                  className="flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-2 text-sm text-muted-foreground transition-colors hover:border-red-500/40 hover:text-red-400"
                >
                  <Trash2 className="size-4" />
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {rows.length > 5 && (
            <div className="relative mb-3 max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Search in playlist…"
                aria-label="Search in playlist"
                className="h-10 w-full rounded-full border border-white/10 bg-white/[0.05] pr-4 pl-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-[rgb(var(--tint)_/_0.6)] focus:outline-none"
              />
            </div>
          )}
          {visibleRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No songs in this playlist match "{filter}".
            </p>
          ) : (
            visibleRows.map(({ track, index }) => (
              <RemoteTrackRow
                key={`${track.id}-${index}`}
                item={toYtItem(track)}
                index={index + 1}
                resolving={resolvingId === track.id}
                onPlay={() => void playRow(track)}
                source="youtube"
                trailing={
                  <div className="flex items-center gap-1">
                    <AddToPlaylistMenu
                      track={toPlayable(track)}
                      className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${track.title} from playlist`}
                      title="Remove from playlist"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleRemove(track);
                      }}
                      className="rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                }
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 py-16 text-center">
          <ListMusic className="size-10 text-muted-foreground/40" />
          <p className="max-w-sm text-sm text-muted-foreground">
            This playlist is empty. Add songs from search results.
          </p>
          <Link
            to="/search"
            className="mt-1 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black"
          >
            Find music
          </Link>
        </div>
      )}

      <ChangeHistory playlistId={playlist._id} />
    </div>
  );
}

function toYtItem(track: PlaylistRow): YtItem {
  return {
    id: track.youtubeId ?? track.id,
    title: track.title,
    artist: cleanArtistName(track.artist, track.title),
    thumbnail: track.thumbnail,
    duration: track.duration,
  };
}

function toPlayable(track: PlaylistRow): Playable {
  return {
    id: track.id,
    title: track.title,
    artistName: cleanArtistName(track.artist, track.title),
    albumName: "",
    coverUrl: track.thumbnail,
    duration: track.duration,
    audioUrl: `https://youtu.be/${track.youtubeId ?? track.id}`,
    source: "youtube",
    youtubeId: track.youtubeId ?? track.id,
  };
}

const KIND_LABELS: Record<string, { text: string; className: string }> = {
  created: { text: "created", className: "text-[rgb(var(--tint))]" },
  renamed: { text: "renamed", className: "text-amber-400" },
  added: { text: "added", className: "text-emerald-400" },
  removed: { text: "removed", className: "text-rose-400" },
  deleted: { text: "deleted", className: "text-red-500" },
};

function ChangeHistory({ playlistId }: { playlistId: Id<"playlists"> }) {
  const events = useQuery(api.playlists.changeHistory, { playlistId });
  const [open, setOpen] = useState(false);
  if (!events || events.length === 0) return null;
  const shown = open ? events : events.slice(0, 3);
  return (
    <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm font-bold tracking-tight">Recent activity</h2>
        {events.length > 3 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            {open ? "Show less" : `Show all (${events.length})`}
          </button>
        )}
      </div>
      <ul className="mt-2 space-y-1.5">
        {shown.map((event) => {
          const kind = KIND_LABELS[event.kind] ?? { text: event.kind, className: "text-muted-foreground" };
          return (
            <li key={event._id} className="text-xs text-muted-foreground">
              <span className={cn("font-semibold", kind.className)}>{kind.text}</span>{" "}
              {event.detail ? <span className="text-foreground">{event.detail}</span> : null}
              {event.kind === "renamed" && event.detail ? ` (was "${event.detail}")` : null}
              <span className="ml-2 opacity-60">
                {new Date(event.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
