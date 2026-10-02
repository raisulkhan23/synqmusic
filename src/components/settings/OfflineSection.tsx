import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  HardDrive,
  Loader2,
  Trash2,
  WifiOff,
} from "lucide-react";
import { OFFLINE_ENABLED_KEY, type OfflineEntry } from "@/lib/offlineStore";
import {
  clearDownloads,
  isPersisted,
  readIndex,
  removeDownload,
  totalDownloadedBytes,
} from "@/lib/offlineAudio";
import { formatBytes } from "@/lib/offlineStore";
import { cn } from "@/lib/utils";

/**
 * Settings → App → Offline.
 *
 * Three genuinely different things live here, and they must not be collapsed
 * into one switch:
 *
 *  1. Offline mode (the preference). Persisted locally like every other SYNQ
 *     setting; the worker and the player read it.
 *  2. Storage health. Whether the browser has granted persistent storage, which
 *     is the difference between "your downloads are safe" and "the browser may
 *     delete these without asking" — and the browser is the only party that
 *     knows the answer.
 *  3. The downloads themselves, with real sizes and a real delete.
 *
 * It does NOT offer to download YouTube-sourced tracks. Those streams are not
 * licensed for offline storage, so there is no button to grey out and no
 * amount of caching that would make it legitimate. See `offlineStore.ts`.
 */

function readOfflineMode(): boolean {
  try {
    return localStorage.getItem(OFFLINE_ENABLED_KEY) !== "0";
  } catch {
    return true;
  }
}

function writeOfflineMode(value: boolean): void {
  try {
    localStorage.setItem(OFFLINE_ENABLED_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable — the preference simply will not persist */
  }
}

export function OfflineSection() {
  const [enabled, setEnabled] = useState(readOfflineMode);
  const [entries, setEntries] = useState<OfflineEntry[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    void readIndex().then((rows) => {
      setEntries(rows);
      setLoading(false);
    });
    void isPersisted().then(setPersisted);
  }, []);

  useEffect(refresh, [refresh]);

  const toggle = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      writeOfflineMode(next);
      return next;
    });
  }, []);

  const onRemove = useCallback(
    async (entry: OfflineEntry) => {
      await removeDownload(entry.trackId);
      toast(`Removed "${entry.title}"`, { id: "offline-remove" });
      refresh();
    },
    [refresh],
  );

  const onClear = useCallback(async () => {
    await clearDownloads();
    toast("All downloads removed", { id: "offline-clear" });
    refresh();
  }, [refresh]);

  const used = totalDownloadedBytes(entries);

  return (
    <div className="flex flex-col gap-2">
      {/* 1. the preference */}
      <button
        type="button"
        onClick={toggle}
        role="switch"
        aria-checked={enabled}
        className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
      >
        {enabled ? (
          <Check className="size-4 shrink-0 text-[rgb(var(--tint))]" />
        ) : (
          <WifiOff className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Offline mode</span>
          <span className="block text-xs text-muted-foreground">
            SYNQ opens and stays browsable with no connection. Downloaded tracks
            play without one.
          </span>
        </span>
        <span
          className={cn(
            "flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors",
            enabled ? "bg-[rgb(var(--tint))]" : "bg-white/15",
          )}
        >
          <span
            className={cn(
              "size-4 rounded-full bg-white transition-transform",
              enabled ? "translate-x-4" : "translate-x-0",
            )}
          />
        </span>
      </button>

      {/* 2. storage health — only worth saying when it is a problem */}
      {persisted === false && entries.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2.5 text-xs text-amber-200/90">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          <span>
            Your browser hasn&apos;t marked these downloads as persistent, so it
            may delete them if this device runs low on storage.
          </span>
        </p>
      )}

      {/* 3. the downloads */}
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
        <HardDrive className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="block font-medium">
            {loading
              ? "Checking this device…"
              : entries.length === 0
                ? "Nothing downloaded"
                : `${entries.length} ${entries.length === 1 ? "track" : "tracks"} on this device`}
          </span>
          <span className="block text-xs text-muted-foreground">
            {entries.length === 0
              ? "Creative Commons tracks can be saved for offline listening."
              : `${formatBytes(used)} used`}
          </span>
        </span>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => void onClear()}
            aria-label="Remove all downloads"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      {entries.map((entry) => (
        <div
          key={entry.key}
          className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2"
        >
          {entry.coverUrl ? (
            <img
              src={entry.coverUrl}
              alt=""
              width={36}
              height={36}
              className="size-9 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
              <Download className="size-4 text-muted-foreground" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{entry.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {entry.artistName} · {formatBytes(entry.bytes)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void onRemove(entry)}
            aria-label={`Remove ${entry.title} from this device`}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * A single track's download button, shown on rows whose audio is actually
 * cleared for it.
 *
 * Rendered ONLY for tracks that pass `evaluateDownloadEligibility`. A disabled
 * button on every YouTube row would be worse than no button: it advertises a
 * capability the app deliberately does not have.
 */
export function DownloadTrackButton({
  trackId,
  downloadAllowed,
  licenseUrl,
  title,
  artistName,
  coverUrl,
  duration,
  audioUrl,
  source,
  entries,
  onChanged,
}: {
  trackId: string;
  downloadAllowed: boolean;
  licenseUrl: string;
  title: string;
  artistName: string;
  coverUrl: string;
  duration: number;
  audioUrl: string;
  source: string;
  entries: OfflineEntry[];
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const { downloadTrack } = await import("@/lib/offlineDownloads");
      const result = await downloadTrack({
        trackId,
        title,
        artistName,
        coverUrl,
        duration,
        audioUrl,
        downloadAllowed,
        licenseUrl,
        source,
        entries,
      });
      if (result.ok) {
        toast.success(`Saved "${title}" for offline listening`);
        onChanged?.();
      } else {
        toast.error(result.reason);
      }
    } finally {
      setBusy(false);
    }
  }, [
    trackId,
    title,
    artistName,
    coverUrl,
    duration,
    audioUrl,
    downloadAllowed,
    licenseUrl,
    source,
    entries,
    onChanged,
  ]);

  if (busy) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void start()}
      className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-white/[0.1]"
    >
      <Download className="size-3" />
      Save offline
    </button>
  );
}
