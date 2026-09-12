import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { SeekBar } from "@/components/player/SeekBar";
import { TransportControls } from "@/components/player/TransportControls";
import { VolumeControl } from "@/components/player/VolumeControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { albumById } from "@/lib/catalog";
import { accentFromString, coverArt, dominantColor } from "@/lib/covers";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { usePlayerStore } from "@/store/player";
import {
  Heart,
  ListMusic,
  Loader2,
  Maximize2,
  Moon,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const SLEEP_OPTIONS: { label: string; value: number | "end" }[] = [
  { label: "5 minutes", value: 5 },
  { label: "10 minutes", value: 10 },
  { label: "15 minutes", value: 15 },
  { label: "30 minutes", value: 30 },
  { label: "60 minutes", value: 60 },
  { label: "After current song", value: "end" },
];

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function SleepTimerButton() {
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const [now, setNow] = useState(() => Date.now());

  const active = sleepEndsAt !== null || sleepAtSongEnd;

  // tick the countdown
  useEffect(() => {
    if (sleepEndsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [sleepEndsAt]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Sleep timer"
          title="Sleep timer"
          className={cn(
            "relative hidden rounded-full p-2 transition-colors hover:bg-white/[0.06] sm:block",
            active ? "text-[rgb(var(--tint))]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Moon className="size-4" />
          {active && (
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-[rgb(var(--tint))]" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {sleepEndsAt !== null
            ? `Pauses in ${formatRemaining(sleepEndsAt - now)}`
            : sleepAtSongEnd
              ? "Stops after this song"
              : "Sleep timer"}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SLEEP_OPTIONS.map(({ label, value }) => (
          <DropdownMenuItem
            key={label}
            className="gap-2"
            onSelect={() => {
              setSleepTimer(value);
              toast.success(
                value === "end" ? "Will stop after this song" : `Sleep timer: ${label}`,
              );
            }}
          >
            {label}
          </DropdownMenuItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 text-destructive"
              onSelect={() => {
                setSleepTimer(null);
                toast("Sleep timer cancelled");
              }}
            >
              Cancel timer
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlayerBar() {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const setFullscreen = usePlayerStore((s) => s.setFullscreen);
  const setAccent = usePlayerStore((s) => s.setAccent);
  const errorNonce = usePlayerStore((s) => s.errorNonce);
  const replaceCurrentStream = usePlayerStore((s) => s.replaceCurrentStream);

  // Sample the current artwork and tint the whole app with its dominant color.
  // Remote (YouTube) art can't be sampled cross-origin, so derive a stable,
  // pleasant accent from the track instead.
  useEffect(() => {
    if (!current) {
      setAccent(null);
      return;
    }
    let cancelled = false;

    if (current.source === "catalog" && current.catalogTrack) {
      const album = albumById(current.catalogTrack.albumId);
      setAccent(album.accent);
      void dominantColor(coverArt(album)).then((c) => {
        if (!cancelled && c) setAccent(c);
      });
    } else {
      setAccent(accentFromString(`${current.title} ${current.artistName}`));
    }

    return () => {
      cancelled = true;
    };
  }, [current?.id, current?.source, current?.title, current?.artistName, setAccent]);

  // Auto-fallback: if a YouTube video can't play (embed disabled, removed,
  // etc.), automatically try the next search result. Manual switching is also
  // available in the queue panel.
  const attempts = useRef(0);
  const lastErrorTrack = useRef<string | null>(null);

  useEffect(() => {
    if (errorNonce === 0) return;
    const s = usePlayerStore.getState();
    const track = s.current;
    if (!track || track.source !== "youtube") return;

    if (lastErrorTrack.current !== track.id) {
      lastErrorTrack.current = track.id;
      attempts.current = 0;
    }
    const alternatives = track.alternatives ?? [];
    if (attempts.current >= alternatives.length) {
      toast.error("No more sources available for this track");
      return;
    }
    const next = alternatives[attempts.current];
    attempts.current += 1;

    toast.loading(`Trying another source for "${track.title}"…`, { id: "yt-fallback" });
    // The IFrame engine plays by video id — just swap the current track.
    replaceCurrentStream(toPlayableYoutube(next, next.id, alternatives));
    toast.success("Switched to an alternative source", { id: "yt-fallback" });
  }, [errorNonce, replaceCurrentStream]);

  if (!current) return null;

  const isLiked = liked[current.id] !== undefined;
  const catalogTrack = current.source === "catalog" ? current.catalogTrack : undefined;

  return (
    <footer className="liquid-glass z-30 flex h-[76px] shrink-0 items-center gap-3 border-t border-white/[0.07] px-3 sm:px-4">
      {/* now playing */}
      <div className="flex min-w-0 w-[26%] items-center gap-3 sm:w-[30%]">
        <div className="relative size-12 shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-white/10">
          <img src={current.coverUrl} alt="" className="size-full object-cover" />
          {isBuffering && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <Loader2 className="size-4 animate-spin text-white" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-semibold",
              isPlaying && "text-[rgb(var(--tint))]",
            )}
          >
            {current.title}
          </p>
          {catalogTrack ? (
            <Link
              to={`/album/${catalogTrack.albumId}`}
              className="block truncate text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
            >
              {current.artistName}
            </Link>
          ) : (
            <p className="block truncate text-xs text-muted-foreground">
              {current.artistName}
            </p>
          )}
        </div>
        {current.source === "youtube" && (
          <button
            type="button"
            aria-label="Try another source"
            title="Try another source"
            onClick={() => {
              const s = usePlayerStore.getState();
              if (s.current) {
                usePlayerStore.setState({ errorNonce: s.errorNonce + 1 });
              }
            }}
            className="hidden shrink-0 rounded-full p-1.5 text-muted-foreground/70 transition-colors hover:bg-white/[0.06] hover:text-foreground sm:block"
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
          onClick={() => toggleLike(current.id)}
          className={cn(
            "shrink-0 rounded-full p-1.5 transition-all hover:scale-110",
            isLiked ? "text-[rgb(var(--tint))]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart className={cn("size-4", isLiked && "fill-current")} />
        </button>
      </div>

      {/* transport + seek */}
      <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
        <TransportControls />
        <div className="flex w-full max-w-xl items-center gap-2">
          <span className="w-11 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
            {formatTime(currentTime)}
          </span>
          <SeekBar className="min-w-0 flex-1" />
          <span className="w-11 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {formatTime(duration || current.duration)}
          </span>
        </div>
      </div>

      {/* right cluster */}
      <div className="flex w-[26%] items-center justify-end gap-0.5 sm:w-[30%]">
        <SleepTimerButton />
        <button
          type="button"
          aria-label="Open queue"
          onClick={() => setQueueOpen(!queueOpen)}
          className={cn(
            "rounded-full p-2 transition-colors hover:bg-white/[0.06]",
            queueOpen ? "text-[rgb(var(--tint))]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ListMusic className="size-4" />
        </button>
        <VolumeControl className="hidden md:flex" />
        <button
          type="button"
          aria-label="Open full-screen player"
          onClick={() => setFullscreen(true)}
          className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </footer>
  );
}