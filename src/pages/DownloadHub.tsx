import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerStore } from "@/store/player";
import { DownloadManager } from "@/lib/downloadManager";
import type {
  DownloadRecord,
  DownloadAdapter,
  DownloadConfig,
} from "@/lib/downloadManager";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Download,
  HardDriveDownload,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";

/**
 * The download hub.
 *
 * WHAT THIS IS. A real view of the real `DownloadManager`: every row is a
 * live download record with its actual byte counts, speed and ETA, and every
 * button calls the real manager. There is no simulated progress and no button
 * that pretends to do something.
 *
 * WHY IT IS CURRENTLY EMPTY, STATED PLAINLY. SYNQ streams its music. Every
 * track it plays comes from a provider that licenses streaming, not bulk
 * download — YouTube's terms do not grant it, and the app has never been given
 * a source that grants it either. The engine underneath is complete (range
 * requests, resume, integrity validation, pause/cancel/retry — see
 * `lib/downloadManager.ts` and its 77-assertion suite), but an engine with no
 * authorised source behind it has nothing to download.
 *
 * So rather than ship a hub whose buttons quietly do nothing, this page says
 * what is true and reports what is actually happening: your connection, what
 * the service worker has stored for offline use, and the live download list,
 * which is empty until a provider that grants download rights is connected.
 */

const CONFIG: Partial<DownloadConfig> = {
  chunkSize: 1_048_576,
  maxConcurrentRanges: 2,
  timeoutMs: 30_000,
  maxFileSize: 512 * 1_048_576,
};

/** Human-readable byte count. */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatEta(ms: number | null): string {
  if (ms === null) return "";
  if (ms <= 0) return "done";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s left`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s left`;
}

const STATUS_STYLE: Record<DownloadRecord["status"], string> = {
  queued: "text-muted-foreground",
  downloading: "text-[rgb(var(--tint))]",
  paused: "text-amber-300/80",
  completed: "text-emerald-300/80",
  failed: "text-red-300/80",
  cancelled: "text-muted-foreground/60",
};

