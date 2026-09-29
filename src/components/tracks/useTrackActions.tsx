import { useMemo, useState } from "react";
import { toast } from "sonner";

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
import { usePlayerStore } from "@/store/player";
import {
  Heart,
  ListEnd,
  ListMusic,
  ListStart,
  MoreVertical,
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

  return {
    track,
    title,
    artistName,
    isLiked,
    likeThis,
    playNext,
    addQueued,
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
