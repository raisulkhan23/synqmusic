import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import {
  applyUpdate,
  getPwaUpdateId,
  getPwaUpdateIdServerSnapshot,
  getPwaUpdateServerSnapshot,
  getPwaUpdateSnapshot,
  manualInstallHint,
  registerServiceWorker,
  subscribePwaUpdate,
  usePwaInstall,
} from "@/lib/pwa";
import { usePlayerStore } from "@/store/player";
import { cn } from "@/lib/utils";

/**
 * Progressive Web App plumbing for the signed-in shell.
 *
 * Two jobs, both deliberately quiet:
 *
 *  - Register the service worker and surface a new version when one is ready.
 *    The reload is NEVER automatic: this is a music player, and swapping the
 *    running code mid-song would cut the track off. An update offered while
 *    something is playing says so and waits for the track to finish.
 *
 *  - Offer "Install SYNQ" once, and remember a dismissal. Re-prompting someone
 *    who already said no is the fastest way to make an install banner feel
 *    like an ad.
 */
export function PwaManager() {
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const current = usePlayerStore((s) => s.current);
  // The waiting-worker state lives in the PWA module, not here: it is external
  // state owned by the browser, and mirroring it into a useState would make
  // the registering effect set state synchronously.
  const updateReady = useSyncExternalStore(
    subscribePwaUpdate,
    getPwaUpdateSnapshot,
    getPwaUpdateServerSnapshot,
  );
  const [deferredWhilePlaying, setDeferredWhilePlaying] = useState(false);
  // Which update was dismissed, rather than a boolean. A later update arrives
  // with a new id and re-opens the banner by itself, which avoids an effect
  // that would have to reset state after every update.
  const [dismissedUpdateId, setDismissedUpdateId] = useState<number | null>(
    null,
  );
  const updateId = useSyncExternalStore(
    subscribePwaUpdate,
    getPwaUpdateId,
    getPwaUpdateIdServerSnapshot,
  );
  const { state, install, dismiss } = usePwaInstall();

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // The listener kept playing and declined the reload. Re-offer once the track
  // is over rather than leaving the update stranded in the background. There is
  // deliberately no setState here: `waitingForTrackEnd` is derived, and the
  // reload this triggers ends the page anyway.
  const waitingForTrackEnd = deferredWhilePlaying && !isPlaying;
  useEffect(() => {
    if (!waitingForTrackEnd) return;
    void applyUpdate({ isPlaying: false, onBlocked: () => undefined });
  }, [waitingForTrackEnd]);

  const onUpdate = useCallback(() => {
    void applyUpdate({
      isPlaying,
      onBlocked: () => {
        setDeferredWhilePlaying(true);
        toast("Update ready", {
          id: "pwa-update-deferred",
          description: "It'll load when this song finishes.",
        });
      },
    });
  }, [isPlaying]);

  const dismissUpdate = useCallback(() => {
    setDismissedUpdateId(updateId);
  }, [updateId]);

  const showUpdate = updateReady && dismissedUpdateId !== updateId;
  const showInstall = state === "ready" || state === "manual";
  if (!showUpdate && !showInstall) return null;

  return (
    <>
      {showUpdate && (
        <div
          role="status"
          className="z-50 flex items-center justify-between gap-3 bg-[rgb(var(--tint))] px-4 py-1.5 text-xs font-semibold text-black"
        >
          <span className="min-w-0 truncate">
            {deferredWhilePlaying
              ? `Update ready — loads after “${current?.title ?? "this track"}”`
              : "A new version of SYNQ is available"}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onUpdate}
              disabled={deferredWhilePlaying}
              className={cn(
                "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                deferredWhilePlaying
                  ? "cursor-not-allowed bg-black/10 text-black/50"
                  : "bg-black/85 text-white hover:bg-black",
              )}
            >
              <RefreshCw className="size-3" />
              Update
            </button>
            <button
              type="button"
              onClick={dismissUpdate}
              aria-label="Dismiss update notice"
              className="rounded-full p-1 transition-colors hover:bg-black/10"
            >
              <X className="size-3.5" />
            </button>
          </span>
        </div>
      )}

      {showInstall && (
        <div className="fixed right-4 bottom-[calc(7rem+env(safe-area-inset-bottom))] z-40 flex max-w-[min(22rem,calc(100vw-2rem))] flex-col items-start gap-2 rounded-2xl border border-white/[0.07] bg-[rgb(18_20_28_/_0.92)] px-4 py-3 shadow-[0_18px_50px_rgb(0_0_0_/_0.45)] backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <img
              src="/icons/icon-192.png"
              alt=""
              width={36}
              height={36}
              className="size-9 shrink-0 rounded-lg"
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Install SYNQ</p>
              <p className="text-xs text-muted-foreground">
                {state === "ready"
                  ? "Launch it in its own window, with the player intact."
                  : manualInstallHint(true)}
              </p>
            </div>
          </div>
          <span className="flex items-center gap-2">
            {state === "ready" && (
              <button
                type="button"
                onClick={() => {
                  void install();
                }}
                className="flex items-center gap-1.5 rounded-full bg-[rgb(var(--tint))] px-3 py-1.5 text-xs font-semibold text-black transition-transform hover:scale-[1.03]"
              >
                <Download className="size-3.5" />
                Install app
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
            >
              Not now
            </button>
          </span>
        </div>
      )}
    </>
  );
}
