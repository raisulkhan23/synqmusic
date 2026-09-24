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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/convex/_generated/api";
import { formatTime } from "@/lib/format";
import { dismissVideo, ensureVideoPlaying, getLoadedVideoId, presentOverlay, trackFrame } from "@/lib/youtubePlayer";
import { AUDIO_FILTERS as FILTER_DEFS } from "@/lib/audio";
import { usePlayerStore } from "@/store/player";
import { toast } from "sonner";
import {
  ChevronDown,
  Film,
  Gauge,
  Heart,
  ListMusic,
  Share2,
  Loader2,
  MicVocal,
  Moon,
  Repeat,
  X,
  Waves,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    <DropdownMenu modal={false}>
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when a new track loads
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
      className="fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col border-l border-white/[0.07] bg-[#0b0c11]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
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
  const audioFilter = usePlayerStore((s) => s.audioFilter);
  const setAudioFilter = usePlayerStore((s) => s.setAudioFilter);

  const a = accent ?? { r: 196, g: 246, b: 152 };

  const [lyricsOpen, setLyricsOpen] = useState(false);
  const videoEnabled = usePlayerStore((s) => s.videoEnabled);
  const toggleVideo = usePlayerStore((s) => s.toggleVideo);

  // True when the current track plays through the YouTube IFrame engine.
  const isYoutube = current?.source === "youtube" || !!current?.youtubeId;

  // The video frame is shown ONLY for tracks that already play through the
  // YouTube engine. The toggle never swaps the audio stream — turning it off
  // just parks the iframe off-screen (audio keeps playing); turning it on
  // re-presents the same live player. Catalog tracks keep their artwork.

  const videoFrameRef = useRef<HTMLDivElement | null>(null);
  /** Mirror of videoReady for the retry loop (state updates are async). */
  const videoReadyRef = useRef(false);
  /** Latest playback position, read inside the async retry loop. */
  const currentTimeRef = useRef(0);
  // Mirror the live position so the async video-retry loop can seek without
  // re-subscribing (and without stale-closure positions).
  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  const [videoReady, setVideoReady] = useState(false);
  /** Set when the overlaid live player can't present — we fall back to an inline iframe. */
  const [embedFallback, setEmbedFallback] = useState(false);

  // Overlay the live YouTube player over the video frame whenever fullscreen
  // + video is on and the current track plays through the YouTube engine.
  // The player element is NEVER moved in the DOM (that would reload the
  // iframe and kill playback) — it's fixed-positioned over the frame instead.
  useEffect(() => {
    if (!fullscreen || !current || !videoEnabled) return;
    if (!isYoutube) return;
    // NOTE: no early return when an audio effect is active — the store runs
    // the engine as a MUTED VISUAL SLAVE in that case (sound comes from the
    // filtered <audio> element, video from the engine). The engine still has
    // the video loaded, so the overlay can present normally. Skipping the
    // overlay here used to leave the video frame showing only the thumbnail.
    videoReadyRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset overlay state when re-presenting
    setVideoReady(false);
    setEmbedFallback(false);
    let stopTracking: (() => void) | null = null;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Guards every async continuation: the video retry kicks off a promise
    // AND schedules the next timer, so without this flag both can fire AFTER
    // cleanup and re-present the fixed-position player overlay
    // (pointer-events:auto, z-71) over the whole UI — which is exactly what
    // made the mouse "bug" whenever an effect was toggled.
    let stopped = false;
    const attempt = () => {
      if (stopped) return;
      // Don't just WAIT for the video — actively make the engine play it.
      // It is frequently loaded on a different video, or loaded but paused,
      // which is exactly what produced a frozen thumbnail. We drive it until
      // it reports PLAYING (or we run out of attempts and fall back).
      if (getLoadedVideoId() !== current.youtubeId || !videoReadyRef.current) {
        if (++tries < 30) {
          void ensureVideoPlaying(current.youtubeId!, currentTimeRef.current, audioFilter !== "off")
            .then((playing) => {
              if (stopped) return;
              if (playing) {
                videoReadyRef.current = true;
                setVideoReady(true);
              }
            })
            .catch(() => undefined);
          if (!stopped) timer = setTimeout(attempt, 350);
          return;
        }
        setEmbedFallback(true);
        return;
      }
      const frame = videoFrameRef.current;
      if (!frame || !frame.isConnected) {
        // Frame not mounted yet — retry briefly while the overlay opens.
        if (++tries < 40) timer = setTimeout(attempt, 100);
        return;
      }
      if (presentOverlay(frame)) {
        setVideoReady(true);
        stopTracking = trackFrame(frame); // follow resizes every frame
        return;
      }
      if (++tries < 40) timer = setTimeout(attempt, 100); // ~4s
      else setEmbedFallback(true); // overlaid live player failed — show an inline embed instead
    };
    // Longer warm-up when an effect is active: the muted video slave has to
    // load through the engine before the overlay can present it.
    timer = setTimeout(attempt, audioFilter !== "off" ? 900 : 250);
    return () => {
      stopped = true;
      clearTimeout(timer);
      stopTracking?.();
      setVideoReady(false);
      // Park the player off-screen AND make it click-through immediately, so
      // no invisible overlay can ever swallow clicks again.
      dismissVideo();
    };
  }, [fullscreen, current?.id, videoEnabled, isYoutube, audioFilter]);

  // Re-sync the overlay when the lyrics panel toggles (frame may move).
  useEffect(() => {
    if (!fullscreen || !videoReady) return;
    const frame = videoFrameRef.current;
    if (frame) presentOverlay(frame);
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

        <div className="relative z-10 flex h-full flex-col px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-10 sm:pt-4 sm:pb-5">
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
              {current.albumName && (
                <p className="font-display text-sm font-semibold tracking-tight">
                  {current.albumName}
                </p>
              )}
              <p className="text-xs text-muted-foreground">Live session</p>
            </div>
            <div className="flex items-center gap-1">
              <SleepTimerButton />
              <button
                type="button"
                aria-label={liked[current.id] ? "Remove from liked songs" : "Add to liked songs"}
                onClick={() => toggleLike(current.id)}
                className="rounded-full p-2 transition-all hover:scale-110 sm:hidden"
              >
                <Heart className={cn("size-5", liked[current.id] && "fill-current", liked[current.id] ? "text-[rgb(var(--tint))]" : "text-muted-foreground")} />
              </button>
              <button
                type="button"
                aria-label={liked[current.id] ? "Remove from liked songs" : "Add to liked songs"}
                onClick={() => toggleLike(current.id)}
                className={cn(
                  "hidden rounded-full p-2.5 transition-all hover:scale-110 sm:block",
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
                  setQueueOpen(true);
                }}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground sm:p-2.5"
              >
                <ListMusic className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Share current song"
                onClick={() => {
                  if (!current) return;
                  const url = `${window.location.origin}/search?q=${encodeURIComponent(
                    `${current.title} ${current.artistName.split(",")[0]?.trim() ?? ""}`.trim(),
                  )}`;
                  const data = {
                    title: `${current.title} — ${current.artistName}`,
                    text: `Listen to ${current.title} on SYNQ`,
                    url,
                  };
                  if (navigator.share) {
                    void navigator.share(data).catch(() => undefined);
                  } else {
                    void navigator.clipboard.writeText(url).then(() => toast.success("Song link copied"));
                  }
                }}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground sm:p-2.5"
              >
                <Share2 className="size-5" />
              </button>
            </div>
          </div>

          {/* artwork / live video — slides to the left when the lyrics panel
              is open (desktop) so the lyrics never cover the video */}
          <div
            className={cn(
              "flex min-h-0 flex-1 items-center justify-center py-3 transition-all duration-300 sm:py-6",
              lyricsOpen && "hidden lg:flex", // lyrics overlay covers on small screens
              // Lyrics panel is 28rem wide — reserve exactly that so the
              // video stays centered in the remaining space (a touch right
              // of center overall, aligned with the title below).
              lyricsOpen && "lg:pr-[28rem]",
            )}
          >
            {isYoutube && videoEnabled ? (
              <div
                ref={videoFrameRef}
                className="fade-rise relative aspect-video w-[min(72vh,640px)] max-w-full overflow-hidden rounded-2xl bg-black shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/10 transition-all duration-300"
                style={lyricsOpen ? { width: "min(48vh, 480px)" } : undefined}
              >
                {/* Shield: absorbs clicks so YouTube's in-frame UI (title bar,
                    watch-later, share, end-screen links) can't be triggered. */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0 z-[1]"
                  style={{ pointerEvents: "auto", background: "transparent" }}
                />
                {/* cover art behind the overlaid live player */}
                <img
                  src={current.coverUrl}
                  alt=""
                  className={cn("absolute inset-0 size-full object-cover", embedFallback && "opacity-0")}
                />
                {embedFallback && current.youtubeId && (
                  <iframe
                    key={current.youtubeId}
                    title={`${current.title} video`}
                    // Muted autoplay is allowed by browser policy; unmuted
                    // autoplay=0 meant the embedded video loaded but NEVER
                    // started — the frame looked dead. Audio still comes from
                    // the app's own engine, so a muted picture is correct.
                    src={`https://www.youtube.com/embed/${current.youtubeId}?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&start=${Math.floor(currentTime)}`}
                    allow="accelerometer; encrypted-media; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="absolute inset-0 size-full border-0"
                  />
                )}
                {/* Effect-active badge: in slave mode the iframe is parked, so
                    make it obvious the video is still "on" with sound processed. */}
                {audioFilter !== "off" && (
                  <span className="absolute top-3 left-3 z-[2] flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--tint))] backdrop-blur">
                    <Waves className="size-3.5" />
                    {FILTER_DEFS.find((f) => f.id === audioFilter)?.label}
                  </span>
                )}
                <AnimatePresence>
                  {!videoReady && audioFilter === "off" && (
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

          {/* metadata + controls — slide left alongside the video when the
              lyrics panel is open on desktop */}
          <div
            className={cn(
              "flex w-full flex-col items-center gap-3 transition-all duration-300",
              // Match the video's reserved space so title/controls center on it.
              lyricsOpen ? "lg:pr-[28rem]" : "mx-auto max-w-2xl",
              lyricsOpen && "opacity-0 lg:opacity-100", // lyrics overlay covers on small screens
            )}
          >
            <div className="w-full text-center">
              <h2 className="truncate font-display text-lg font-bold tracking-tight sm:text-2xl lg:text-3xl">
                {current.title}
              </h2>
              <p className="mt-0.5 truncate text-xs text-muted-foreground sm:mt-1 sm:text-sm">
                {current.albumName ? `${current.artistName} · ${current.albumName}` : current.artistName}
              </p>
            </div>

            <div className="flex w-full items-center gap-2">
              <span className="w-9 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground sm:w-11 sm:text-[11px]">
                {formatTime(currentTime)}
              </span>
              <SeekBar className="min-w-0 flex-1" />
              <span className="w-9 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground sm:w-11 sm:text-[11px]">
                {formatTime(duration || current.duration)}
              </span>
            </div>

            <div className="flex items-center gap-1 sm:gap-2">
              <TransportControls />
              <div className="mx-1 hidden h-5 w-px bg-white/10 sm:mx-3 sm:block" />
              <VolumeControl className="hidden sm:flex" />
              <div className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
              {/* like + queue, right beside the transport controls */}
              <button
                type="button"
                aria-label={liked[current.id] ? "Remove from liked songs" : "Add to liked songs"}
                title={liked[current.id] ? "Unlike" : "Like"}
                onClick={() => toggleLike(current.id)}
                className={cn(
                  "hidden rounded-full p-2 transition-all hover:scale-110 sm:block",
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
                title="Queue"
                onClick={() => {
                  setQueueOpen(true);
                }}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
              >
                <ListMusic className="size-5" />
              </button>
            </div>

            {/* extra playback tools */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <AbRepeatControls />

              {/* speed — icon only until a non-1× speed is active */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={rate !== 1 ? `Playback speed ${rate}×` : "Playback speed"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold tabular-nums transition-colors hover:bg-white/[0.08]",
                      rate !== 1
                        ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                        : "text-muted-foreground",
                    )}
                  >
                    <Gauge className="size-4" />
                    {rate !== 1 && `${rate}×`}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="z-[80]">
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

              {/* audio effects — waves icon; label shown only when one is active */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={audioFilter !== "off" ? `Effect: ${FILTER_DEFS.find((f) => f.id === audioFilter)?.label}` : "Audio effects"}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/[0.08]",
                      audioFilter !== "off"
                        ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                        : "text-muted-foreground",
                    )}
                  >
                    <Waves className="size-4" />
                    {audioFilter !== "off" && FILTER_DEFS.find((f) => f.id === audioFilter)?.label}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="z-[80]">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">
                    Audio effects
                  </DropdownMenuLabel>
                  {FILTER_DEFS.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      className={cn("gap-2", f.id === audioFilter && "text-[rgb(var(--tint))]")}
                      onSelect={() => {
                        // Guarded: an exception thrown here aborts Radix's
                        // close sequence, leaving the menu's full-screen click
                        // shield in place and the whole UI unclickable.
                        try {
                          setAudioFilter(f.id);
                        } catch {
                          /* never block the menu from closing */
                        }
                      }}
                    >
                      <span aria-hidden>{f.icon}</span>
                      {f.label}
                      {f.id === audioFilter && <span className="ml-auto">●</span>}
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
                  "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/[0.08] sm:px-3 sm:py-1 sm:tracking-wide sm:uppercase",
                  videoEnabled
                    ? "border-[rgb(var(--tint)_/_0.5)] text-[rgb(var(--tint))]"
                    : "text-muted-foreground",
                )}
              >
                <Film className="size-3.5" />
                <span className="hidden sm:inline">Video</span> {videoEnabled ? "on" : "off"}
              </button>

              {/* lyrics toggle */}
              <button
                type="button"
                title="Lyrics"
                onClick={() => setLyricsOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-white/[0.08] sm:px-3 sm:py-1 sm:tracking-wide sm:uppercase",
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
