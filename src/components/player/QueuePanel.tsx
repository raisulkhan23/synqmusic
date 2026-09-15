import { Reorder } from "framer-motion";
import { useMutation } from "convex/react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Equalizer } from "@/components/player/Equalizer";
import { api } from "@/convex/_generated/api";
import { formatTime } from "@/lib/format";
import { albumById, similarTracks } from "@/lib/catalog";
import { coverArt } from "@/lib/covers";
import { usePlayerStore } from "@/store/player";
import {
  ArrowLeftRight,
  Clock3,
  GripVertical,
  ListMusic,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function QueuePanel() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = usePlayerStore((s) => s.setQueueOpen);
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playIndex = usePlayerStore((s) => s.playIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const undoRemoveFromQueue = usePlayerStore((s) => s.undoRemoveFromQueue);
  const replaceUpcoming = usePlayerStore((s) => s.replaceUpcoming);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const history = usePlayerStore((s) => s.history);
  const playFromHistory = usePlayerStore((s) => s.playFromHistory);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const smartShuffle = usePlayerStore((s) => s.smartShuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const toggleSmartShuffle = usePlayerStore((s) => s.toggleSmartShuffle);
  const autoplay = usePlayerStore((s) => s.autoplay);
  const toggleAutoplay = usePlayerStore((s) => s.toggleAutoplay);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const createPlaylist = useMutation(api.playlists.create);
  const addPlaylistTrack = useMutation(api.playlists.addTrack);

  const upcoming = queueIndex >= 0 ? queue.slice(queueIndex + 1) : queue;
  // Reorder needs UNIQUE values — the queue can legitimately contain the same
  // track twice, and duplicate values make Framer Motion stack rows on top of
  // each other. Composite "id#index" values keep every row distinct.
  const upcomingKeys = upcoming.map((t, i) => `${t.id}#${i}`);

  // Queue suggestions: similar to what's playing, not already queued.
  const suggestions = (() => {
    const seed = current?.catalogTrack?.id;
    if (!seed || upcoming.length >= 15) return [];
    return similarTracks(seed, 12)
      .filter((t) => !queue.some((q) => q.catalogTrack?.id === t.id))
      .slice(0, 3);
  })();

  const saveQueueAsPlaylist = async () => {
    const ids = queue
      .map((t) => t.catalogTrack?.id)
      .filter((id): id is string => !!id);
    if (ids.length === 0) {
      toast.error("Queue has no catalog songs to save");
      return;
    }
    try {
      const name = `Queue · ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
      const playlistId = await createPlaylist({ name, description: "Saved from your queue" });
      for (const trackId of ids) {
        await addPlaylistTrack({ playlistId, trackId });
      }
      toast.success(`Saved ${ids.length} songs as "${name}"`);
    } catch {
      toast.error("Couldn't save the queue as a playlist");
    }
  };

  const handleReorder = (keys: string[]) => {
    const byKey = new Map(upcoming.map((t, i) => [upcomingKeys[i], t]));
    const reordered = keys
      .map((k) => byKey.get(k))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    replaceUpcoming(reordered);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full border-l border-white/[0.08] bg-[#0e0f15]/95 p-0 backdrop-blur-2xl sm:max-w-md"
      >
        <SheetHeader className="flex flex-row items-center justify-between border-b border-white/[0.06] py-4 pr-12 pl-5">
          <SheetTitle className="flex items-center gap-2 font-display text-base">
            <ListMusic className="size-4 text-[rgb(var(--tint))]" />
            Queue
          </SheetTitle>
          <div className="flex items-center gap-1">
            {/* smart shuffle */}
            <button
              type="button"
              aria-label="Smart shuffle"
              title={smartShuffle ? "Smart shuffle on" : "Smart shuffle off"}
              onClick={() => {
                toggleSmartShuffle();
                toast(smartShuffle ? "Smart shuffle off" : "Smart shuffle on — avoids repeats");
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
                smartShuffle
                  ? "bg-[rgb(var(--tint)_/_0.15)] text-[rgb(var(--tint))]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Sparkles className="size-3.5" />
              Smart
            </button>
            {/* plain shuffle */}
            <button
              type="button"
              aria-label="Shuffle"
              title={shuffle ? "Shuffle on" : "Shuffle off"}
              onClick={() => {
                toggleShuffle();
                toast(shuffle ? "Shuffle off" : "Shuffle on");
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
                shuffle
                  ? "bg-[rgb(var(--tint)_/_0.15)] text-[rgb(var(--tint))]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <ArrowLeftRight className="size-3.5" />
            </button>
            {/* autoplay similar music */}
            <button
              type="button"
              aria-label="Autoplay similar music"
              title={autoplay ? "Autoplay on — similar music plays when the queue ends" : "Autoplay off"}
              onClick={() => {
                toggleAutoplay();
                toast(autoplay ? "Autoplay off" : "Autoplay on — similar music when queue ends");
              }}
              className={cn(
                "flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors",
                autoplay
                  ? "bg-[rgb(var(--tint)_/_0.15)] text-[rgb(var(--tint))]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Sparkles className="size-3.5" />
              Auto
            </button>
            {/* save queue as playlist */}
            {queue.length > 1 && (
              <button
                type="button"
                aria-label="Save queue as playlist"
                title="Save queue as playlist"
                onClick={() => void saveQueueAsPlaylist()}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <Save className="size-3.5" />
                Save
              </button>
            )}
            {queue.length > 1 && (
              <button
                type="button"
                onClick={clearQueue}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              >
                <Trash2 className="size-3.5" />
                Clear
              </button>
            )}
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-4">
          {current ? (
            <section className="rounded-xl bg-white/[0.04] p-3">
              <p className="px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Now playing
              </p>
              <div className="flex items-center gap-3">
                <img
                  src={current.coverUrl}
                  alt=""
                  className="size-11 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{current.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {current.artistName}
                  </p>
                </div>
                {isPlaying && <Equalizer className="shrink-0" />}
              </div>
            </section>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <ListMusic className="size-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Nothing in the queue yet.
                <br />
                Press play on any track to get started.
              </p>
            </div>
          )}

          {upcoming.length > 0 && (
            <section className="min-h-0">
              <p className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <Clock3 className="size-3" />
                Playing next · {upcoming.length}
              </p>
              <Reorder.Group
                axis="y"
                values={upcomingKeys}
                onReorder={handleReorder}
                layoutScroll
                className="space-y-1"
              >
                {upcoming.map((track, rowIndex) => (
                  <Reorder.Item
                    key={`${track.id}#${rowIndex}`}
                    value={upcomingKeys[rowIndex]}
                    className="group flex cursor-grab items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.05] active:cursor-grabbing"
                  >
                    <GripVertical className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
                    <img
                      src={track.coverUrl}
                      alt=""
                      className="size-10 shrink-0 rounded-md object-cover"
                    />
                    <div
                      className="min-w-0 flex-1"
                      onClick={() => playIndex(queueIndex + 1 + rowIndex)}
                    >
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.artistName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                      {formatTime(track.duration)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${track.title} from queue`}
                      onClick={() => {
                        removeFromQueue(queueIndex + 1 + rowIndex);
                        toast("Removed from queue", {
                          action: {
                            label: "Undo",
                            onClick: () => undoRemoveFromQueue(),
                          },
                        });
                      }}
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </section>
          )}

          {/* queue suggestions — "we think you'll like these next" */}
          {suggestions.length > 0 && (
            <section>
              <p className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <Sparkles className="size-3" />
                Suggested for the queue
              </p>
              <div className="space-y-1">
                {suggestions.map((track) => (
                  <div
                    key={track.id}
                    className="group flex items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.05]"
                  >
                    <img
                      src={coverArt(albumById(track.albumId))}
                      alt=""
                      className="size-10 shrink-0 rounded-md object-cover opacity-80"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        Because it&apos;s playing now
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Add ${track.title} to queue`}
                      onClick={() => {
                        addToQueue(track);
                        toast.success(`Added "${track.title}" to queue`);
                      }}
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* queue history — what you previously played, excluding anything
              still in the current queue so the two lists never mix */}
          {(() => {
            const queuedIds = new Set(queue.map((t) => t.id));
            if (current) queuedIds.add(current.id);
            const recent = history.filter((t) => !queuedIds.has(t.id)).slice(0, 10);
            if (recent.length === 0) return null;
            return (
            <section className="min-h-0 border-t border-white/[0.07] pt-4">
              <p className="flex items-center gap-1.5 px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <Undo2 className="size-3" />
                Recently played
              </p>
              <div className="space-y-1">
                {recent.map((track, i) => (
                  <div
                    key={`${track.id}-${i}`}
                    className="group flex items-center gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-white/[0.05]"
                  >
                    <Clock3 className="size-4 shrink-0 text-muted-foreground/40" />
                    <img
                      src={track.coverUrl}
                      alt=""
                      className="size-10 shrink-0 rounded-md object-cover"
                    />
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => playFromHistory(history.indexOf(track))}
                    >
                      <p className="truncate text-sm font-medium">{track.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.artistName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">
                      {formatTime(track.duration)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
            );
          })()}
        </div>
      </SheetContent>
    </Sheet>
  );
}