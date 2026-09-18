import { useMemo, useState } from "react";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import type { YtItem } from "@/lib/youtube";
import { clearSingleHistoryEntry, readPlayHistory, usePlayerStore, type HistoryEntry } from "@/store/player";
import { Dices, History, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

const FILTERS = ["All", "Today", "This week"] as const;

function timeAgo(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function entryToItem(h: HistoryEntry): YtItem {
  return {
    id: h.youtubeId ?? h.id,
    title: h.title,
    artist: h.artistName,
    duration: h.duration,
    thumbnail: h.coverUrl,
  };
}

export default function Recent() {
  const [historyVersion, setHistoryVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read history when an entry is removed
  const history = useMemo(() => readPlayHistory(), [historyVersion]);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const searchYt = useAction(api.youtube.searchYoutube);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const now = Date.now();
    return history.filter((h) => {
      if (filter === "Today" && (!h.at || now - h.at > 86400_000)) return false;
      if (filter === "This week" && (!h.at || now - h.at > 7 * 86400_000)) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          h.title.toLowerCase().includes(q) || h.artistName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [history, filter, query]);

  const items = filtered.map(entryToItem);

  const play = (item: YtItem, rest: YtItem[]) => {
    const entry = history.find((h) => (h.youtubeId ?? h.id) === item.id);
    if (entry?.audioUrl) {
      playTrack(snapshotToPlayable(entry), rest.filter((r) => r.id !== item.id).map(toPlayableFromItem));
      return;
    }
    setResolvingId(item.id);
    const primaryArtist = item.artist.split(",")[0]?.trim() ?? item.artist;
    searchYt({ query: `${item.title} ${primaryArtist}` })
      .then(({ items: found }) => {
        const best = found.find((f) => f.id === item.id) ?? found[0];
        if (!best) {
          toast.error(`Couldn't play "${item.title}"`);
          return;
        }
        playTrack(
          toPlayableYoutube(
            best,
            `https://youtu.be/${best.id}`,
            rest.filter((r) => r.id !== best.id),
          ),
        );
      })
      .catch(() => toast.error("Playback failed — try again"))
      .finally(() => setResolvingId(null));
  };

  const removeFromHistory = (id: string) => {
    clearSingleHistoryEntry(id);
    setHistoryVersion((v) => v + 1);
    toast.success("Removed from recently played");
  };

  // "I'm feeling lucky" — random pick from this history, resolves via live search.
  const feelingLucky = () => {
    if (history.length === 0) {
      toast.error("Play a few songs first — then try your luck");
      return;
    }
    const pick = history[Math.floor(Math.random() * history.length)];
    if (pick.audioUrl) {
      playTrack(snapshotToPlayable(pick));
      toast.success(`🎲 ${pick.title}`);
      return;
    }
    setResolvingId(pick.youtubeId ?? pick.id);
    const primaryArtist = pick.artistName.split(",")[0]?.trim() ?? pick.artistName;
    searchYt({ query: `${pick.title} ${primaryArtist}` })
      .then(({ items: found }) => {
        const best = found.find((f) => f.id === pick.youtubeId) ?? found[0];
        if (!best) {
          toast.error("Couldn't find a playable version");
          return;
        }
        playTrack(toPlayableYoutube(best, `https://youtu.be/${best.id}`, []));
        toast.success(`🎲 ${best.title}`);
      })
      .catch(() => toast.error("Playback failed — try again"))
      .finally(() => setResolvingId(null));
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display flex items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
            <History className="size-6 text-[rgb(var(--tint))]" />
            Recently Played
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everything you've listened to, most recent first.
          </p>
        </div>
        <button
          type="button"
          onClick={feelingLucky}
          className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-2.5 text-sm font-semibold transition-all hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
        >
          <Dices className="size-4 text-[rgb(var(--tint))]" />
          I'm feeling lucky
          {resolvingId && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
              filter === f
                ? "bg-[rgb(var(--tint))] text-black"
                : "bg-white/[0.05] text-muted-foreground hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter this history…"
          className="ml-auto w-48 rounded-full border border-white/[0.08] bg-white/[0.04] px-4 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-[rgb(var(--tint)_/_0.5)]"
        />
      </div>

      {history.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-10 text-center">
          <History className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-3 font-display text-lg font-semibold">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Songs you play will show up here with when you last heard them.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-8 text-center text-sm text-muted-foreground">
          No plays match this filter.
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => {
            const entry = filtered[i];
            return (
              <div key={`${item.id}-${i}`} className="relative">
                <RemoteTrackRow
                  item={item}
                  index={i + 1}
                  onPlay={(it) => play(it, items)}
                  resolving={resolvingId === item.id}
                  source="youtube"
                  trailing={
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-[11px] text-muted-foreground/70 lg:block">
                        {entry.playCount > 1 ? `${entry.playCount} plays · ` : ""}
                        {timeAgo(entry.at)}
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${item.title} from recently played`}
                        title="Remove from recently played"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromHistory(entry.id);
                        }}
                        className="rounded-full p-1.5 text-muted-foreground/70 opacity-0 transition-all group-hover:opacity-100 hover:bg-white/10 hover:text-foreground focus:opacity-100"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                  }
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function snapshotToPlayable(s: HistoryEntry): Playable {
  return {
    id: s.id,
    title: s.title,
    artistName: s.artistName,
    albumName: s.albumName,
    coverUrl: s.coverUrl,
    duration: s.duration,
    source: s.source,
    youtubeId: s.youtubeId,
    audioUrl: s.audioUrl,
  };
}

function toPlayableFromItem(item: YtItem): Playable {
  return toPlayableYoutube(item, `https://youtu.be/${item.id}`, []);
}
