import { useNavigate, useParams, Link } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { useAction, useMutation, useQuery } from "convex/react";
import { ListMusic, Play, Search as SearchIcon, Shuffle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { usePlayerStore } from "@/store/player";
import type { YtItem } from "@/lib/youtube";

export default function PlaylistDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const playlist = useQuery(api.playlists.get, {
    playlistId: id as Id<"playlists">,
  });
  const removeTrack = useMutation(api.playlists.removeTrack);
  const removePlaylist = useMutation(api.playlists.remove);
  const searchYt = useAction(api.youtube.searchYoutube);
  const playTrack = usePlayerStore((s) => s.playTrack);

  const [resolvingId, setResolvingId] = useState<string | null>(null);

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

  // Rows are lightweight snapshots derived from the stored track ids. Track
  // titles resolve at play time (the stored id is the YouTube video id where
  // known; the first search hit covers the rest).
  const rows = playlist.trackIds.map((trackId) => ({
    id: trackId,
    title: "",
    artist: "",
    thumbnail: "",
    duration: 0,
  }));
  const total = 0;
  const firstRow = rows[0];

  // In-playlist search — no scrolling through 500 songs. (Titles are resolved
  // lazily, so this filter matches once a song has been resolved this session.)
  const [filter, setFilter] = useState("");
  const visibleTracks = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows.map((track, i) => ({ track, i }));
    return rows
      .map((track, i) => ({ track, i }))
      .filter(({ track }) => track.title.toLowerCase().includes(q));
  }, [rows, filter]);

  const playRow = (row: (typeof rows)[number]) => {
    if (resolvingId) return;
    setResolvingId(row.id);
    searchYt({ query: row.title || row.id })
      .then(({ items }) => {
        const best = items.find((f) => f.id === row.id) ?? items[0];
        if (!best) {
          toast.error(`Couldn't load this song — try again`);
          return;
        }
        const playable = toPlayableYoutube(
          best,
          `https://youtu.be/${best.id}`,
          items.slice(1),
        );
        playTrack(playable);
      })
      .catch(() => toast.error("Playback failed — try again in a moment"))
      .finally(() => setResolvingId(null));
  };

  const playAll = () => {
    if (!firstRow) return;
    playRow(firstRow);
  };

  const shuffleAll = () => {
    if (rows.length === 0) return;
    const pick = rows[Math.floor(Math.random() * rows.length)];
    playRow(pick);
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

  return (
    <div className="flex flex-col gap-6">
      {/* header */}
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
          <p className="mt-2 text-sm text-muted-foreground">
            {playlist.trackIds.length}{" "}
            {playlist.trackIds.length === 1 ? "song" : "songs"}
            {total > 0 && ` · ${formatTime(total)}`}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={playAll}
              className="flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-all hover:scale-[1.03] active:scale-95"
            >
              <Play className="size-4 fill-current" />
              Play all
            </button>
            {playlist.trackIds.length > 0 && (
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

      {/* tracks */}
      {rows.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          {rows.length > 20 && (
            <div className="relative mb-3 max-w-sm">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search in playlist…"
                className="h-10 w-full rounded-full border border-white/10 bg-white/[0.05] pr-4 pl-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-[rgb(var(--tint)_/_0.6)] focus:outline-none"
              />
            </div>
          )}
          {visibleTracks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No songs in this playlist match "{filter}".
            </p>
          ) : (
            visibleTracks.map(({ track, i }) => (
              <RemoteTrackRow
                key={`${track.id}-${i}`}
                item={toYtItem(track)}
                index={i + 1}
                resolving={resolvingId === track.id}
                onPlay={(it) => playResolved(it, i)}
                source="youtube"
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

  function toYtItem(track: { id: string; title: string; artist: string; thumbnail: string; duration: number }): YtItem {
    return {
      id: track.id,
      title: track.title || "Playlist song",
      artist: track.artist || "",
      thumbnail: track.thumbnail,
      duration: track.duration,
    };
  }

  function playResolved(item: YtItem, index: number) {
    const row = rows[index];
    if (resolvingId) return;
    setResolvingId(item.id);
    searchYt({ query: row.title || item.id })
      .then(({ items }) => {
        const best = items.find((f) => f.id === item.id) ?? items.find((f) => f.title === item.title) ?? items[0];
        if (!best) {
          toast.error("Couldn't load this song — try again");
          return;
        }
        playTrack(toPlayableYoutube(best, `https://youtu.be/${best.id}`, items.slice(1)));
      })
      .catch(() => toast.error("Playback failed — try again in a moment"))
      .finally(() => setResolvingId(null));
  }
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
        <h2 className="font-display text-sm font-bold tracking-tight">
          Recent activity
        </h2>
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
        {shown.map((e) => {
          const kind = KIND_LABELS[e.kind] ?? {
            text: e.kind,
            className: "text-muted-foreground",
          };
          return (
            <li key={e._id} className="text-xs text-muted-foreground">
              <span className={cn("font-semibold", kind.className)}>{kind.text}</span>{" "}
              {e.detail ? <span className="text-foreground">{e.detail}</span> : null}
              {e.kind === "renamed" && e.detail ? ` (was "${e.detail}")` : null}
              <span className="ml-2 opacity-60">
                {new Date(e.at).toLocaleString(undefined, {
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
