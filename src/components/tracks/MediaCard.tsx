import { TrackActionsMenu } from "@/components/tracks/useTrackActions";
import { albumPath, artistPath } from "@/lib/artistLinks";
import { cn } from "@/lib/utils";
import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { ListMusic, Loader2, Pause, Play } from "lucide-react";
import { Link } from "react-router";
import type { ReactNode } from "react";

/**
 * An artwork-first card for a Home shelf.
 *
 * The hierarchy is deliberately artwork → title → artist → metadata, and
 * nothing else. The previous Home recommendation rows were numbered vertical
 * lists, which made the page read like an analytics feed: the artwork was a
 * 40px thumbnail beside a line of text, the ranking numbers implied an
 * ordering the listener never asked for, and each row carried a sentence of
 * explanation.
 *
 * Secondary actions are NOT permanently visible — the card is clean until
 * hovered on a pointer device. On touch they collapse into the overflow menu
 * that is already in the shared `TrackActionsMenu`.
 */
export function MediaCard({
  item,
  onOpen,
  onPlay,
  /** Rendered under the artist line. */
  meta,
  variant = "song",
  className,
  round = false,
  /** True while this card's track is being resolved to a playable stream. */
  resolving = false,
  /** Extra menu entries contributed by the page (e.g. remove from playlist). */
  menuItems,
}: {
  item: YtItem;
  /** Primary action: play the track, or navigate for a playlist/artist card. */
  onOpen: () => void;
  /** Playback entry point, shown on hover. Omit for non-playable card. */
  onPlay?: () => void;
  meta?: ReactNode;
  variant?: "song" | "artist" | "playlist";
  className?: string;
  /** Circular artwork, for artists. */
  round?: boolean;
  resolving?: boolean;
  menuItems?: ReactNode;
}) {
  const currentId = usePlayerStore((s) => s.current?.id);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const isCurrent = currentId === item.id && onPlay !== undefined;

  // A track's artist and album have real pages now. Navigating beats dropping
  // the listener on a search box, and it costs nothing for the rows that have
  // no album to link to — the helper returns null and the line is a plain span.
  const artistHref = variant === "artist" ? null : artistPath(item.artist);
  const albumHref =
    variant === "song" && item.album
      ? albumPath(item.artist, item.album)
      : null;

  const title =
    variant === "artist"
      ? cleanArtistName(item.artist, item.title)
      : cleanTrackTitle(item.title);
  const subtitle =
    variant === "artist" ? "Artist" : cleanArtistName(item.artist, item.title);

  const activate = () => {
    // Space/Enter on the card must behave like a click, and the play button
    // lives inside it — so guard against bubbling the secondary action back
    // out into the primary one.
    onOpen();
  };

  return (
    <article
      className={cn(
        "group relative w-32 shrink-0 snap-start sm:w-36 lg:w-40",
        className,
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        }}
        className={cn(
          "block w-full rounded-xl p-2 text-left transition-colors duration-200",
          "hover:bg-white/[0.06] focus-visible:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--tint))]",
        )}
      >
        <div className="relative">
          <div
            className={cn(
              "relative aspect-square w-full overflow-hidden bg-white/[0.04] ring-1 ring-white/10",
              round ? "rounded-full" : "rounded-lg",
            )}
          >
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt=""
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center">
                <ListMusic className="size-6 text-muted-foreground/40" />
              </span>
            )}
            {/* The gradient guarantees the play button stays legible over a
                bright square cover, without dimming the artwork at rest. */}
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-black/0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            />{" "}
            {onPlay ? (
              <button
                type="button"
                aria-label={
                  resolving
                    ? `Loading ${title}`
                    : isCurrent && isPlaying
                      ? `Pause ${title}`
                      : `Play ${title}`
                }
                disabled={resolving}
                onClick={(event) => {
                  event.stopPropagation();
                  onPlay();
                }}
                className={cn(
                  "absolute right-2 bottom-2 z-10 flex size-10 items-center justify-center rounded-full",
                  "bg-[rgb(var(--tint))] text-black shadow-lg transition-all duration-200",
                  // Hover reveals on pointer devices; on touch the card has no
                  // hover, so the control stays put and out of the way.
                  "translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
                  "focus-visible:translate-y-0 focus-visible:opacity-100 max-sm:translate-y-0 max-sm:opacity-100",
                  resolving && "max-sm:opacity-100",
                )}
              >
                {resolving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isCurrent && isPlaying ? (
                  <Pause className="size-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 size-4 fill-current" />
                )}
              </button>
            ) : null}
            {item.duration > 0 && variant === "song" ? (
              <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                {Math.floor(item.duration / 60)}:
                {String(item.duration % 60).padStart(2, "0")}
              </span>
            ) : null}
          </div>

          <div className="mt-2.5 min-w-0 pr-1">
            <p
              className={cn(
                "font-display truncate text-sm font-bold",
                isCurrent && "text-[rgb(var(--tint))]",
              )}
            >
              {title}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {artistHref && variant !== "artist" ? (
                <ArtistLink href={artistHref} stop={onOpen}>
                  {subtitle}
                </ArtistLink>
              ) : (
                subtitle
              )}
            </p>
            {albumHref ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                <ArtistLink href={albumHref} stop={onOpen}>
                  {item.album}
                </ArtistLink>
              </p>
            ) : null}
            {meta ? (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
                {meta}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {variant === "song" ? (
        <div
          className={cn(
            // Kept out of the flow so it can never push the card taller on
            // hover — the shelf rhythm has to stay perfectly even.
            "absolute top-1 right-1 z-20 transition-opacity duration-200",
            "opacity-0 group-hover:opacity-100 focus-within:opacity-100",
            "max-sm:opacity-100",
          )}
        >
          <TrackActionsMenu
            item={item}
            triggerClassName="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
            extraItems={menuItems}
          />
        </div>
      ) : null}
    </article>
  );
}

/**
 * A quiet inline link inside a card.
 *
 * The card itself is a button that plays, so the link has to stop the click
 * from also starting playback.
 *
 * There is deliberately NO `setTimeout` fallback here any more. The fallback
 * ran the CARD's own action — which for every non-artist card is "play this
 * track" — on a 0ms timer after EVERY link press. That is a race the fallback
 * usually lost and occasionally won, and when it won it played the song
 * instead of opening the artist, so the click appeared to do nothing. The
 * search that started could also change the route underneath the link and
 * strand the listener on the page they started from, which is why the artist
 * link only appeared to work after a full reload remounted everything.
 *
 * A plain `<Link>` already does the one thing that matters: keep the click off
 * the card, and let the router own navigation.
 */
function ArtistLink({
  href,
  children,
  stop,
}: {
  href: string;
  children: ReactNode;
  stop: () => void;
}) {
  return (
    <Link
      to={href}
      onClick={(event) => {
        // Keep the click off the card so it does not start playback as well.
        event.stopPropagation();
        stop();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.stopPropagation();
          stop();
        }
      }}
      className="underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:underline focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

/** Inline "loading this card" affordance, sized to the artwork. */
export function CardSpinner() {
  return <Loader2 className="size-4 animate-spin text-[rgb(var(--tint))]" />;
}