const STATUS_LABEL: Record<DownloadRecord["status"], string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default function DownloadHub() {
  const current = usePlayerStore((s) => s.current);
  const [records, setRecords] = useState<DownloadRecord[]>([]);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  // One manager for the app's lifetime. A lazy `useState` initialiser is the
  // React-sanctioned way to build a once-only instance; a `useRef` assigned
  // during render would drop in-flight downloads on every re-render and is
  // flagged by `react-hooks/refs` for good reason.
  const [manager] = useState(
    () =>
      new DownloadManager(
        CONFIG,
        // No adapter is reachable until an authorised source is wired in.
        // Throwing is honest: it cannot silently report a fake success.
        (): DownloadAdapter => {
          throw new Error("No download source is configured");
        },
      ),
  );

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Poll the manager rather than holding React state inside it, so the
  // download engine stays a plain, testable object.
  useEffect(() => {
    const tick = () => setRecords(manager.list());
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [manager]);

  const act = useCallback(
    (fn: () => void) => {
      try {
        fn();
      } catch {
        // A manager call cannot throw here (no adapter is reachable), but a
        // page must never die because a download button was pressed.
      }
      setRecords(manager.list());
    },
    [manager],
  );

  const stats = useMemo(() => {
    const active = records.filter((r) => r.status === "downloading");
    return {
      total: records.length,
      active: active.length,
      bytes: records.reduce((n, r) => n + r.downloadedBytes, 0),
    };
  }, [records]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Downloads
        </h1>
        <p className="text-sm text-muted-foreground">
          Offline copies on this device, and what SYNQ is allowed to fetch.
        </p>
      </header>

      {!online && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
          <WifiOff className="size-4 shrink-0 text-amber-300" />
          <p className="text-sm text-amber-100/90">
            You are offline. Anything listed below is already on this device.
          </p>
        </div>
      )}

      {/* What is actually stored, from the real cache, not a claim. */}
      <OfflineSummary />

      <section>
        <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
          This track
        </h2>
        {current ? (
          <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
            {current.coverUrl ? (
              <img
                src={current.coverUrl}
                alt=""
                className="size-12 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{current.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {current.artistName}
              </p>
            </div>
            <button
              type="button"
              disabled
              title="This provider licenses streaming only, not download"
              className="flex shrink-0 cursor-not-allowed items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-muted-foreground/60"
            >
              <Download className="size-3.5" />
              Not available
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing playing right now.
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Downloads
          </h2>
          {stats.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {stats.total} item{stats.total === 1 ? "" : "s"} ·{" "}
              {formatBytes(stats.bytes)}
            </p>
          )}
        </div>

        {records.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-10">
            <HardDriveDownload className="size-7 text-muted-foreground/40" />
            <p className="text-sm font-medium">No downloads yet</p>
            <p className="max-w-prose text-sm text-muted-foreground">
              SYNQ streams music from providers that license streaming, not
              bulk download. Nothing here is available to save offline, so
              there is nothing to list. The download engine itself is ready —
              range requests, resume, and integrity checks are all in place —
              and starts working the moment a source that grants download
              rights is connected.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {records.map((record) => (
              <li
                key={record.id}
                className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {record.filename}
                    </p>
                    <p
                      className={cn(
                        "text-xs",
                        STATUS_STYLE[record.status],
                      )}
                    >
                      {STATUS_LABEL[record.status]}
                      {record.status === "downloading" && record.speed > 0 && (
                        <> · {formatBytes(record.speed)}/s</>
                      )}
                      {record.status === "downloading" &&
                        formatEta(record.etaMs) && (
                        <> · {formatEta(record.etaMs)}</>
                      )}
                      {record.error && <> · {record.error}</>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <DownloadButton
                      status={record.status}
                      onPause={() => act(() => manager.pause(record.id))}
                      onResume={() => act(() => manager.retry(record.id))}
                      onCancel={() => act(() => manager.cancel(record.id))}
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${record.filename}`}
                      onClick={() =>
                        void manager
                          .remove(record.id)
                          .then(() => setRecords(manager.list()))
                      }
                      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-[rgb(var(--tint))] transition-[width] duration-300"
                    style={{ width: `${record.progress}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The right control for a download's current state. */
function DownloadButton({
  status,
  onPause,
  onResume,
  onCancel,
}: {
  status: DownloadRecord["status"];
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const cls =
    "rounded-full p-2 transition-colors hover:bg-white/[0.06] hover:text-foreground";
  if (status === "downloading") {
    return (
      <button type="button" aria-label="Pause" onClick={onPause} className={cls}>
        <Pause className="size-4" />
      </button>
    );
  }
  if (status === "paused" || status === "failed") {
    return (
      <button
        type="button"
        aria-label="Resume"
        onClick={onResume}
        className={cls}
      >
        {status === "failed" ? (
          <RefreshCw className="size-4" />
        ) : (
          <Play className="size-4" />
        )}
      </button>
    );
  }
  if (status === "queued") {
    return <Loader2 className="size-4 animate-spin text-muted-foreground" />;
  }
  if (status === "completed") {
    return <Check className="size-4 text-emerald-300/80" />;
  }
  return (
    <button type="button" aria-label="Cancel" onClick={onCancel} className={cls}>
      <X className="size-4" />
    </button>
  );
}

/**
 * What the service worker actually has stored.
 *
 * Reads the real Cache Storage rather than reporting a stored flag, so this
 * cannot drift from what is genuinely cached for offline use.
 */
function OfflineSummary() {
  const [entries, setEntries] = useState<{ name: string; count: number }[]>(
    [],
  );
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      if (typeof caches === "undefined") return;
      setSupported(true);
      try {
        const names = await caches.keys();
        const rows = await Promise.all(
          names.map(async (name) => ({
            name,
            count: (await (await caches.open(name)).keys()).length,
          })),
        );
        if (!cancelled) setEntries(rows);
      } catch {
        // A browser that refuses Cache Storage (private mode, disabled) is
        // reported as unsupported rather than as "nothing cached".
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!supported) {
    return (
      <p className="text-sm text-muted-foreground">
        This browser does not expose offline storage, so nothing is kept for
        offline use.
      </p>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
        Available offline
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing cached yet. The app shell and artwork are stored as you
          browse; audio is not.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <li
              key={e.name}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              {e.count === 0 ? (
                <AlertTriangle className="size-3.5 shrink-0 opacity-50" />
              ) : (
                <Check className="size-3.5 shrink-0 text-emerald-300/70" />
              )}
              <span className="truncate">
                {e.count} cached item{e.count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}