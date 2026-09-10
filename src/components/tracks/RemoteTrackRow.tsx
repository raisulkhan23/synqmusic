import type { YtItem } from "@/lib/youtube";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ExternalLink, Loader2, Pause, Play } from "lucide-react";
import { usePlayerStore } from "@/store/player";

export function RemoteTrackRow({
  item,
  index,
  onPlay,
  resolving,
}: {
  item: YtItem;
  index: number;
  onPlay: (item: YtItem) => void;
  resolving?: boolean;
}) {
  const currentId = usePlayerStore((s) => s.current?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrent = currentId === item.id;

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
        "group grid cursor-pointer grid-cols-[28px_minmax(0,1fr)_auto_52px] items-center gap-3 rounded-xl px-3 py-1.5 transition-colors hover:bg-white/[0.05]",
        isCurrent && "bg-white/[0.04]",
      )}
    >
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
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-sm font-medium",
              isCurrent && "text-[rgb(var(--tint))]",
            )}
          >
            {item.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">{item.artist}</p>
        </div>
      </div>

      <span className="hidden shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase sm:inline-block">
        YouTube
      </span>

      <div className="flex items-center justify-end gap-1">
        <span className="text-sm tabular-nums text-muted-foreground/70">
          {formatTime(item.duration)}
        </span>
        <a
          href={`https://youtu.be/${item.id}`}
          target="_blank"
          rel="noreferrer"
          aria-label="Open on YouTube"
          onClick={(e) => e.stopPropagation()}
          className="hidden rounded-full p-1.5 text-muted-foreground/50 transition-colors hover:bg-white/10 hover:text-foreground sm:block"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </div>
    </div>
  );
}