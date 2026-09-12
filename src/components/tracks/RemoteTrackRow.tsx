import type { YtItem } from "@/lib/youtube";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Heart, Loader2, Pause, Play } from "lucide-react";
import { usePlayerStore } from "@/store/player";

export function RemoteTrackRow({
  item,
  index,
  onPlay,
  resolving,
  source = "youtube",
}: {
  item: YtItem;
  index: number;
  onPlay: (item: YtItem) => void;
  resolving?: boolean;
  /** Which provider the chart row came from (affects badge + link-out). */
  source?: "youtube" | "spotify";
}) {
  const currentId = usePlayerStore((s) => s.current?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const isCurrent = currentId === item.id;
  const isLiked = liked[item.id] !== undefined;

  const likeThis = () =>
    toggleLike(item.id, {
      title: item.title,
      artistName: item.artist,
      coverUrl: item.thumbnail,
      duration: item.duration,
      youtubeId: item.id,
      source,
    });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onPlay(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay(item);
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-2 rounded-xl px-3 py-1.5 transition-colors hover:bg-white/[0.05]",
        isCurrent && "bg-white/[0.04]",
      )}
    >
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
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
              aria-label={`Play ${item.title}`}
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

      <div className="flex min-w-0 items-center gap-3">
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
            {item.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {item.artist}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
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
      </div>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
          onClick={(e) => {
            e.stopPropagation();
            likeThis();
          }}
          className={cn(
            "shrink-0 rounded-full p-1.5 transition-colors",
            isLiked
              ? "text-[rgb(var(--tint))]"
              : "text-muted-foreground/70 hover:bg-white/10 hover:text-foreground",
          )}
        >
          <Heart className={cn("size-4", isLiked && "fill-current")} />
        </button>
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground/70">
          {formatTime(item.duration)}
        </span>
      </div>
    </div>
  );
}
