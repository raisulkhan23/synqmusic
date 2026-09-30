import { useAction } from "convex/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Disc3,
  Loader2,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { toPlayableJamendo } from "@/lib/playable";
import { usePlayerStore } from "@/store/player";
import type { JamendoTrack } from "@/lib/jamendo";
import type { ImportFailure } from "@/lib/importModel";

/**
 * Jamendo search results.
 *
 * The one section of the search page that plays something other than YouTube.
 * Everything else here resolves a title against YouTube; a Jamendo track brings
 * its own Creative Commons stream URL, so this list is genuinely playable
 * audio and not a second-class mirror of the results above it.
 *
 * Self-contained on purpose: it owns its query, its request and every state it
 * can be in, so the search page's own loading/error logic is not extended with
 * a fourth case it would then have to keep in sync.
 *
 * The failure states are the point. Jamendo needs a free API key, and a
 * deployment without one must say so plainly instead of appearing broken; a
 * spent quota must say "try again shortly" rather than "something went wrong".
 */
export function JamendoResults({ query }: { query: string }) {
  const searchJamendo = useAction(api.jamendo.searchJamendo);
  const playTrack = usePlayerStore((s) => s.playTrack);

  /**
   * One state object, tagged with the request that produced it.
   *
   * Storing `loading` as its own boolean means setting it synchronously when
   * the effect starts, which is a cascading render on every keystroke — the
   * same shape as the `Shelf` loop that used to hang this app. Deriving
   * "still loading" from "does the answer match the current query" removes the
   * setState-at-the-start entirely: the effect only ever writes state from a
   * promise callback, and the UI cannot get stuck showing a spinner because
   * there is no separate flag to forget to clear.
   */
  const [answer, setAnswer] = useState<{
    key: string;
    tracks: JamendoTrack[] | null;
    failure: ImportFailure | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Guards against a stale response overwriting a newer one when the listener
  // keeps typing: the last request wins, and the rest are dropped.
  const requestId = useRef(0);

  const trimmed = query.trim();
  const runnable = trimmed.length > 1;
  const key = `${trimmed}#${attempt}`;

  useEffect(() => {
    if (!runnable) return;
    const id = ++requestId.current;

    void searchJamendo({ query: trimmed, limit: 12 })
      .then((result) => {
        if (id !== requestId.current) return;
        setAnswer(
          result.ok
            ? { key, tracks: result.tracks, failure: null }
            : { key, tracks: null, failure: result.failure },
        );
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        setAnswer({
          key,
          tracks: null,
          failure: {
            code: "unknown",
            message: "Jamendo search didn't finish.",
            retryable: true,
            hint:
              error instanceof Error && error.message
                ? error.message.slice(0, 200)
                : undefined,
          },
        });
      });
  }, [searchJamendo, trimmed, runnable, key]);

  // A stale answer is treated as no answer at all, so results from the
  // previous query never sit on screen under a new one.
  const fresh = answer?.key === key ? answer : null;
  const loading = runnable && fresh === null;
  const tracks = fresh?.tracks ?? null;
  const failure = fresh?.failure ?? null;

  const playables = useMemo(
    () => (tracks ?? []).map(toPlayableJamendo),
    [tracks],
  );

  if (!runnable) return null;

  const onPick = (index: number) => {
    const chosen = playables[index];
    if (!chosen) return;
    // Finite queue, not radio: the listener asked for this search, so the
    // results ARE the queue. Starting a YouTube radio here would replace a
    // precise Creative Commons selection with unrelated uploads.
    playTrack(chosen, playables);
  };

  return (
    <section aria-labelledby="jamendo-heading" className="mt-6">
      <div className="mb-2 flex items-center gap-2">
        <Disc3 className="size-4 text-[rgb(var(--tint))]" />
        <h2
          id="jamendo-heading"
          className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase"
        >
          Creative Commons audio
        </h2>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-foreground">
          Jamendo
        </span>
      </div>

      {loading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Searching Jamendo…
        </p>
      ) : failure ? (
        <JamendoFailure
          failure={failure}
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : playables.length > 0 ? (
        <>
          <p className="mb-2 text-xs text-muted-foreground">
            Independent and Creative Commons licensed. These play directly in
            SYNQ — no YouTube lookup.
          </p>
          <div className="flex flex-col gap-0.5">
            {playables.map((track, i) => (
              <JamendoRow
                key={track.id}
                index={i}
                track={track}
                onPlay={onPick}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/**
 * Renders the three states that must never look like a crash.
 *
 * "Not configured" is styled as information, not as an error: it is a
 * deployment setting, and a red box would tell the listener their search broke
 * when nothing about their search is wrong.
 */
function JamendoFailure({
  failure,
  onRetry,
}: {
  failure: ImportFailure;
  onRetry: () => void;
}) {
  const isConfig = failure.code === "not-configured";
  const Icon = isConfig ? Sparkles : TriangleAlert;

  return (
    <div
      role="status"
      className="rounded-2xl border border-dashed border-white/10 px-4 py-5"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        {failure.message}
      </p>
      {failure.hint ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{failure.hint}</p>
      ) : null}
      {failure.retryable ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.08]"
        >
          <RefreshCw className="size-3" />
          Try again
        </button>
      ) : null}
    </div>
  );
}

function JamendoRow({
  index,
  track,
  onPlay,
}: {
  index: number;
  track: ReturnType<typeof toPlayableJamendo>;
  onPlay: (index: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlay(index)}
      className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
    >
      {track.coverUrl ? (
        <img
          src={track.coverUrl}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-white/[0.05]">
          <Disc3 className="size-4 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {track.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {track.artistName}
          {track.albumName ? ` · ${track.albumName}` : ""}
        </span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {formatDuration(track.duration)}
      </span>
    </button>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
