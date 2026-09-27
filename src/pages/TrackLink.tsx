import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Loader2, Music4, Play } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { parseTrackLink, trackLinkToPlayable } from "@/lib/shareLink";
import { usePlayerStore } from "@/store/player";
import { toast } from "sonner";

/**
 * Landing page for a shared track link (`/t/:id?…`).
 *
 * Opening the link plays that song. It is deliberately a separate route rather
 * than a query string on the home page, so a link is a stable, shareable
 * address for one track, and so the player can take over from here without the
 * home page's discovery fetches running underneath it.
 */
export default function TrackLink() {
  const { trackId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const playTrack = usePlayerStore((s) => s.playTrack);
  const current = usePlayerStore((s) => s.current);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  // A link can be opened twice in the same session (React re-runs the effect on
  // a param change), and re-playing the same track would restart it.
  const startedFor = useRef<string | null>(null);

  // Whether the link is usable is derived, not stored: an unparseable link
  // simply has no parsed value, so there is nothing for a state flag to add —
  // and mirroring it in state meant a setState on the first render.
  const link = parseTrackLink(trackId, params);

  useEffect(() => {
    if (!link) return;
    const key = `${link.id}|${link.title}`;
    if (startedFor.current === key) return;
    startedFor.current = key;
    playTrack(trackLinkToPlayable(link));
  }, [link, playTrack]);

  if (!link) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
        <Music4 className="size-8 text-muted-foreground/40" />
        <p className="font-display text-lg font-semibold">
          That link is incomplete
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This track link is missing its details. Ask for a fresh one, or search
          for the song yourself.
        </p>
        <Link
          to="/search"
          className="mt-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black"
        >
          Search SYNQ
        </Link>
      </div>
    );
  }

  // Until the store has picked the track up, show a resolving state rather than
  // the final one — otherwise the page flashes "ready" before anything is
  // actually playing.
  const isCurrent = current?.id === link.id || current?.youtubeId === link.id;
  // Browsers block autoplay until the page has been interacted with, and a
  // link opened in a fresh tab has no gesture yet. Claiming "Playing now" from
  // the track merely being LOADED would be a lie in exactly that case, so the
  // label follows the real playback state and a play button appears instead.
  const playing = isCurrent && isPlaying;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <div className="w-40 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-2xl sm:w-56">
        {link.coverUrl ? (
          <img
            src={link.coverUrl}
            alt=""
            className="aspect-square w-full object-cover"
          />
        ) : (
          <div className="flex aspect-square w-full items-center justify-center">
            <Music4 className="size-10 text-muted-foreground/30" />
          </div>
        )}
      </div>

      <div className="max-w-md">
        <p className="text-[10px] font-semibold tracking-[0.24em] text-[rgb(var(--tint))] uppercase">
          Shared track
        </p>
        <h1 className="mt-2 truncate font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {link.title}
        </h1>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {link.artist}
        </p>
      </div>

      {playing ? (
        <div className="flex items-center gap-2 rounded-full bg-[rgb(var(--tint)/0.12)] px-4 py-2 text-sm font-semibold text-[rgb(var(--tint))]">
          <Play className="size-4 fill-current" />
          Playing now
        </div>
      ) : isCurrent ? (
        <button
          type="button"
          onClick={() => togglePlay()}
          className="flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-transform hover:scale-[1.03]"
        >
          <Play className="size-4 fill-current" />
          Play
        </button>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Starting playback…
        </p>
      )}

      <div className="flex items-center gap-2">
        <Link
          to="/home"
          className="rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-transform hover:scale-[1.03]"
        >
          Open SYNQ
        </Link>
        <button
          type="button"
          onClick={() => {
            void copyText(window.location.href).then((ok) => {
              if (ok) toast.success("Link copied");
              else toast.error("Couldn't copy the link");
            });
          }}
          className="rounded-full border border-white/15 bg-white/[0.05] px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-white/[0.1]"
        >
          Copy link
        </button>
      </div>

      <button
        type="button"
        onClick={() => navigate("/search")}
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Search instead
      </button>
    </div>
  );
}
