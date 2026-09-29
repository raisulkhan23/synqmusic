import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { SeekBar } from "@/components/player/SeekBar";
import { TransportControls } from "@/components/player/TransportControls";
import { VolumeControl } from "@/components/player/VolumeControl";
import { accentFromString, dominantColor } from "@/lib/covers";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { artistSearchQuery } from "@/lib/youtube";
import { getAudio } from "@/lib/audio";
import { formatRemaining, useSleepCountdown } from "@/lib/sleepTimer";
import { formatSkipped } from "@/lib/introTrim";
import { usePlayerStore } from "@/store/player";
import {
  Heart,
  House,
  ListMusic,
  Loader2,
  Maximize2,
  Minimize2,
  Moon,
  Scissors,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type SessionLayout = "off" | "study" | "work" | "sleep";

const SESSION_LABELS: Record<Exclude<SessionLayout, "off">, string> = {
  study: "Study session",
  work: "Work session",
  sleep: "Sleep session",
};

function isSessionLayout(value: string | null): value is SessionLayout {
  return (
    value === "off" ||
    value === "study" ||
    value === "work" ||
    value === "sleep"
  );
}

/**
 * Live sleep-timer chip.
 *
 * The timer could previously only be seen (or cancelled) from the fullscreen
 * player, which is one tap away and not even reachable on the layouts where
 * the bar covers the screen. Arming a 30-minute timer and never seeing it again
 * meant people forgot it was running and wondered why the music stopped.
 */
function SleepTimerChip() {
  const sleepEndsAt = usePlayerStore((s) => s.sleepEndsAt);
  const sleepAtSongEnd = usePlayerStore((s) => s.sleepAtSongEnd);
  const setSleepTimer = usePlayerStore((s) => s.setSleepTimer);
  const now = useSleepCountdown(sleepEndsAt);

  if (sleepEndsAt === null && !sleepAtSongEnd) return null;

  return (
    <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] py-1 pr-0.5 pl-2 text-[10px] font-semibold text-muted-foreground">
      <Moon className="size-3 text-[rgb(var(--tint))]" aria-hidden="true" />
      <span className="tabular-nums">
        {sleepEndsAt !== null
          ? formatRemaining(sleepEndsAt - now)
          : "end of song"}
      </span>
      <button
        type="button"
        aria-label="Cancel sleep timer"
        title="Cancel sleep timer"
        onClick={() => {
          setSleepTimer(null);
          toast.success("Sleep timer cancelled");
        }}
        className="rounded-full p-0.5 transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}

/**
 * Smart intro trim control.
 *
 * Appears once the setting is on, and whenever a trim has actually been
 * applied. The automatic probe can only see tracks whose audio flows through
 * the Web Audio graph, so the manual button is the escape hatch for everything
 * else — a cinematic upload playing through the YouTube engine, or a listener
 * who simply knows the intro is dead.
 */
function IntroTrimChip() {
  const introTrim = usePlayerStore((s) => s.introTrim);
  const skipped = usePlayerStore((s) => s.introTrimSkipped);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const hasTrack = usePlayerStore((s) => s.current !== null);
  const skipIntro = usePlayerStore((s) => s.skipIntro);
  const undoIntroTrim = usePlayerStore((s) => s.undoIntroTrim);

  // Once a trim has landed the playhead is past the intro, so the button has
  // nothing left to do — the undo affordance replaces it.
  const inIntro = hasTrack && currentTime <= 60;
  if (skipped !== null) {
    return (
      <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] py-1 pr-0.5 pl-2 text-[10px] font-semibold text-muted-foreground">
        <Scissors
          className="size-3 text-[rgb(var(--tint))]"
          aria-hidden="true"
        />
        <span className="tabular-nums">Trimmed {formatSkipped(skipped)}</span>
        <button
          type="button"
          aria-label="Undo intro trim"
          title="Undo intro trim"
          onClick={() => {
            undoIntroTrim();
            toast("Intro restored");
          }}
          className="rounded-full p-0.5 transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Undo2 className="size-3" />
        </button>
      </div>
    );
  }
  if (!introTrim || !inIntro) return null;

  return (
    <button
      type="button"
      onClick={() => {
        const applied = skipIntro();
        if (applied > 0)
          toast(`Skipped ${formatSkipped(applied)} of intro`, {
            description: "Undo it any time from here.",
          });
      }}
      title="Skip ahead past a slow intro"
      className="flex shrink-0 items-center gap-1 rounded-full bg-white/[0.07] px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-white/[0.12] hover:text-foreground"
    >
      <Scissors className="size-3" aria-hidden="true" />
      Skip intro
    </button>
  );
}

function ReadingSessionNav() {
  const navigate = useNavigate();
  const [layout, setLayout] = useState<SessionLayout>(() => {
    const saved = localStorage.getItem("ss.focusLayout");
    return isSessionLayout(saved)
      ? saved
      : localStorage.getItem("ss.focusMode") === "1"
        ? "study"
        : "off";
  });

  useEffect(() => {
    const onLayoutChange = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (isSessionLayout(next)) setLayout(next);
    };
    window.addEventListener("synq:focus-layout-change", onLayoutChange);
    return () =>
      window.removeEventListener("synq:focus-layout-change", onLayoutChange);
  }, []);

  if (layout === "off") return null;

  const exitSession = () => {
    localStorage.setItem("ss.focusLayout", "off");
    localStorage.setItem("ss.focusMode", "0");
    window.dispatchEvent(
      new CustomEvent("synq:focus-layout-change", { detail: "off" }),
    );
  };

  return (
    <div className="fixed top-3 right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-1 rounded-2xl border border-white/10 bg-[#101218]/90 p-1.5 shadow-2xl backdrop-blur-xl sm:right-4">
      <span className="hidden px-2 text-[10px] font-semibold tracking-[0.14em] text-brand uppercase sm:inline">
        {SESSION_LABELS[layout]}
      </span>
      <button
        type="button"
        onClick={() => void navigate("/home")}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
        title="Go home"
      >
        <House className="size-3.5" />
        <span className="hidden md:inline">Home</span>
      </button>
      <button
        type="button"
        onClick={() => void navigate("/search")}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
        title="Search music"
      >
        <Search className="size-3.5" />
        <span className="hidden md:inline">Search</span>
      </button>
      <button
        type="button"
        onClick={() => usePlayerStore.getState().setQueueOpen(true)}
        className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
        title="Open queue"
      >
        <ListMusic className="size-3.5" />
        <span className="hidden md:inline">Queue</span>
      </button>
      <button
        type="button"
        onClick={exitSession}
        className="flex items-center gap-1.5 rounded-xl bg-brand px-2.5 py-2 text-xs font-semibold text-brand-foreground transition-transform hover:scale-[1.02]"
        title="End listening session"
      >
        <Minimize2 className="size-3.5" />
        <span>End session</span>
      </button>
    </div>
  );
}

