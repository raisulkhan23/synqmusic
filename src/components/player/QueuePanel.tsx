import { Reorder } from "framer-motion";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Equalizer } from "@/components/player/Equalizer";
import { formatTime } from "@/lib/format";
import { toPlayableYoutube } from "@/lib/playable";
import { usePlayerStore } from "@/store/player";
import { GripVertical, ListMusic, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export function QueuePanel() {
  const open = usePlayerStore((s) => s.queueOpen);
  const setOpen = usePlayerStore((s) => s.setQueueOpen);
  const current = usePlayerStore((s) => s.current);
  const queue = usePlayerStore((s) => s.queue);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playIndex = usePlayerStore((s) => s.playIndex);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const replaceUpcoming = usePlayerStore((s) => s.replaceUpcoming);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  const replaceCurrentStream = usePlayerStore((s) => s.replaceCurrentStream);

  const upcoming = queueIndex >= 0 ? queue.slice(queueIndex + 1) : queue;
  const upcomingIds = upcoming.map((t) => t.id);

  const handleReorder = (ids: string[]) => {
    const byId = new Map(upcoming.map((t) => [t.id, t]));
    const reordered = ids
      .map((id) => byId.get(id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    replaceUpcoming(reordered);
  };

  // Sources play through the YouTube IFrame engine, so switching is just a
  // matter of loading a different video id — no stream resolution needed.
  const switchSource = (videoId: string) => {
    const track = usePlayerStore.getState().current;
    if (!track || track.source !== "youtube") return;
    const alternatives = track.alternatives ?? [];
    const alt = alternatives.find((a) => a.id === videoId);
    if (!alt) return;
    replaceCurrentStream(toPlayableYoutube(alt, alt.id, alternatives));
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
          <div className="flex items-center gap-2">
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

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
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
                {current.source === "youtube" &&
                  (current.alternatives?.length ?? 0) > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Switch source"
                          title="Switch source"
                          className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                        >
                          <RefreshCw className="size-3" />
                          Source
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-64">
                        {current.alternatives?.map((alt) => (
                          <DropdownMenuItem
                            key={alt.id}
                            onSelect={() => switchSource(alt.id)}
                            className="gap-2"
                          >
                            <img
                              src={alt.thumbnail}
                              alt=""
                              className="size-8 shrink-0 rounded object-cover"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-medium">
                                {alt.title}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {alt.artist} · {formatTime(alt.duration)}
                              </span>
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
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
              <p className="px-1 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                Next up · {upcoming.length}
              </p>
              <Reorder.Group
                axis="y"
                values={upcomingIds}
                onReorder={handleReorder}
                className="space-y-1"
              >
                {upcoming.map((track) => (
                  <Reorder.Item
                    key={track.id}
                    value={track.id}
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
                      onClick={() => playIndex(queueIndex + 1 + upcoming.indexOf(track))}
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
                      onClick={() =>
                        removeFromQueue(queueIndex + 1 + upcoming.indexOf(track))
                      }
                      className="shrink-0 rounded-full p-1.5 text-muted-foreground/60 transition-colors hover:bg-white/10 hover:text-foreground"
                    >
                      <X className="size-3.5" />
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>
            </section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}