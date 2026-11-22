import { useEffect, useRef, useState } from "react";
import {
  Expand,
  ListMusic,
  Loader2,
  MicVocal,
  Play,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/store/player";
import { useShellStore } from "@/lib/shell";
import { useTrackLyrics } from "@/components/player/useTrackLyrics";
import { wordFill } from "@/lib/yrcParse";

/**
 * The reference layout's persistent right panel: lyrics / now-playing.
 *
 * It belongs to the SHELL, not to any page — it stays mounted while the
 * centre column changes route, exactly like the sidebar and the player.
 * With no track it shows the reference's empty state (a quiet play glyph and
 * "No track playing"); with one it shows the artwork, the identity block and
 * the lyrics — per-word karaoke when the source carries real word timings,
 * per-line otherwise. "Word"/"Line" toggles the two renderings. The expand
 * button hands over to the fullscreen player.
 *
 * The playback position is read from the deck element itself (the same
 * source the store's timeupdate uses) rather than through the fullscreen
 * player's subscription, so this panel stays in sync across every route.
 */
export function RightPanel() {
  const setRightPanelOpen = useShellStore((s) => s.setRightPanelOpen);
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const setFullscreen = usePlayerStore((s) => s.setFullscreen);
  const enabled = !!current;
  const [lyricsOpen, setLyricsOpen] = useLyricsToggle(enabled);
  const lyrics = useTrackLyrics(enabled, lyricsOpen);

  return (
    <aside
      aria-label="Lyrics and now playing"
      className="hidden min-h-0 w-[320px] shrink-0 flex-col gap-4 rounded-[var(--radius-panel)] border border-white/[0.06] bg-[var(--surface-low)] p-4 xl:flex"
    >
      {/* header controls: word/line mode + collapse */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Now playing
        </span>
        <div className="flex items-center gap-1.5">
          {lyrics.wordLines || lyrics.lines ? (
            <button
              type="button"
              onClick={() => setLyricsOpen(!lyricsOpen)}
              className="rounded-full px-2 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
              title="Toggle word / line lyrics"
            >
              {lyrics.wordLines ? "Word" : "Line"}
            </button>
          ) : null}
          {current ? (
            <button
              type="button"
              aria-label="Open fullscreen player"
              title="Fullscreen"
              onClick={() => setFullscreen(true)}
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
            >
              <Expand className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Hide lyrics panel"
            title="Hide panel"
            onClick={() => setRightPanelOpen(false)}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {!current ? (
        /* The reference's empty state: a quiet glyph and two honest lines. */
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-white/[0.08] bg-[var(--surface-container)]">
            <Play className="size-6 text-muted-foreground" />
          </span>
          <p className="text-sm font-semibold">No track playing</p>
          <p className="text-xs text-muted-foreground">
            Select a track to listen
          </p>
        </div>
      ) : (
        <>
          {/* identity */}
          <div className="flex min-h-0 flex-col items-center gap-3">
            <div className="relative aspect-square w-full max-w-[240px] overflow-hidden rounded-[var(--radius-cover)] bg-[var(--surface-container)] ring-1 ring-white/10">
              {current.coverUrl ? (
                <img
                  src={current.coverUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center">
                  <ListMusic className="size-8 text-muted-foreground/40" />
                </span>
              )}
              {isPlaying ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-end justify-center gap-1 pb-3"
                >
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="eq-bar w-1 rounded-full bg-[rgb(var(--tint))]"
                      style={{
                        height: `${[45, 75, 55][i]}%`,
                        animationDelay: `${i * 0.18}s`,
                      }}
                    />
                  ))}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-semibold">{current.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {current.artistName}
              </p>
            </div>
          </div>

          {/* lyrics */}
          <div className="flex min-h-0 flex-1 flex-col gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              <MicVocal className="size-3.5" /> Lyrics
            </p>
            <RightPanelLyrics
              lyrics={lyrics}
              loading={lyrics.loading}
              wordMode={!!lyrics.wordLines}
            />
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * The lyrics column: the same line/karaoke rendering the fullscreen player
 * uses, scoped to this panel. Independent scroll; the active line follows
 * playback.
 */
function RightPanelLyrics({
  lyrics,
  loading,
  wordMode,
}: {
  lyrics: ReturnType<typeof useTrackLyrics>;
  loading: boolean;
  wordMode: boolean;
}) {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const seek = usePlayerStore((s) => s.seek);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasCentredRef = useRef(false);

  // Follow the active line (instant first centre, smooth after), mirroring
  // the fullscreen lyrics panel's behaviour.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      "[data-active='true']",
    );
    if (!el) return;
    const first = !hasCentredRef.current;
    hasCentredRef.current = true;
    if (first) {
      el.scrollIntoView({ block: "center", behavior: "auto" });
      return;
    }
    const smooth =
      typeof window === "undefined" ||
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
  }, [lyrics.activeIndex]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!lyrics.lines) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <MicVocal className="size-7 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">
          No lyrics found for this track.
        </p>
      </div>
    );
  }
  return (
    <div
      ref={containerRef}
      className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]"
    >
      <div className="flex flex-col gap-1 py-4">
        {lyrics.lines.map((line, i) =>
          line.blank ? (
            <div key={`gap-${line.t}-${i}`} aria-hidden="true" className="h-4" />
          ) : (
            <button
              key={`${line.t}-${i}`}
              type="button"
              data-active={i === lyrics.activeIndex}
              onClick={() => seek(line.t)}
              className={cn(
                "block w-full rounded-lg px-2 py-1 text-left transition-colors",
                i === lyrics.activeIndex
                  ? "text-sm font-bold text-[rgb(var(--tint))]"
                  : "text-[13px] font-medium text-foreground/40 hover:text-foreground/70",
              )}
            >
              {wordMode && lyrics.wordLines && i < lyrics.wordLines.length ? (
                <span className="whitespace-pre-wrap">
                  {lyrics.wordLines[i].words.map((word, w) => {
                    const fill = wordFill(word, currentTime);
                    return (
                      <span
                        key={`${word.t0}-${w}`}
                        style={
                          fill > 0 && fill < 1
                            ? {
                                backgroundImage: `linear-gradient(90deg, rgb(var(--tint)) 0 ${Math.round(fill * 100)}%, currentColor ${Math.round(fill * 100)}% 100%)`,
                                WebkitBackgroundClip: "text",
                                backgroundClip: "text",
                                color: "transparent",
                              }
                            : undefined
                        }
                        className={cn(fill >= 1 && "text-[rgb(var(--tint))]")}
                      >
                        {word.text}
                      </span>
                    );
                  })}
                </span>
              ) : (
                line.text
              )}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

/** Word/Line toggle state for the panel. */
function useLyricsToggle(_enabled: boolean): [boolean, (v: boolean) => void] {
  const [open, setValue] = useState(true);
  return [open, setValue];
}
