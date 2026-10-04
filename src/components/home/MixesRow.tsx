import { Play } from "lucide-react";
import { Shelf } from "@/components/core/shelf";
import { Sparkles } from "lucide-react";
import { mixCover, type Mix } from "@/lib/mixes";
import { cn } from "@/lib/utils";

/**
 * The "Your Mixes" row on Home.
 *
 * Deliberately NOT built from `MediaCard`. A mix is not a track or an album:
 * it is a standing, revisable set, so the tile reads as a mix — a gradient
 * face with the opening track's artwork behind it, the mix name, its size and
 * a single press-to-play — rather than as a song card in a different hat.
 *
 * Every value here is real: the artwork is the first track that actually has a
 * cover, the size is the real number of tracks assembled, and pressing the
 * tile plays the real queue. There is no placeholder tile and no "coming soon"
 * copy, and the row renders nothing at all when no mix has enough tracks (see
 * `buildMixes`), so a brand-new listener never sees a shelf of empty cards.
 */
export function MixesRow({
  mixes,
  onPlay,
}: {
  mixes: Mix[];
  onPlay: (mix: Mix) => void;
}) {
  if (mixes.length === 0) return null;

  return (
    <Shelf
      id="shelf-mixes"
      title="Your Mixes"
      subtitle="Personalised sets that keep evolving as you listen"
      icon={<Sparkles className="size-4 text-[rgb(var(--tint))]" />}
    >
      {mixes.map((mix) => {
        const cover = mixCover(mix);
        return (
          <button
            key={mix.id}
            type="button"
            onClick={() => onPlay(mix)}
            className="group relative flex aspect-square w-36 shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-left transition-all hover:-translate-y-0.5 hover:border-[rgb(var(--tint)_/_0.35)] focus-visible:ring-2 focus-visible:ring-[rgb(var(--tint))] focus-visible:outline-none sm:w-40 lg:w-44"
            aria-label={`Play ${mix.name}`}
          >
            {cover ? (
              <img
                src={cover}
                alt=""
                loading="lazy"
                className="absolute inset-0 size-full object-cover opacity-45 transition-transform duration-500 group-hover:scale-105"
              />
            ) : null}
            <span
              className={cn(
                "pointer-events-none absolute inset-0 bg-gradient-to-t",
                mix.accent,
              )}
            />
            <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />

            {/* Press-to-play, revealed on hover/focus so the tile stays clean. */}
            <span className="absolute right-3 top-3 flex size-9 translate-y-1 items-center justify-center rounded-full bg-[rgb(var(--tint))] text-black opacity-0 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
              <Play className="size-4 translate-x-[1px] fill-current" />
            </span>

            <span className="relative text-sm font-semibold text-foreground drop-shadow">
              {mix.name}
            </span>
            <span className="relative mt-0.5 text-[10px] text-white/70">
              {mix.items.length} tracks
            </span>
          </button>
        );
      })}
    </Shelf>
  );
}