export function PlayerBar({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);
  const liked = usePlayerStore((s) => s.liked);
  // null ⇒ the track has no usable artist, so the name renders as plain text.
  const artistQuery = useMemo(
    () => artistSearchQuery(current?.artistName, current?.title),
    [current?.artistName, current?.title],
  );
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

    // Start with a deterministic track color so every song gets its own theme
    // immediately. If same-origin artwork can be sampled, replace that seed
    // with the cover's dominant color when extraction finishes.
    const seededAccent = accentFromString(
      `${current.title} ${current.artistName}`,
    );
    setAccent(seededAccent);
    if (current.coverUrl) {
      // Artwork extraction is a secondary enhancement. Keep it off the
      // critical path and avoid starting another decode for every quick
      // track change; the deterministic accent is already immediate.
      const timer = window.setTimeout(() => {
        void dominantColor(current.coverUrl).then((c) => {
          if (!cancelled && c) setAccent(c);
        });
      }, 180);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [current, setAccent]);

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
    if (
      attempts.current >= alternatives.length &&
      track.audioUrl &&
      attempts.current > 0 &&
      rescueExhausted.current
    ) {
      toast.error("No more sources available for this track");
      return;
    }
    // First failure for this track: try to rescue the SAME song through the
    // resolved direct stream (the proxy path) — this covers videos that are
    // embed-restricted or region-blocked in the iframe but still streamable.
    if (!track.audioUrl) {
      rescueExhausted.current = true;
      toast.loading(`Finding a way to play "${track.title}"…`, {
        id: "yt-fallback",
      });
      // playViaStream resolves asynchronously. Clear the loading toast when
      // the shared audio element actually starts, rather than leaving it
      // stuck after a successful rescue.
      const audio = getAudio();
      const cleanup = () => {
        audio.removeEventListener("playing", onPlaying);
        window.clearTimeout(timeout);
        toast.dismiss("yt-fallback");
      };
      const onPlaying = () => cleanup();
      const timeout = window.setTimeout(cleanup, 15_000);
      audio.addEventListener("playing", onPlaying, { once: true });
      playViaStream(track);
      return;
    }

    // Stream also failed (e.g. YouTube's bot-check blocked this upload).
    // Before abandoning the song, re-search for the SAME song title and try a
    // different upload of it. Only when every upload fails do we give up.
    if (attempts.current === 0) {
      attempts.current = 1;
      toast.loading(`Looking for another upload of "${track.title}"…`, {
        id: "yt-fallback",
      });
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
            toast.error(`"${track.title}" couldn't be played`, {
              id: "yt-fallback",
            });
            return;
          }
          replaceCurrentStream(
            toPlayableYoutube(
              candidate,
              candidate.id,
              items.filter((i) => i.id !== candidate.id),
            ),
          );
          toast.success(`Playing "${track.title}"`, { id: "yt-fallback" });
        })
        .catch(() =>
          toast.error("Playback failed — try another song", {
            id: "yt-fallback",
          }),
        );
      return;
    }

    const next = alternatives[attempts.current - 1];
    if (!next) {
      toast.error(`"${track.title}" couldn't be played`, { id: "yt-fallback" });
      return;
    }
    attempts.current += 1;
    toast.loading(`Finding another way to play "${track.title}"…`, {
      id: "yt-fallback",
    });
    // The IFrame engine plays by video id — just swap the current track.
    replaceCurrentStream(toPlayableYoutube(next, next.id, alternatives));
    toast.success("Playing a matching version", { id: "yt-fallback" });
  }, [errorNonce, replaceCurrentStream, playViaStream, searchSameSong]);

  // AirPods and other Bluetooth media remotes dispatch Media Session actions
  // rather than key events. Registering the handlers makes a double tap send
  // `nexttrack`, while also supporting play, pause, seek and previous track.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    type SessionAction =
      | "play"
      | "pause"
      | "playpause"
      | "nexttrack"
      | "previoustrack"
      | "seekbackward"
      | "seekforward";
    type SessionWithActions = MediaSession & {
      setMediaSessionActionHandler: (
        action: SessionAction,
        handler: ((details: MediaSessionActionDetails) => void) | null,
      ) => void;
    };
    const session = navigator.mediaSession as SessionWithActions;
    const register = (
      action: SessionAction,
      handler: (details: MediaSessionActionDetails) => void,
    ) => {
      try {
        session.setMediaSessionActionHandler(action, handler);
      } catch {
        // Older Safari builds expose Media Session but reject individual
        // actions. Unsupported controls should never affect playback.
      }
    };

    register("play", () => {
      const player = usePlayerStore.getState();
      if (player.current && !player.isPlaying) player.togglePlay();
    });
    register("pause", () => {
      const player = usePlayerStore.getState();
      if (player.current && player.isPlaying) player.togglePlay();
    });
    register("playpause", () => {
      const player = usePlayerStore.getState();
      if (player.current) player.togglePlay();
    });
    register("nexttrack", () => {
      const player = usePlayerStore.getState();
      if (player.current) player.next();
    });
    register("previoustrack", () => {
      const player = usePlayerStore.getState();
      if (player.current) player.prev();
    });
    register("seekbackward", (details) => {
      const player = usePlayerStore.getState();
      const requestedOffset = details.seekOffset;
      const offset =
        typeof requestedOffset === "number" && Number.isFinite(requestedOffset)
          ? requestedOffset
          : 10;
      player.seek(Math.max(0, player.currentTime - offset));
    });
    register("seekforward", (details) => {
      const player = usePlayerStore.getState();
      const requestedOffset = details.seekOffset;
      const offset =
        typeof requestedOffset === "number" && Number.isFinite(requestedOffset)
          ? requestedOffset
          : 10;
      const end =
        player.duration > 0 ? player.duration : Number.POSITIVE_INFINITY;
      player.seek(Math.min(end, player.currentTime + offset));
    });

    return () => {
      const actions: SessionAction[] = [
        "play",
        "pause",
        "playpause",
        "nexttrack",
        "previoustrack",
        "seekbackward",
        "seekforward",
      ];
      actions.forEach((action) => {
        try {
          session.setMediaSessionActionHandler(action, null);
        } catch {
          /* ignore unsupported cleanup */
        }
      });
    };
  }, []);

  // Publish now-playing metadata so iOS/Safari can show SYNQ in Control Center
  // and expose the app as the active AirPods media session.
  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined")
      return;
    const session = navigator.mediaSession;
    if (!current) {
      session.metadata = null;
      return;
    }
    const artwork = current.coverUrl
      ? [96, 256, 512].map((size) => ({
          src: current.coverUrl,
          sizes: `${size}x${size}`,
        }))
      : undefined;
    session.metadata = new MediaMetadata({
      title: current.title,
      artist: current.artistName,
      album: current.albumName ?? "SYNQ",
      artwork,
    });
  }, [current]);

  // Keep lock-screen / headphone scrubber state synchronized with playback.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    session.playbackState = current
      ? isPlaying
        ? "playing"
        : "paused"
      : "none";
    if (!current) return;

    const player = usePlayerStore.getState();
    const mediaDuration = duration || current.duration || player.duration;
    if (!Number.isFinite(mediaDuration) || mediaDuration <= 0) return;
    const safeTime = Math.min(
      mediaDuration,
      Math.max(0, Number.isFinite(currentTime) ? currentTime : 0),
    );
    const playbackRate =
      Number.isFinite(player.rate) && player.rate > 0 ? player.rate : 1;
    try {
      session.setPositionState({
        duration: mediaDuration,
        playbackRate,
        position: safeTime,
      });
    } catch {
      // Some browsers throw while duration metadata is still resolving.
    }
  }, [current, currentTime, duration, isPlaying]);

  if (!current) return <ReadingSessionNav />;

  const isLiked = liked[current.id] !== undefined;
  const rawDuration = duration || current.duration;
  const playbackDuration =
    Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;
  const safeCurrentTime = Number.isFinite(currentTime)
    ? Math.max(0, currentTime)
    : 0;
  const playbackProgress =
    playbackDuration > 0
      ? Math.min(100, (safeCurrentTime / playbackDuration) * 100)
      : 0;

  return (
    <>
      <ReadingSessionNav />
      <footer
        data-playing={isPlaying}
        className={cn(
          /* `my-3` (not `sm:mb-0 sm:mt-3`) keeps the gap above the player equal to
           the gap below it at every breakpoint. Asymmetric margins made the top
           edge sit flush against the content above on tablets, and the 8px
           mobile gap was swallowed by the player's outer glow. */
          "mobile-player liquid-glass dynamic-island isolate z-40 mx-auto my-3 flex h-[68px] w-full min-w-0 max-w-[28rem] shrink-0 items-center gap-2 self-center overflow-hidden rounded-[1.6rem] border border-white/[0.1] px-2.5 transition-all duration-300 sm:h-auto sm:w-auto sm:max-w-none sm:rounded-none sm:border-x-0 sm:border-b-0 sm:px-4 sm:gap-3 lg:w-[min(92vw,760px)] lg:rounded-[2rem] lg:border lg:border-white/10 lg:px-3 lg:py-2 lg:shadow-[0_18px_60px_rgba(0,0,0,0.38)] lg:hover:scale-[1.01]",
          compact
            ? "sm:min-h-[60px] lg:min-h-[52px] lg:py-1"
            : "sm:min-h-[76px] lg:min-h-[68px] lg:py-2",
        )}
      >
        <div
          className="mobile-island-aura pointer-events-none absolute inset-0"
          aria-hidden="true"
        />

        {/* now playing */}
        <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2 sm:max-w-[34%] sm:gap-3 lg:max-w-[230px] lg:flex-none lg:basis-[230px]">
          <div className="mobile-player-art relative size-10 shrink-0 overflow-hidden rounded-[0.9rem] shadow-lg ring-1 ring-white/15 sm:size-11 lg:size-10 lg:rounded-md">
            <img
              src={current.coverUrl}
              alt=""
              className="size-full object-cover"
            />
            {isBuffering && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Loader2 className="size-4 animate-spin text-white" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <p
                className={cn(
                  "min-w-0 flex-1 truncate text-sm font-semibold",
                  isPlaying && "text-[rgb(var(--tint))]",
                )}
              >
                {current.title}
              </p>
              <span className="mobile-live-cue" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
            <p className="block truncate text-xs text-muted-foreground">
              {/* Tapping the artist is the fastest route to more of the same.
                It was static text, so finding an artist's other songs meant
                going back to search and typing the name by hand. Renders as
                plain text when the track has no usable artist, rather than a
                link that dead-ends into an empty result list. */}
              {artistQuery ? (
                <button
                  type="button"
                  onClick={() =>
                    void navigate(
                      `/search?q=${encodeURIComponent(artistQuery)}`,
                    )
                  }
                  className="block max-w-full truncate text-left transition-colors hover:text-foreground hover:underline"
                >
                  {current.artistName}
                </button>
              ) : (
                <span className="block max-w-full truncate">
                  {current.artistName}
                </span>
              )}
            </p>
          </div>
          {/* Like lives in the fullscreen player — the mobile bar only needs
            play controls; keeping it here squeezed the title into the
            transport buttons and they collided on small screens. */}
          <button
            type="button"
            aria-label={
              isLiked ? "Remove from liked songs" : "Add to liked songs"
            }
            onClick={() => {
              toggleLike(current.id);
              setLikePulse(true);
              setTimeout(() => setLikePulse(false), 400);
            }}
            className={cn(
              "hidden shrink-0 rounded-full p-1.5 transition-all hover:scale-110 lg:block",
              isLiked
                ? "text-[rgb(var(--tint))]"
                : "text-muted-foreground hover:text-foreground",
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

        {/* transport + seek — timestamps are desktop-only; on mobile the
            seekbar sits alone so prev/play/next never collide with them */}
        <div className="relative z-10 flex w-auto shrink-0 flex-col items-center gap-0.5 sm:min-w-0 sm:flex-1 sm:basis-0 lg:min-w-0">
          <TransportControls className="sm:hidden" compact />
          <TransportControls className="hidden sm:grid" />
          <div className="hidden w-full max-w-xl items-center gap-2 sm:flex">
            <span className="w-11 shrink-0 text-right text-[10px] font-medium tabular-nums text-muted-foreground">
              {formatTime(currentTime)}
            </span>
            <SeekBar className="min-w-0 flex-1" />
            <span className="w-11 shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {formatTime(duration || current.duration)}
            </span>
          </div>
        </div>

        {/* right cluster — desktop keeps queue + volume + expand; mobile gets
            just the expand chevron (queue lives in the fullscreen player and
            the bottom tab bar already covers navigation) */}
        <div className="relative z-10 flex w-auto shrink-0 items-center justify-end gap-0.5">
          <SleepTimerChip />
          <IntroTrimChip />
          <button
            type="button"
            aria-label="Open queue"
            onClick={() => setQueueOpen(!queueOpen)}
            className={cn(
              "hidden rounded-full p-2 transition-colors hover:bg-white/[0.06] sm:block lg:p-1.5",
              queueOpen
                ? "text-[rgb(var(--tint))]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ListMusic className="size-4" />
          </button>
          <VolumeControl className="hidden md:flex lg:scale-90 lg:origin-right" />
          <button
            type="button"
            aria-label="Open full-screen player"
            onClick={() => setFullscreen(true)}
            className="mobile-expand-button touch-manipulation rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground active:scale-90"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>

        <div
          className="mobile-player-progress"
          role="progressbar"
          aria-label="Playback progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(playbackProgress)}
          aria-valuetext={`${formatTime(safeCurrentTime)} of ${formatTime(playbackDuration)}`}
        >
          <span style={{ transform: `scaleX(${playbackProgress / 100})` }} />
        </div>
      </footer>
    </>
  );
}
