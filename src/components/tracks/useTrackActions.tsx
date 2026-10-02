import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

import { AddToPlaylistItems } from "@/components/playlists/AddToPlaylistItems";
import { PlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { useAddToPlaylist } from "@/components/playlists/useAddToPlaylist";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { buildTrackShareUrl } from "@/lib/shareLink";
import { copyText } from "@/lib/clipboard";
import { toPlayableYoutube } from "@/lib/playable";
import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";
import {
  useTrackDownload,
  type TrackDownloadState,
} from "@/lib/trackDownload";
import { usePlayerStore } from "@/store/player";
import {
  Check,
  Download,
  Heart,
  ListEnd,
  ListMusic,
  ListStart,
  Loader2,
  MoreVertical,
  ThumbsDown,
  UserX,
} from "lucide-react";

/**
 * The actions every track surface offers — play next, add to queue, like,
 * add to playlist, copy link.
 *
 * This exists so a track's affordances are defined ONCE. `RemoteTrackRow`
 * (lists, search, playlists) and `MediaCard` (the Home shelves) render
 * completely different chrome around the same artwork and the same title, but
 * they must never disagree about what "Play next" does or which menu entry
 * copies the link.
 */
export function useTrackActions(
  item: YtItem,
  source: "youtube" | "spotify" = "youtube",
) {
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const isLiked = liked[item.id] !== undefined;
  const title = cleanTrackTitle(item.title);
  const artistName = cleanArtistName(item.artist, item.title);

  // The menu can create a playlist, so the dialog has to live outside the
  // dropdown content — that unmounts the moment an item is selected.
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);

  const track = useMemo(() => {
    const playable = toPlayableYoutube(item, "");
    return source === "youtube"
      ? playable
      : { ...playable, youtubeId: undefined };
  }, [item, source]);
  const { addTo } = useAddToPlaylist(track);

  // Download is offered on EVERY track, so the menu never silently lacks the
  // action — but it only completes for one whose licence the server clears.
  // The refusal is therefore a named reason on every surface rather than a
  // button that is absent with no explanation of why.
  const download = useTrackDownload({
    videoId: item.id,
    title,
    artistName,
    coverUrl: item.thumbnail,
    duration: item.duration,
  });

  const markNotInterested = useMutation(api.notInterested.markNotInterested);
  const unmarkNotInterested = useMutation(
    api.notInterested.unmarkNotInterested,
  );
  const invalidateRecommendCache = useMutation(api.recommend.invalidateCache);

  const likeThis = () =>
    toggleLike(item.id, {
      title,
      artistName,
      coverUrl: item.thumbnail,
      duration: item.duration,
      youtubeId: item.id,
      source,
    });

  const playNext = () => {
    const state = usePlayerStore.getState();
    const at =
      state.queueIndex >= 0 ? state.queueIndex + 1 : state.queue.length;
    state.insertInQueue(track, at);
    toast.success(`Playing "${title}" next`);
  };

  const addQueued = () => {
    usePlayerStore.getState().addToQueue(track);
    toast.success("Added to queue");
  };

  /**
   * "Not interested" — the deliberate negative signal.
   *
   * Two things make this feel trustworthy rather than ignored, and both were
   * the obvious failure modes:
   *
   * 1. THE CACHE IS DROPPED. Home payloads are cached for ten minutes. Writing
   *    the exclusion without invalidating would leave the listener staring at
   *    the song they just rejected, on a row that refreshes by itself, which
   *    reads as a broken button rather than a slow one.
   * 2. THERE IS AN UNDO. A one-tap permanent exclusion with no way back is a
   *    trap — a mis-tap silently removes an artist forever. The toast carries
   *    the reversal, and undo ALSO restores the cache state by invalidating
   *    again rather than trying to surgically re-insert a payload.
   *
   * If the write fails, the listener is told so rather than being left to
   * believe a preference was saved.
   *
   * The queue is deliberately NOT touched, and the current track is not
   * skipped. "Not interested" is a statement about what to be shown next, not a
   * stop button: silently cutting off audio mid-listen is a surprise, and the
   * one thing this feature must never be is destructive.
   */
  const notInterested = async () => {
    try {
      await markNotInterested({
        scope: "track",
        trackId: item.id,
        artistName,
      });
      await invalidateRecommendCache();
      toast.success(`Hidden "${title}"`, {
        description: artistName
          ? `We'll stop recommending it.`
          : "We'll stop recommending it.",
        action: {
          label: "Undo",
          onClick: () => {
            void undoNotInterested();
          },
        },
      });
    } catch {
      toast.error("Couldn't save that — try again");
    }
  };

  /** Not interested in the whole artist, not just this song. */
  const notInterestedInArtist = async () => {
    try {
      await markNotInterested({
        scope: "artist",
        trackId: item.id,
        artistName,
      });
      await invalidateRecommendCache();
      toast.success(`No more ${artistName}`, {
        description: "We'll stop recommending this artist.",
        action: {
          label: "Undo",
          onClick: () => {
            void undoNotInterested("artist");
          },
        },
      });
    } catch {
      toast.error("Couldn't save that — try again");
    }
  };

  const undoNotInterested = async (scope: "track" | "artist" = "track") => {
    try {
      await unmarkNotInterested({
        scope,
        trackId: item.id,
        artistName,
      });
      await invalidateRecommendCache();
      toast.success("Restored");
    } catch {
      toast.error("Couldn't undo that");
    }
  };

  return {
    track,
    title,
    artistName,
    isLiked,
    likeThis,
    playNext,
    addQueued,
    download: download.start,
    downloadState: download.state,
    notInterested,
    notInterestedInArtist,
    playlistDialogOpen,
    setPlaylistDialogOpen,
    renderPlaylistDialog: (
      <PlaylistDialog
        open={playlistDialogOpen}
        onOpenChange={setPlaylistDialogOpen}
        onCreate={(id, name) => void addTo(id, name)}
      />
    ),
  };
}

