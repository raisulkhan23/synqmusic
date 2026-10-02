import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { formatBytes, type OfflineEntry } from "@/lib/offlineStore";
import {
  readIndex,
  removeDownload,
  totalDownloadedBytes,
} from "@/lib/offlineAudio";
import {
  cancelDownload,
  dismissDownload,
  useDownloadedTrackIds,
  useDownloads,
  type DownloadMeta,
} from "@/lib/offlineDownloads";
import { performYouTubeDownload } from "@/lib/trackDownload";
import { usePlayerStore } from "@/store/player";
import { cn } from "@/lib/utils";

/**
 * Downloads — one place to watch, retry and remove offline copies.
 *
 * The three sections are genuinely different states and are not collapsed into
 * one list:
 *
 *  - IN PROGRESS comes from the download store. A transfer outlives the button
 *    that started it, so this reads the shared status rather than any one
 *    component's state, and Cancel aborts the transfer itself.
 *  - FAILED also comes from the store, and carries the reason the server, the
 *    resolver or the fetch gave. Retry re-runs the WHOLE flow — the licence
 *    check and a fresh stream resolution — because the URL the first attempt
 *    held is signed and has already expired.
 *  - COMPLETED comes from the on-disk index, which is the record of what is
 *    actually stored. It is the only honest source for size and for whether a
 *    track is here at all.
 *
 * SYNQ only stores tracks it has verified as Creative Commons, or files the
 * listener imported from their own device. There is no button here to download
 * anything else, and there will not be one.
 */
