import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";
import type React from "react";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { cn } from "@/lib/utils";
import { Heart, ListEnd, ListMusic, ListStart, Loader2, MoreVertical, Pause, Play, Radio } from "lucide-react";
import { usePlayerStore } from "@/store/player";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { AddToPlaylistMenu } from "@/components/playlists/AddToPlaylistMenu";

const isRowActionTarget = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("button, [role='menuitem']"));

export function RemoteTrackRow({
  item,
  index,
  onPlay,
  resolving,
  source = "youtube",
  /** Optional extra content rendered before the like button (e.g. remove action). */
  trailing,
}: {
  item: YtItem;
  index: number;
  onPlay: (item: YtItem) => void;
  resolving?: boolean;
  /** Which provider the chart row came from (affects badge + link-out). */
  source?: "youtube" | "spotify";
  trailing?: React.ReactNode;
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

  const likeThis = () =>
    toggleLike(item.id, {
      title: displayTitle,
      artistName,
      coverUrl: item.thumbnail,
      duration: item.duration,
      youtubeId: item.id,
      source,
    });

  const asPlayable = () => toPlayableYoutube(item, "");
  const playlistTrack = () =>
    source === "youtube" ? asPlayable() : { ...asPlayable(), youtubeId: undefined };

  const playNext = () => {
    const s = usePlayerStore.getState();
    const at = s.queueIndex >= 0 ? s.queueIndex + 1 : s.queue.length;
    s.insertInQueue(asPlayable(), at);
    toast.success(`Playing "${displayTitle}" next`);
  };

  const addQueued = () => {
    usePlayerStore.getState().addToQueue(asPlayable());
    toast.success("Added to queue");
  };

  return (
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
        "group relative flex cursor-pointer items-center gap-3 rounded-xl px-3 py-1.5 transition-colors hover:bg-white/[0.05]",
        isCurrent && "bg-white/[0.04]",
      )}
    >
      <div className="relative flex shrink-0 items-center justify-center">
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

      <div className="relative size-10 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10">
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
            "truncate text-sm font-medium",
            isCurrent && "text-[rgb(var(--tint))]",
          )}
        >
          {displayTitle}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {artistName}
        </p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {trailing}
        <AddToPlaylistMenu
          track={playlistTrack()}
          className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100"
        />
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
          className="rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Radio className="size-4" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More options for ${displayTitle}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded-full p-1.5 text-muted-foreground/70 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10 hover:text-foreground focus:opacity-100"
            >
              <MoreVertical className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
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
                void navigator.clipboard
                  .writeText(`${window.location.origin}/search?q=${encodeURIComponent(`${displayTitle} ${artistName}`)}`)
                  .then(() => toast.success("Song link copied"));
              }}
            >
              <ListMusic className="size-4" />
              Copy song link
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
          onClick={(e) => {
            e.stopPropagation();
            likeThis();
          }}
          className={cn(
            "rounded-full p-1.5 transition-colors",
            isLiked
              ? "text-[rgb(var(--tint))]"
              : "text-muted-foreground/70 hover:bg-white/10 hover:text-foreground",
          )}
        >
          <Heart className={cn("size-4", isLiked && "fill-current")} />
        </button>
        <span className="text-sm tabular-nums text-muted-foreground/70">
          {formatTime(item.duration)}
        </span>
      </div>
    </div>
  );
}

