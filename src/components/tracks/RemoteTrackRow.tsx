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
import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { buildTrackShareUrl } from "@/lib/shareLink";
import { usePlayerStore } from "@/store/player";
import {
  Heart,
  ListEnd,
  ListMusic,
  ListStart,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  Radio,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const isRowActionTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest("button, [role='menuitem']"));

export function RemoteTrackRow({
  item,
  index,
  onPlay,
  resolving,
  source = "youtube",
  /** Optional extra content rendered before the like button (e.g. remove action). Pointer devices only. */
  trailing,
  /** Optional extra entries rendered inside the overflow menu (e.g. remove from playlist). */
  menuItems,
}: {
  item: YtItem;
  index: number;
  onPlay: (item: YtItem) => void;
  resolving?: boolean;
  /** Which provider the chart row came from (affects badge + link-out). */
  source?: "youtube" | "spotify";
  trailing?: ReactNode;
  menuItems?: ReactNode;
}) {
  const currentId = usePlayerStore((s) => s.current?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const startRadio = usePlayerStore((s) => s.startRadio);
  const isCurrent = currentId === item.id;
  const isLiked = liked[item.id] !== undefined;
  const displayTitle = cleanTrackTitle(item.title);
  const artistName = cleanArtistName(item.artist, item.title);

  // The overflow menu can create a playlist, so the dialog lives here (outside
  // the dropdown content, which unmounts as soon as an item is selected).
  const [playlistDialogOpen, setPlaylistDialogOpen] = useState(false);
  const playlistTrack = useMemo(() => {
    const playable = toPlayableYoutube(item, "");
    return source === "youtube"
      ? playable
      : { ...playable, youtubeId: undefined };
  }, [item, source]);
  const { addTo } = useAddToPlaylist(playlistTrack);

  const likeThis = () =>
    toggleLike(item.id, {
      title: displayTitle,
      artistName,
      coverUrl: item.thumbnail,
      duration: item.duration,
      youtubeId: item.id,
      source,
    });

  const playNext = () => {
    const s = usePlayerStore.getState();
    const at = s.queueIndex >= 0 ? s.queueIndex + 1 : s.queue.length;
    s.insertInQueue(playlistTrack, at);
    toast.success(`Playing "${displayTitle}" next`);
  };

  const addQueued = () => {
    usePlayerStore.getState().addToQueue(playlistTrack);
    toast.success("Added to queue");
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          // Dropdown menu items render in a portal, but the trigger and its
          // controls still live inside this row. Never let an action button
          // activate the row and start playback as a side effect.
          if (isRowActionTarget(e.target)) return;
          onPlay(item);
        }}
        onKeyDown={(e) => {
          // Only the row itself owns Enter/Space. Buttons and menu controls
          // handle their own keyboard activation.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPlay(item);
          }
        }}
        className={cn(
          // Touch layout: taller, roomier row so a thumb tap is easy and the
          // text never feels squeezed. Pointer devices keep the dense list row.
          "group relative flex min-h-14 select-none items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.05] active:bg-white/[0.08] sm:min-h-0 sm:py-1.5",
          isCurrent && "bg-white/[0.04]",
        )}
      >
        {/* Rank / hover-to-play is pointless on touch and only adds clutter. */}
        <div className="relative hidden shrink-0 items-center justify-center sm:flex">
          {resolving ? (
            <Loader2 className="size-4 animate-spin text-[rgb(var(--tint))]" />
          ) : (
            <span className="text-sm tabular-nums text-muted-foreground/60">
              {index}
            </span>
          )}
          {!resolving && (
            <button
              type="button"
              aria-label={`Play ${displayTitle}`}
              onClick={(e) => {
                e.stopPropagation();
                onPlay(item);
              }}
              className="absolute inset-0 hidden items-center justify-center group-hover:flex"
            >
              {isCurrent && isPlaying ? (
                <Pause className="size-4 fill-current text-foreground" />
              ) : (
                <Play className="ml-0.5 size-4 fill-current text-foreground" />
              )}
            </button>
          )}
        </div>

        {resolving && (
          <Loader2 className="size-4 shrink-0 animate-spin text-[rgb(var(--tint))] sm:hidden" />
        )}

        {/* Artwork stays on every screen size — it's the one non-interactive
            element that earns its space in a touch row. */}
        <div className="relative size-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 sm:size-10 sm:rounded-md">
          <img
            src={item.thumbnail}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-[0.9375rem] leading-tight font-medium sm:text-sm",
              isCurrent && "text-[rgb(var(--tint))]",
            )}
          >
            {displayTitle}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {artistName}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:ml-auto sm:gap-2">
          {trailing ? (
            <div className="hidden shrink-0 items-center gap-2 sm:flex">
              {trailing}
            </div>
          ) : null}
          {/* Secondary controls live in the overflow menu on touch devices. */}
          <button
            type="button"
            aria-label={`Start ${displayTitle} radio`}
            title="Start radio — endless related mix"
            onClick={(e) => {
              e.stopPropagation();
              startRadio({
                id: item.id,
                title: displayTitle,
                artistName,
                albumName: "",
                coverUrl: item.thumbnail,
                audioUrl: "",
                duration: item.duration,
                source: "youtube",
                youtubeId: item.id,
              });
            }}
            className="hidden rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground sm:inline-flex"
          >
            <Radio className="size-4" />
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More options for ${displayTitle}`}
                onClick={(e) => e.stopPropagation()}
                className="rounded-full p-2 text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground sm:p-1.5"
              >
                <MoreVertical className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                className="gap-2"
                onSelect={(event) => {
                  event.stopPropagation();
                  playNext();
                }}
              >
                <ListStart className="size-4" />
                Play next
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={(event) => {
                  event.stopPropagation();
                  addQueued();
                }}
              >
                <ListEnd className="size-4" />
                Add to queue
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => {
                  // A deep link to the song itself. This used to copy
                  // `/search?q=<title> <artist>`, which dumped the recipient on
                  // a pre-filled search box: they still had to press search and
                  // pick the right row, and a badly tagged track came back as a
                  // completely different song.
                  void copyText(
                    buildTrackShareUrl(window.location.origin, playlistTrack),
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
                  likeThis();
                }}
              >
                <Heart
                  className={cn(
                    "size-4",
                    isLiked && "fill-current text-[rgb(var(--tint))]",
                  )}
                />
                {isLiked ? "Remove from liked songs" : "Add to liked songs"}
              </DropdownMenuItem>
              {menuItems ? (
                <>
                  <DropdownMenuSeparator />
                  {menuItems}
                </>
              ) : null}
              <DropdownMenuSeparator />
              <AddToPlaylistItems
                track={playlistTrack}
                onNewPlaylist={() => setPlaylistDialogOpen(true)}
              />
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            aria-label={
              isLiked ? "Remove from liked songs" : "Add to liked songs"
            }
            onClick={(e) => {
              e.stopPropagation();
              likeThis();
            }}
            className={cn(
              "hidden rounded-full p-1.5 transition-colors sm:inline-flex",
              isLiked
                ? "text-[rgb(var(--tint))]"
                : "text-muted-foreground/70 hover:bg-white/10 hover:text-foreground",
            )}
          >
            <Heart className={cn("size-4", isLiked && "fill-current")} />
          </button>
          <span className="ml-1 text-xs tabular-nums text-muted-foreground/70 sm:ml-0 sm:text-sm">
            {formatTime(item.duration)}
          </span>
        </div>
      </div>
      <PlaylistDialog
        open={playlistDialogOpen}
        onOpenChange={setPlaylistDialogOpen}
        onCreate={(id, name) => void addTo(id, name)}
      />
    </>
  );
}