export default function Downloads() {
  const downloads = useDownloads();
  const downloadedIds = useDownloadedTrackIds();
  const [entries, setEntries] = useState<OfflineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Re-read the on-disk index whenever the set of downloaded tracks changes.
  // Keyed on the id set rather than on the store's revision so a transfer's
  // hundred progress ticks do not each trigger a full IndexedDB read.
  useEffect(() => {
    let active = true;
    void readIndex().then((rows) => {
      if (!active) return;
      setEntries(rows);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [downloadedIds]);

  const inProgress = useMemo(
    () =>
      Object.entries(downloads.status)
        .filter(([, status]) => status === "checking" || status === "downloading")
        .map(([trackId]) => ({
          trackId,
          meta: downloads.tracks[trackId],
          progress: downloads.progress[trackId] ?? null,
          checking: downloads.status[trackId] === "checking",
        }))
        .filter(
          (row): row is typeof row & { meta: DownloadMeta } => Boolean(row.meta),
        )
        .sort((a, b) => a.meta.startedAt - b.meta.startedAt),
    [downloads],
  );

  const failed = useMemo(
    () =>
      Object.entries(downloads.status)
        .filter(([, status]) => status === "error")
        .map(([trackId]) => ({
          trackId,
          meta: downloads.tracks[trackId],
          message: downloads.messages[trackId] ?? "",
        }))
        .filter(
          (row): row is typeof row & { meta: DownloadMeta } => Boolean(row.meta),
        )
        .sort((a, b) => b.meta.startedAt - a.meta.startedAt),
    [downloads],
  );

  /**
   * Retry an attempt. It must re-run the licence check and resolve a FRESH
   * stream — the failed attempt's `audioUrl` was signed and has expired, so
   * reusing it would fail for a reason that looks like a dead network.
   *
   * `performYouTubeDownload` is the same ordered flow the Download button uses,
   * so the rights-before-stream invariant cannot drift between the two.
   */
  const retryRef = useRef<(meta: DownloadMeta) => void>(() => {});
  const retry = useCallback(async (meta: DownloadMeta) => {
    const youtubeId = meta.youtubeId;
    if (!youtubeId) return;
    const controller = new AbortController();
    const outcome = await performYouTubeDownload({
      track: {
        videoId: youtubeId,
        title: meta.title,
        artistName: meta.artistName,
        coverUrl: meta.coverUrl,
        duration: meta.duration,
      },
      controller,
    });
    if (outcome.ok) {
      toast.success("Download complete", {
        description: `Saved “${meta.title}” for offline listening.`,
      });
      return;
    }
    if (outcome.cancelled) {
      toast("Download cancelled");
      return;
    }
    toast.error("Download failed", {
      description: outcome.reason,
      action: { label: "Retry", onClick: () => retryRef.current(meta) },
    });
  }, []);
  useEffect(() => {
    retryRef.current = (meta) => void retry(meta);
  }, [retry]);

  const remove = useCallback(async (entry: OfflineEntry) => {
    await removeDownload(entry.trackId);
    // Clearing the status too means a track that was just completed does not
    // leave a stale "done" record behind in the store.
    dismissDownload(entry.trackId);
    toast(`Removed “${entry.title}” from this device`, {
      id: "downloads-remove",
    });
  }, []);

  /**
   * Play a stored track. The player looks for this track id's bytes on disk
   * BEFORE it touches the network, so this is genuinely offline playback.
   */
  const play = useCallback((entry: OfflineEntry) => {
    if (entry.source === "local") {
      void import("@/lib/localAudio").then(({ localEntryToPlayable }) => {
        usePlayerStore.getState().playTrack(localEntryToPlayable(entry));
      });
      return;
    }
    usePlayerStore.getState().playTrack({
      id: entry.trackId,
      title: entry.title,
      artistName: entry.artistName,
      albumName: "",
      coverUrl: entry.coverUrl,
      audioUrl: "stream",
      duration: entry.duration,
      source: "youtube",
      youtubeId: entry.trackId,
    });
  }, []);

  const used = totalDownloadedBytes(entries);
  const hasAnything = inProgress.length + failed.length + entries.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 via-teal-500/[0.08] to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent opacity-70" />
        <div className="relative flex items-end gap-5">
          <div className="relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#0f1a1a] shadow-2xl sm:size-32">
            <span className="absolute -left-8 -top-8 size-24 rounded-full bg-emerald-400/40 blur-2xl" />
            <span className="absolute -bottom-10 -right-6 size-28 rounded-full bg-[rgb(var(--tint)/0.4)] blur-2xl" />
            <Download className="relative z-10 size-12 text-emerald-300 sm:size-16" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
              Offline
            </p>
            <h1 className="mt-1 truncate font-display text-3xl font-bold tracking-tight sm:text-4xl">
              Downloads
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {loading
                ? "Checking this device…"
                : entries.length === 0
                  ? "Nothing saved to this device yet"
                  : `${entries.length} ${entries.length === 1 ? "track" : "tracks"} · ${formatBytes(used)}`}
            </p>
          </div>
        </div>
      </header>

      {inProgress.length > 0 && (
        <Section
          title="Downloading"
          count={inProgress.length}
          icon={<Loader2 className="size-4 animate-spin text-[rgb(var(--tint))]" />}
        >
          {inProgress.map(({ trackId, meta, progress, checking }) => (
            <Row key={trackId} meta={meta}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{meta.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {meta.artistName}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn(
                        "h-full rounded-full bg-[rgb(var(--tint))] transition-[width]",
                        progress === null && "animate-pulse",
                      )}
                      style={{
                        width:
                          progress === null
                            ? "35%"
                            : `${Math.max(2, Math.round(progress * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                    {checking
                      ? "Checking…"
                      : progress === null
                        ? "…"
                        : `${Math.round(progress * 100)}%`}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => cancelDownload(trackId)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1]"
              >
                <X className="size-3.5" />
                Cancel
              </button>
            </Row>
          ))}
        </Section>
      )}

      {failed.length > 0 && (
        <Section
          title="Couldn't finish"
          count={failed.length}
          icon={<AlertTriangle className="size-4 text-amber-400" />}
        >
          {failed.map(({ trackId, meta, message }) => (
            <Row key={trackId} meta={meta}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{meta.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {meta.artistName}
                </p>
                <p className="mt-1 text-xs leading-5 text-amber-300/90">
                  {message || "This download didn't finish."}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {meta.youtubeId && (
                  <button
                    type="button"
                    onClick={() => void retry(meta)}
                    className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white/[0.1]"
                  >
                    <RefreshCw className="size-3.5" />
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismissDownload(trackId)}
                  aria-label={`Dismiss ${meta.title}`}
                  className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
            </Row>
          ))}
        </Section>
      )}

      {entries.length > 0 && (
        <Section
          title="On this device"
          count={entries.length}
          icon={<CheckCircle2 className="size-4 text-emerald-400" />}
        >
          {entries.map((entry) => (
            <Row key={entry.key} meta={entry}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{entry.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {entry.artistName} · {formatBytes(entry.bytes)}
                  {entry.pinned ? " · Pinned" : ""}
                </p>
              </div>
              {(entry.source === "local" || entry.source === "youtube") && (
                <button
                  type="button"
                  onClick={() => play(entry)}
                  aria-label={`Play ${entry.title}`}
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  <Play className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => void remove(entry)}
                aria-label={`Remove ${entry.title} from this device`}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
              >
                <Trash2 className="size-4" />
              </button>
            </Row>
          ))}
        </Section>
      )}

      {!loading && !hasAnything && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center">
          <HardDrive className="mx-auto size-10 text-muted-foreground/40" />
          <p className="mt-3 font-display text-lg font-semibold">
            No downloads yet
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Creative Commons tracks can be saved for offline listening, and you
            can import your own audio files. Downloads you start appear here
            with their progress.
          </p>
          <Link
            to="/search"
            className="mt-4 inline-flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-semibold text-black shadow-[0_8px_30px_rgb(var(--tint)/0.35)] transition-transform hover:scale-[1.03]"
          >
            Find Creative Commons music
          </Link>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-4 shrink-0 text-emerald-400/80" />
        <span>
          SYNQ only stores tracks it has verified are published under a Creative
          Commons licence, plus audio files you import from your own device.
          Everything else streams.
        </span>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 px-1 text-sm font-semibold tracking-wide text-muted-foreground">
        {icon}
        {title}
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] tabular-nums">
          {count}
        </span>
      </h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

/** A row shell with the track's cover, shared by all three sections. */
function Row({
  meta,
  children,
}: {
  meta: { title: string; artistName: string; coverUrl: string };
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      {meta.coverUrl ? (
        <img
          src={meta.coverUrl}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
          <Download className="size-4 text-muted-foreground" />
        </span>
      )}
      {children}
    </div>
  );
}
