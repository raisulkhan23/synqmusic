import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SeekBar } from "@/components/player/SeekBar";
import { TransportControls } from "@/components/player/TransportControls";
import { VolumeControl } from "@/components/player/VolumeControl";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function PlayerBar({ compact = false }: { compact?: boolean }) {
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const liked = usePlayerStore((s) => s.liked);
  // Animated like heart — declared with the other hooks so the hook order
  // never changes (it used to live after an early return, which broke React's
  // rules of hooks and could crash the player bar).
  const [likePulse, setLikePulse] = useState(false);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const queueOpen = usePlayerStore((s) => s.queueOpen);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const setFullscreen = usePlayerStore((s) => s.setFullscreen);
  const setAccent = usePlayerStore((s) => s.setAccent);
  const errorNonce = usePlayerStore((s) => s.errorNonce);
  const replaceCurrentStream = usePlayerStore((s) => s.replaceCurrentStream);
  const playViaStream = usePlayerStore((s) => s.playViaStream);
  const searchSameSong = useAction(api.youtube.searchYoutube);

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
  const rescueExhausted = useRef(false);
  const lastErrorTrack = useRef<string | null>(null);

  useEffect(() => {
    if (errorNonce === 0) return;
    const s = usePlayerStore.getState();
    const track = s.current;
    if (!track || track.source !== "youtube") return;

    if (lastErrorTrack.current !== track.id) {
      lastErrorTrack.current = track.id;
      attempts.current = 0;
      rescueExhausted.current = false;
    }
    const alternatives = track.alternatives ?? [];
    // NOTE: don't bail out just because `alternatives` is empty — the rescue
    // (stream) and re-search paths below don't need alternatives. Only give
    // up once we've already exhausted both rescue attempts AND alternatives.
    if (attempts.current >= alternatives.length && track.audioUrl && attempts.current > 0 && rescueExhausted.current) {
      toast.error("No more sources available for this track");
      return;
    }
    // First failure for this track: try to rescue the SAME song through the
    // resolved direct stream (the proxy path) — this covers videos that are
    // embed-restricted or region-blocked in the iframe but still streamable.
    if (!track.audioUrl) {
      rescueExhausted.current = true;
      toast.loading(`Finding a way to play "${track.title}"…`, { id: "yt-fallback" });
      playViaStream(track);
      return;
    }

    // Stream also failed (e.g. YouTube's bot-check blocked this upload).
    // Before abandoning the song, re-search for the SAME song title and try a
    // different upload of it. Only when every upload fails do we give up.
    if (attempts.current === 0) {
      attempts.current = 1;
      toast.loading(`Looking for another upload of "${track.title}"…`, { id: "yt-fallback" });
      const artist = track.artistName.split(",")[0]?.trim() ?? "";
      void searchSameSong({ query: `${track.title} ${artist}`.trim() })
        .then(({ items }) => {
          const candidate = items.find(
            (it) =>
              it.id !== track.id &&
              it.id !== track.youtubeId &&
              !(track.alternatives ?? []).some((a) => a.id === it.id) &&
              (it.duration === 0 || (it.duration >= 30 && it.duration <= 900)),
          );
          if (!candidate) {
            toast.error(`"${track.title}" couldn't be played`, { id: "yt-fallback" });
            return;
          }
          replaceCurrentStream(
            toPlayableYoutube(candidate, candidate.id, items.filter((i) => i.id !== candidate.id)),
          );
          toast.success(`Playing "${track.title}"`, { id: "yt-fallback" });
        })
        .catch(() => toast.error("Playback failed — try another song", { id: "yt-fallback" }));
      return;
    }

    const next = alternatives[attempts.current - 1];
    if (!next) {
      toast.error(`"${track.title}" couldn't be played`, { id: "yt-fallback" });
      return;
    }
    attempts.current += 1;
    toast.loading(`Finding another way to play "${track.title}"…`, { id: "yt-fallback" });
    // The IFrame engine plays by video id — just swap the current track.
    replaceCurrentStream(toPlayableYoutube(next, next.id, alternatives));
    toast.success("Playing a matching version", { id: "yt-fallback" });
  }, [errorNonce, replaceCurrentStream, playViaStream, searchSameSong]);

  if (!current) return null;

  const isLiked = liked[current.id] !== undefined;
  const catalogTrack = current.source === "catalog" ? current.catalogTrack : undefined;

  return (
    <footer
      className={cn(
        "liquid-glass z-30 flex shrink-0 items-center gap-3 border-t border-white/[0.07] px-3 sm:px-4",
        compact ? "h-[60px]" : "h-[76px]",
      )}
    >
      {/* now playing */}
      <div className="flex min-w-0 w-[40%] items-center gap-2 sm:w-[30%] sm:gap-3">
        <div className="relative size-10 shrink-0 overflow-hidden rounded-md shadow-lg ring-1 ring-white/10 sm:size-12">
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
            <span className="block truncate text-xs text-muted-foreground">
              {current.artistName}
            </span>
          ) : (
            <p className="block truncate text-xs text-muted-foreground">
              {current.artistName}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={isLiked ? "Remove from liked songs" : "Add to liked songs"}
          onClick={() => {
            toggleLike(current.id);
            setLikePulse(true);
            setTimeout(() => setLikePulse(false), 400);
          }}
          className={cn(
            "shrink-0 rounded-full p-1.5 transition-all hover:scale-110",
            isLiked ? "text-[rgb(var(--tint))]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart
            className={cn(
              "size-4 transition-transform duration-300",
              isLiked && "fill-current scale-110",
              likePulse && "animate-ping-once",
            )}
          />
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
      <div className="flex w-auto items-center justify-end gap-0.5 sm:w-[30%]">
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