/**
 * The Download item's label, which doubles as its progress readout.
 *
 * One function so the row menu and any other menu built from the same hook
 * cannot disagree about what "in progress" looks like.
 */
function downloadLabel(state: TrackDownloadState): string {
  switch (state.status) {
    case "checking":
      return "Checking…";
    case "downloading":
      return state.progress === null
        ? "Downloading…"
        : `Downloading… ${Math.round(state.progress * 100)}%`;
    case "done":
      return "Downloaded";
    default:
      return "Download";
  }
}

/**
 * The overflow menu for a track. Shared by every surface that renders one, so
 * the set of actions is identical everywhere the user meets a song.
 */
export function TrackActionsMenu({
  item,
  source = "youtube",
  extraItems,
  triggerClassName,
  contentClassName,
}: {
  item: YtItem;
  source?: "youtube" | "spotify";
  /** Page-specific entries appended before "Add to playlist". */
  extraItems?: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const actions = useTrackActions(item, source);
  const { title } = actions;

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More options for ${title}`}
            className={triggerClassName}
          >
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={contentClassName ?? "w-56"}>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.stopPropagation();
              actions.playNext();
            }}
          >
            <ListStart className="size-4" />
            Play next
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.stopPropagation();
              actions.addQueued();
            }}
          >
            <ListEnd className="size-4" />
            Add to queue
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={() => {
              void copyText(
                buildTrackShareUrl(window.location.origin, actions.track),
              ).then((ok) => {
                if (ok) toast.success("Song link copied");
                else toast.error("Couldn't copy the link");
              });
            }}
          >
            <ListMusic className="size-4" />
            Copy song link
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.stopPropagation();
              actions.likeThis();
            }}
          >
            <Heart
              className={
                actions.isLiked
                  ? "size-4 fill-current text-[rgb(var(--tint))]"
                  : "size-4"
              }
            />
            {actions.isLiked ? "Remove from liked songs" : "Add to liked songs"}
          </DropdownMenuItem>
          {/* The deliberate negative signal. Its own submenu because "not this
              song" and "not this artist" are different decisions, and burying
              the artist one behind a long-press would mean it never gets used. */}
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.stopPropagation();
              void actions.notInterested();
            }}
          >
            <ThumbsDown className="size-4" />
            Not interested in this
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(event) => {
              event.stopPropagation();
              void actions.notInterestedInArtist();
            }}
          >
            <UserX className="size-4" />
            Not interested in {actions.artistName}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            disabled={
              actions.downloadState.status === "checking" ||
              actions.downloadState.status === "downloading"
            }
            onSelect={(event) => {
              event.stopPropagation();
              void actions.download();
            }}
          >
            {actions.downloadState.status === "checking" ||
            actions.downloadState.status === "downloading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : actions.downloadState.status === "done" ? (
              <Check className="size-4 text-[rgb(var(--tint))]" />
            ) : (
              <Download className="size-4" />
            )}
            {downloadLabel(actions.downloadState)}
          </DropdownMenuItem>
          {extraItems ? (
            <>
              <DropdownMenuSeparator />
              {extraItems}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <AddToPlaylistItems
            track={actions.track}
            onNewPlaylist={() => actions.setPlaylistDialogOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {actions.renderPlaylistDialog}
    </>
  );
}
