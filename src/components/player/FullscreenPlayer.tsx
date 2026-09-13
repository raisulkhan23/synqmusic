import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAction } from "convex/react";
import { SeekBar } from "@/components/player/SeekBar";
import { TransportControls } from "@/components/player/TransportControls";
import { VisualizerCanvas } from "@/components/player/VisualizerCanvas";
import { VolumeControl } from "@/components/player/VolumeControl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import { formatTime } from "@/lib/format";
import { dismissVideo, getYtHost, presentVideo } from "@/lib/youtubePlayer";
import { toPlayableYoutube } from "@/lib/playable";
import { type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { toast } from "sonner";
import {
  ChevronDown,
  Film,
  Gauge,
  Heart,
  ListMusic,
  Loader2,
  MicVocal,
  Repeat,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * YouTube titles/channel names don't match lyrics databases directly — strip
 * the noise ("(Official Video)", "- Topic", "VEVO", ...) before lookup.
 */
function cleanLyricsQuery(raw: string): string {
  return raw
    .replace(/\s*[-–]\s*(Topic|VEVO|Official)\s*$/i, "")
    .replace(/\s*\([^)]*(official|video|audio|lyrics|hd|hq|mv|visualizer|remaster|lyric)[^)]*\)/gi, "")
    .replace(/\s*\[[^\]]*(official|video|audio|lyrics|hd|hq|mv|visualizer|remaster|lyric)[^\]]*\]/gi, "")
    .replace(/\s*【[^】]*】/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------

/** Synced-lyrics panel with auto-scroll + click-to-seek. */
function LyricsPanel({ onClose }: { onClose: () => void }) {
  const current = usePlayerStore((s) => s.current);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const fetchLyrics = useAction(api.lyrics.fetchLyrics);
  const [lines, setLines] = useState<{ t: number; text: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const key = current
    ? `${current.title}|${current.artistName}|${current.albumName}`
    : "";

  // Reset dirty state whenever the tracked key changes — purely derived from
  // React dependencies, so it's safe to keep this sequence out of the fetch
  // effect (avoids set-state-inside-effect warnings).
  useEffect(() => {
    if (!key) return;
    setLines(null);
    setLoading(true);
  }, [key]);

  // Fetch lyrics for the tracked track. Re-runs whenever key or the action
  // changes; cancellations and result overwrites are handled below.
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    fetchLyrics({
      title: cleanLyricsQuery(current.title),
      artist: cleanLyricsQuery(current.artistName),
      album: current.albumName ? cleanLyricsQuery(current.albumName) : undefined,
      duration: current.duration,
    })
      .then((res) => {
        if (!cancelled) setLines(res?.lines ?? null);
      })
      .catch(() => {
        if (!cancelled) setLines(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchLyrics]);

  // current line index (last line whose t <= currentTime)
  const activeIndex = useMemo(() => {
    if (!lines) return -1;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].t <= currentTime + 0.2) idx = i;
      else break;
    }
    return idx;
  }, [lines, currentTime]);

  // auto-scroll active line into view
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>("[data-active='true']");
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex]);

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22 }}
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-white/[0.07] bg-[#0b0c11]/95 backdrop-blur-xl"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
        <p className="flex items-center gap-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          <MicVocal className="size-4" />
          Lyrics
        </p>
        <button
          type="button"
          aria-label="Close lyrics"
          onClick={onClose}
          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : lines === null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MicVocal className="size-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No synced lyrics found for this track.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <button
                key={`${line.t}-${i}`}
                type="button"
                data-active={i === activeIndex}
                onClick={() => seek(line.t)}
                className={cn(
                  "text-left text-lg leading-snug font-semibold transition-all duration-300",
                  i === activeIndex
                    ? "scale-[1.02] text-[rgb(var(--tint))]"
                    : "text-muted-foreground/50 hover:text-foreground",
                )}
              >
                {line.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

/** A-B repeat loop controls. */
function AbRepeatControls() {
  const abA = usePlayerStore((s) => s.abA);
  const abB = usePlayerStore((s) => s.abB);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const setAbPoint = usePlayerStore((s) => s.setAbPoint);
  const clearAb = usePlayerStore((s) => s.clearAb);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1",
        (abA !== null || abB !== null) && "border-[rgb(var(--tint)_/_0.5)]",
      )}
    >
      <span className="flex items-center gap-1 pl-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Repeat className="size-3.5" />
        A-B
      </span>
      <button
        type="button"
        title="Set point A at current position"
        onClick={() => {
          setAbPoint("a", currentTime);
          toast.success(`A set at ${formatTime(currentTime)}`);
        }}
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
          abA !== null
            ? "bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
            : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
        )}
      >
        {abA !== null ? formatTime(abA) : "A"}
      </button>
      <button
        type="button"
        title="Set point B at current position"
        onClick={() => {
          setAbPoint("b", currentTime);
          toast.success(`B set at ${formatTime(currentTime)}`);
        }}
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
          abB !== null
            ? "bg-[rgb(var(--tint)_/_0.2)] text-[rgb(var(--tint))]"
            : "text-muted-foreground hover:bg-white/[0.08] hover:text-foreground",
        )}
      >
        {abB !== null ? formatTime(abB) : "B"}
      </button>
      {(abA !== null || abB !== null) && (
        <button
          type="button"
          title="Clear A-B loop"
          onClick={() => {
            clearAb();
            toast("A-B loop cleared");
          }}
          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function FullscreenPlayer() {
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const current = usePlayerStore((s) => s.current);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const liked = usePlayerStore((s) => s.liked);
  const toggleLike = usePlayerStore((s) => s.toggleLike);
  const accent = usePlayerStore((s) => s.accent);
  const setFullscreen = usePlayerStore((s) => s.setFullscreen);
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const rate = usePlayerStore((s) => s.rate);
  const setRate = usePlayerStore((s) => s.setRate);

  const a = accent ?? { r: 196, g: 246, b: 152 };

  const [lyricsOpen, setLyricsOpen] = useState(false);
  const videoEnabled = usePlayerStore((s) => s.videoEnabled);
  const toggleVideo = usePlayerStore((s) => s.toggleVideo);
  const searchYt = useAction(api.youtube.searchYoutube);

  // A video frame is shown for YouTube tracks directly; catalog tracks get a
  // matching YouTube video found on demand when video mode is on.
  const isYoutube = current?.source === "youtube" || !!current?.youtubeId;
  const [catalogVideo, setCatalogVideo] = useState<YtItem | null>(null);
  const [catalogVideoPending, setCatalogVideoPending] = useState(false);

  useEffect(() => {
    setCatalogVideo(null);
    setCatalogVideoPending(false);
    if (!current || current.catalogTrack === undefined) return;
    if (!videoEnabled || !fullscreen) return;
    let cancelled = false;
    setCatalogVideoPending(true);
    searchYt({ query: `${current.title} ${current.artistName} official audio` })
      .then(({ items }) => {
        if (cancelled) return;
        const best = items[0] ?? null;
        setCatalogVideo(best);
        // When the user turns video ON for a catalog track, seamlessly swap
        // the stream to the matched YouTube video at the current position.
        if (best && fullscreen && current.catalogTrack) {
          replaceCurrentStream(
            toPlayableYoutube(
              {
                id: current.id,
                title: current.title,
                artist: current.artistName,
                duration: current.duration || best.duration,
                thumbnail: current.coverUrl || best.thumbnail,
              },
              `https://youtu.be/${best.id}`,
              items.slice(1),
            ),
            currentTimeRef.current,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setCatalogVideo(null);
      })
      .finally(() => {
        if (!cancelled) setCatalogVideoPending(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, videoEnabled, fullscreen]);

  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const replaceCurrentStream = usePlayerStore((s) => s.replaceCurrentStream);
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;

  // Move the live YouTube player element into the video frame. The engine
  // owns one player instance — present/dismiss never reloads the video.
  // presentation retries until the engine is ready (YT API can still be
  // loading when the fullscreen opens).
  useEffect(() => {
    if (!fullscreen || !current || !videoEnabled) return;
    if (!isYoutube && !catalogVideo) return;
    setVideoReady(false);
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const attempt = () => {
      const frame = videoFrameRef.current;
      if (!frame) return; // unmounted — stop
      const ok = presentVideo(frame);
      if (ok) {
        setVideoReady(true);
        return;
      }
      if (++tries < 20) timer = setTimeout(attempt, 250); // ~5s
    };
    // wait for the enter animation before presenting
    timer = setTimeout(attempt, 350);
    return () => {
      clearTimeout(timer);
      setVideoReady(false);
      dismissVideo();
    };
  }, [fullscreen, current?.id, videoEnabled, isYoutube, catalogVideo]);

  // Re-present when the lyrics panel toggles (frame may remount).
  useEffect(() => {
    if (!fullscreen || !videoReady) return;
    if (videoFrameRef.current && !videoFrameRef.current.contains(getYtHost())) {
      presentVideo(videoFrameRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricsOpen]);

  if (!fullscreen || !current) return <AnimatePresence />;

  return (
    <AnimatePresence>
      <motion.div
        key="fullscreen-player"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        className="fixed inset-0 z-[70] overflow-hidden bg-[#090a0f]"
      >
        {/* ambient accent glows */}
        <div
          className="glow-pulse pointer-events-none absolute -top-48 left-1/2 h-[520px] w-[780px] -translate-x-1/2 rounded-full blur-3xl"
          style={{
            background: `radial-gradient(closest-side, rgb(${a.r} ${a.g} ${a.b} / 0.2), transparent)`,
          }}
        />
        <div
          className="pointer-events-none absolute -bottom-56 -left-32 size-[560px] rounded-full blur-3xl"
          style={{
            background: `radial-gradient(closest-side, rgb(${a.r} ${a.g} ${a.b} / 0.12), transparent)`,
          }}
        />

        <VisualizerCanvas className="absolute inset-x-0 bottom-0 h-[44vh] w-full opacity-70" />

        <div className="relative z-10 flex h-full flex-col px-5 pt-4 pb-5 sm:px-10">
          {/* top row */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Exit full-screen player"
              onClick={() => setFullscreen(false)}
              className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <ChevronDown className="size-5" />
              <span className="hidden sm:inline">Minimize</span>
            </button>
            <div className="hidden text-center sm:block">
              <p className="font-display text-sm font-semibold tracking-tight">
                {current.albumName}
              </p>
              <p className="text-xs text-muted-foreground">
                {current.source === "catalog" ? "SoundCore catalog" : "Streamed from YouTube"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={liked[current.id] ? "Remove from liked songs" : "Add to liked songs"}
                onClick={() => toggleLike(current.id)}
                className={cn(
                  "rounded-full p-2.5 transition-all hover:scale-110",
                  liked[current.id]
                    ? "text-[rgb(var(--tint))]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Heart className={cn("size-5", liked[current.id] && "fill-current")} />
              </button>
              <button
                type="button"
                aria-label="Open queue"
                onClick={() => {
                  setFullscreen(false);
                  setQueueOpen(true);
                }}
                className="rounded-full p-2.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <ListMusic className="size-5" />
              </button>
            </div>
          </div>

          {/* artwork / live video */}
          <div
            className={cn(
              "flex flex-1 items-center justify-center py-6",
              lyricsOpen && "hidden lg:flex", // lyrics overlay covers on small screens
            )}
          >
            {isYoutube || (videoEnabled && catalogVideo) ? (
              <div
                ref={videoFrameRef}
                className="fade-rise relative aspect-video w-[min(72vh,640px)] max-w-full overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
              >
                {/* Shield: absorbs clicks so YouTube's in-frame UI (title bar,
                    watch-later, share, end-screen links) can't be triggered. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-[1]"
                  style={{ pointerEvents: "auto", background: "transparent" }}
                />
                {/* cover art until the live iframe lands on top of it */}
                <img
                  src={current.coverUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
                <AnimatePresence>
                  {!videoReady && (
                    <motion.div
                      initial={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="absolute inset-0 flex items-center justify-center bg-black/60"
                    >
                      <Loader2 className="size-7 animate-spin text-white/70" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <motion.img
                src={current.coverUrl}
                alt={`${current.title} cover art`}
                className="size-[min(38vh,340px)] rounded-2xl object-cover shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
                animate={{ y: [0, -12, 0] }}
                transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </div>

          {/* metadata + controls */}
          <div
            className={cn(
              "mx-auto flex w-full max-w-2xl flex-col items-center gap-3",
              lyricsOpen && "opacity-0 lg:opacity-100",
            )}
          >
            <div className="w-full text-center">
              <h2 className="truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
                {current.title}
              </h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {current.artistName} · {current.albumName}
              </p>
            </div>

            <div className="flex w-full items-center gap-2">
              <span className="w-11 shrink-0 text-right text-[11px] font-medium tabular-nums text-muted-foreground">
                {formatTime(currentTime)}
              </span>
              <SeekBar className="min-w-0 flex-1" />
              <span className="w-11 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                {formatTime(duration || current.duration)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <TransportControls />
              <div className="mx-3 h-5 w-px bg-white/10" />
              <VolumeControl />
            </div>

            {/* extra playback tools */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <AbRepeatControls />

              {/* speed */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Playback speed"
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors hover:bg-white/[0.08]",
                      rate !== 1
                        ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                        : "text-muted-foreground",
                    )}
                  >
                    <Gauge className="size-3.5" />
                    {rate}×
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Playback speed
                  </DropdownMenuLabel>
                  {RATES.map((r) => (
                    <DropdownMenuItem
                      key={r}
                      className={cn("gap-2", r === rate && "text-[rgb(var(--tint))]")}
                      onSelect={() => setRate(r)}
                    >
                      {r === 1 ? "Normal (1×)" : `${r}×`}
                      {r === rate && <span className="ml-auto">●</span>}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* video toggle */}
              <button
                type="button"
                title="Toggle video in fullscreen player"
                onClick={toggleVideo}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors hover:bg-white/[0.08]",
                  videoEnabled
                    ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                    : "text-muted-foreground",
                )}
              >
                <Film className="size-3.5" />
                Video {videoEnabled ? "on" : "off"}
              </button>

              {/* lyrics toggle */}
              <button
                type="button"
                title="Lyrics"
                onClick={() => setLyricsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold tracking-wide uppercase transition-colors hover:bg-white/[0.08]",
                  lyricsOpen
                    ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                    : "text-muted-foreground",
                )}
              >
                <MicVocal className="size-3.5" />
                Lyrics
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {lyricsOpen && <LyricsPanel onClose={() => setLyricsOpen(false)} />}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}
