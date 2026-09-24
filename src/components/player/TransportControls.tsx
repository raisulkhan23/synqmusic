import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/store/player";
import { Loader2, Pause, Play, Repeat, Repeat1, RotateCcw, RotateCw, Shuffle, SkipBack, SkipForward } from "lucide-react";
import type { ReactNode } from "react";

function IconButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative touch-manipulation flex size-9 items-center justify-center rounded-full text-foreground/70 transition-[color,background-color,transform,opacity] duration-200 hover:bg-white/[0.07] hover:text-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-35",
        active && "bg-[rgb(var(--tint)_/_0.1)] text-[rgb(var(--tint))] hover:bg-[rgb(var(--tint)_/_0.16)]",
      )}
    >
      {children}
    </button>
  );
}

export function TransportControls({ className, compact = false }: { className?: string; /** Mobile miniplayer mode: play/prev/next only — shuffle & repeat live in the fullscreen player. */ compact?: boolean }) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const repeat = usePlayerStore((s) => s.repeat);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const cycleRepeat = usePlayerStore((s) => s.cycleRepeat);
  const seek = usePlayerStore((s) => s.seek);
  const currentTime = usePlayerStore((s) => s.currentTime);

  return (
    <div
      className={cn(
        "grid items-center justify-items-center",
        compact
          ? "grid-cols-[repeat(3,2.25rem)] gap-1"
          : "grid-cols-[repeat(7,2.25rem)] gap-0.5",
        className,
      )}
    >
      {!compact && (
        <IconButton active={shuffle} onClick={toggleShuffle} label="Shuffle">
          <Shuffle className="size-[18px] stroke-[1.9]" />
        </IconButton>
      )}
      {!compact && (
        <IconButton
          disabled={!current}
          onClick={() => seek(Math.max(0, currentTime - 10))}
          label="Rewind 10 seconds"
        >
          <RotateCcw className="size-[18px] stroke-[1.9]" />
          <span className="absolute text-[7px] font-bold leading-none">10</span>
        </IconButton>
      )}
      <IconButton disabled={!current} onClick={prev} label="Previous">
        <SkipBack className="size-[19px] fill-current stroke-[1.6]" />
      </IconButton>
      <button
        type="button"
        aria-label={isPlaying ? "Pause" : "Play"}
        onClick={togglePlay}
        disabled={!current}
        className={cn(
          "touch-manipulation flex size-10 shrink-0 items-center justify-center self-center rounded-full bg-[rgb(var(--tint))] text-black shadow-[0_5px_22px_rgb(var(--tint)_/_0.2)] ring-1 ring-white/20 transition-[transform,background-color,opacity] duration-200 hover:scale-105 hover:brightness-105 active:scale-90 disabled:pointer-events-none disabled:opacity-35",
          !compact && "col-start-4",
        )}
      >
        {isBuffering && current ? (
          <Loader2 className="size-[18px] animate-spin" />
        ) : isPlaying ? (
          <Pause className="size-[18px] stroke-[2.4]" />
        ) : (
          <Play className="ml-0.5 size-[18px] fill-current stroke-[1.8]" />
        )}
      </button>
      <IconButton disabled={!current} onClick={next} label="Next">
        <SkipForward className="size-[19px] fill-current stroke-[1.6]" />
      </IconButton>
      {!compact && (
        <IconButton
          disabled={!current}
          onClick={() => seek(currentTime + 10)}
          label="Forward 10 seconds"
        >
          <RotateCw className="size-[18px] stroke-[1.9]" />
          <span className="absolute text-[7px] font-bold leading-none">10</span>
        </IconButton>
      )}
      {!compact && (
        <IconButton
          active={repeat !== "off"}
          onClick={cycleRepeat}
          label={repeat === "one" ? "Repeat one" : repeat === "all" ? "Repeat all" : "Repeat off"}
        >
          {repeat === "one" ? (
            <Repeat1 className="size-[18px] stroke-[1.9]" />
          ) : (
            <Repeat className="size-[18px] stroke-[1.9]" />
          )}
        </IconButton>
      )}
    </div>
  );
}