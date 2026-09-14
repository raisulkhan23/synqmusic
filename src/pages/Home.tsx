import { motion } from "framer-motion";
import { Link } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { greeting } from "@/lib/format";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import type { YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import {
  readLastPlayed,
  readPlayHistory,
  type HistoryEntry,
  type LastPlayedSnapshot,
} from "@/store/player";
import { isPlayable } from "@/lib/playable";
import { useAction, useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import {
  Compass,
  Dices,
  Disc3,
  Flame,
  Heart,
  ListMusic,
  Play,
  Radio,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";

type RemoteMap = Record<string, YtItem[] | undefined>;

export default function Home() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const playlists = useQuery(api.playlists.myPlaylists);
  const spotifyChart = useAction(api.spotify.spotifyChart);
  const searchYt = useAction(api.youtube.searchYoutube);

  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Songs of the week — global chart, streamed live.
  const [trending, setTrending] = useState<YtItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    spotifyChart({})
      .then(({ items }) => {
        if (!cancelled) setTrending(items);
      })
      .catch(() => {
        if (!cancelled) setTrending([]);
      });
    return () => {
      cancelled = true;
    };
  }, [spotifyChart]);

  const playTrending = (item: YtItem) => {
    setResolvingId(item.id);
    const primaryArtist = item.artist.split(",")[0]?.trim() ?? item.artist;
    searchYt({ query: `${item.title} ${primaryArtist}` })
      .then(({ items }) => {
        const best = items[0];
        if (!best) {
          toast.error(`Couldn't load "${item.title}" — try another song`);
          return;
        }
        const playable = {
          ...toPlayableYoutube(item, `https://youtu.be/${best.id}`, items.slice(1)),
          youtubeId: best.id,
        };
        playTrack(playable);
      })
      .catch(() => {
        toast.error("Playback failed — try again in a moment");
      })
      .finally(() => {
        setResolvingId(null);
      });
  };

  // Continue listening — the true last-played track from any source.
  const [lastPlayed, setLastPlayed] = useState<LastPlayedSnapshot | null>(null);
  useEffect(() => {
    setLastPlayed(readLastPlayed());
  }, []);
  const continueTrack: Playable | null = useMemo(
    () => (lastPlayed && isPlayableSource(lastPlayed) ? snapshotToPlayable(lastPlayed) : null),
    [lastPlayed],
  );

  // Cross-source play history (all sources alike).
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    setHistory(readPlayHistory());
  }, [lastPlayed]);

  const historyItems: YtItem[] = useMemo(
    () =>
      history.map((h) => ({
        id: h.youtubeId ?? h.id,
        title: h.title,
        artist: h.artistName,
        duration: h.duration,
        thumbnail: h.coverUrl,
      })),
    [history],
  );
  const mostPlayedItems: YtItem[] = useMemo(
    () =>
      [...historyItems].sort((a, b) => {
        const ca = history.find((h) => (h.youtubeId ?? h.id) === a.id)?.playCount ?? 0;
        const cb = history.find((h) => (h.youtubeId ?? h.id) === b.id)?.playCount ?? 0;
        return cb - ca;
      }),
    [historyItems, history],
  );
  const jumpBackItems = useMemo(() => historyItems.slice(1, 6), [historyItems]);

  // --- live remote fills for every section -----------------------------------
  const timeLabel = timeOfDayLabel();
  const season = seasonLabel();
  const continueArtistName = lastPlayed?.artistName.split(",")[0]?.trim() ?? "";
  const favArtist = mostPlayedItems[0]?.artist.split(",")[0]?.trim();

  const remoteQueries = useMemo(() => {
    const q: Array<{ key: string; query: string; fallback?: string }> = [
      { key: "discover", query: "new music friday", fallback: "fresh music this week" },
      { key: "radar", query: "new releases this week", fallback: "new songs this week" },
      { key: "topTracks", query: "top hits right now", fallback: "top hits" },
      { key: "newReleases", query: "new songs just released", fallback: "latest hits" },
    ];
    if (continueTrack) {
      q.push({
        key: "because",
        query: `songs similar to ${continueTrack.title} ${continueArtistName}`.trim(),
      });
    }
    if (favArtist) q.push({ key: "artists", query: `${favArtist} songs` });
    q.push({ key: "timeOfDay", query: `${timeLabel} music hits` });
    q.push({ key: "seasonal", query: `${season} hits` });
    return q;
  }, [continueTrack?.title, continueArtistName, timeLabel, season, favArtist]); // eslint-disable-line react-hooks/exhaustive-deps

  const [remote, setRemote] = useState<RemoteMap>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    // Fetch all sections in parallel; each falls back to a second query when
    // the first returns nothing, so sections never sit empty.
    (async () => {
      await Promise.all(
        remoteQueries.map(async ({ key, query, fallback }) => {
          if (cancelled || fetchedRef.current.has(key)) return;
          fetchedRef.current.add(key);
          for (const q of [query, fallback]) {
            if (!q) continue;
            try {
              const { items } = await searchYt({ query: q });
              if (cancelled) return;
              if (items.length > 0) {
                setRemote((prev) => ({ ...prev, [key]: items.slice(0, 6) }));
                return;
              }
            } catch {
              // try the fallback, then leave the section empty
            }
          }
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [remoteQueries, searchYt]);

  const playRemoteItem = (item: YtItem, rest: YtItem[]) => {
    playTrack(
      toPlayableYoutube(item, `https://youtu.be/${item.id}`, rest.filter((r) => r.id !== item.id)),
    );
  };

  // "Play something random" — random seed, random pick.
  const surpriseSeeds = [
    "indie pop", "synthwave", "lo-fi beats", "alternative rock", "dream pop",
    "electronic", "jazz", "funk", "soul", "ambient", "hip hop", "reggae",
    "classic rock", "house", "techno", "r&b", "folk", "punk", "k-pop",
    "afrobeats", "latin", "country", "metal", "disco", "blues",
  ];
  const [surprising, setSurprising] = useState(false);
  const surpriseMe = () => {
    if (surprising) return;
    setSurprising(true);
    const seed = surpriseSeeds[Math.floor(Math.random() * surpriseSeeds.length)];
    searchYt({ query: seed })
      .then(({ items }) => {
        const pool = items.filter((i) => i.duration > 0);
        if (pool.length > 0) {
          const pick = pool[Math.floor(Math.random() * pool.length)];
          playTrack(
            toPlayableYoutube(pick, `https://youtu.be/${pick.id}`, pool.filter((p) => p.id !== pick.id)),
          );
          toast.success(`🎲 Now playing: ${pick.title} — ${pick.artist}`);
        } else {
          toast.error("No results — try again");
        }
      })
      .catch(() => {
        toast.error("Couldn't reach our music sources — try again");
      })
      .finally(() => {
        setSurprising(false);
      });
  };

  const quickLinks = [
    {
      to: "/liked",
      label: "Liked Songs",
      detail: likedLoaded ? `${likedCount} ${likedCount === 1 ? "song" : "songs"}` : "…",
      icon: Heart,
    },
    {
      to: "/playlists",
      label: "Playlists",
      detail: playlists === undefined ? "…" : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`,
      icon: ListMusic,
    },
    {
      to: "/search",
      label: "Search",
      detail: "Find any song across our sources",
      icon: Search,
    },
  ];

  const artistTrendList = useMemo(() => artistTrend(historyItems), [historyItems]);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the world is listening to — streamed live from our global music sources.
        </p>
      </header>

      {/* continue listening + surprise me */}
      {(continueTrack || likedLoaded) && (
        <section className="flex flex-wrap items-center gap-3">
          {continueTrack && (
            <button
              type="button"
              onClick={() => playTrack(continueTrack)}
              className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-3 text-left transition-all hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))] transition-transform group-hover:scale-105">
                <Play className="size-4 fill-current" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                  Continue listening
                </span>
                <span className="block truncate font-display text-[15px] font-semibold">
                  {continueTrack.title}
                </span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={surpriseMe}
            className="flex items-center gap-2 rounded-2xl border border-white/[0.07] bg-white/[0.03] px-5 py-3 text-sm font-semibold transition-all hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
          >
            <Dices className={cn("size-4 text-[rgb(var(--tint))]", surprising && "animate-pulse")} />
            Play something random
          </button>
        </section>
      )}

      {/* personal quick links */}
      <section className={cn("stagger grid gap-3", quickLinks.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
        {quickLinks.map(({ to, label, detail, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 transition-all hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))] transition-transform group-hover:scale-105">
              <Icon className="size-[18px]" />
            </span>
            <p className="mt-3 font-display text-[15px] font-semibold">{label}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
          </Link>
        ))}
      </section>

      {/* Songs of the week — global chart */}
      <RemoteSection
        title="Songs of the week"
        subtitle="The most-played songs across the globe right now."
        icon={<Flame className="size-5 text-[rgb(var(--tint))]" />}
        items={trending ?? undefined}
      >
        {(items) =>
          items.slice(0, 8).map((item, i) => (
            <RemoteTrackRow
              key={item.id}
              item={item}
              index={i + 1}
              onPlay={playTrending}
              resolving={resolvingId === item.id}
              source="spotify"
            />
          ))
        }
      </RemoteSection>

      <RemoteSection
        title="Today's top tracks"
        subtitle="The biggest songs right now, streamed live."
        items={remote.topTracks}
      >
        {(items) =>
          items.slice(0, 8).map((item, i) => (
            <RemoteTrackRow
              key={item.id}
              item={item}
              index={i + 1}
              onPlay={(it) => playRemoteItem(it, items)}
              resolving={resolvingId === item.id}
              source="youtube"
            />
          ))
        }
      </RemoteSection>

      <RemoteSection
        title="New releases"
        subtitle="Fresh songs just dropped, streamed live."
        items={remote.newReleases}
      >
        {(items) => <RemoteRows items={items} max={6} onPlay={playRemoteItem} resolvingId={resolvingId} />}
      </RemoteSection>

      {/* Jump Back In — your cross-source history */}
      {jumpBackItems.length >= 2 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
                Jump back in
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Pick up where you left off — from any source.
              </p>
            </div>
          </div>
          <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {jumpBackItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => playRemoteItem(item, jumpBackItems)}
                className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2.5 text-left transition-all hover:border-[rgb(var(--tint)_/_0.35)] hover:bg-white/[0.05]"
              >
                <img
                  src={item.thumbnail}
                  alt=""
                  className="size-11 shrink-0 rounded-md object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.artist}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      <RemoteSection
        title="Discover Weekly"
        subtitle="A fresh mix every week, matched just for you."
        icon={<Compass className="size-5 text-[rgb(var(--tint))]" />}
        items={remote.discover}
      >
        {(items) => <RemoteRows items={items} max={6} onPlay={playRemoteItem} resolvingId={resolvingId} />}
      </RemoteSection>

      <RemoteSection
        title="Release Radar"
        subtitle="The newest releases, matched to your taste."
        icon={<Radio className="size-5 text-[rgb(var(--tint))]" />}
        items={remote.radar}
      >
        {(items) => <RemoteRows items={items} onPlay={playRemoteItem} resolvingId={resolvingId} />}
      </RemoteSection>

      {/* Because you listened to... */}
      {continueTrack && (
        <RemoteSection
          title={`Because you listened to ${continueTrack.title}`}
          subtitle="More like this, matched live to what you love."
          icon={<Sparkles className="size-5 text-[rgb(var(--tint))]" />}
          items={remote.because}
        >
          {(items) => <RemoteRows items={items} onPlay={playRemoteItem} resolvingId={resolvingId} />}
        </RemoteSection>
      )}

      {/* Time of day + seasonal side-by-side */}
      {(remote.timeOfDay || remote.seasonal) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {remote.timeOfDay && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <h3 className="font-display flex items-center gap-2 text-base font-bold tracking-tight">
                <Sun className="size-4 text-[rgb(var(--tint))]" />
                {capitalize(timeLabel)}
              </h3>
              <RemoteRows
                items={remote.timeOfDay}
                max={4}
                onPlay={playRemoteItem}
                resolvingId={resolvingId}
                className="mt-2"
              />
            </div>
          )}
          {remote.seasonal && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <h3 className="font-display flex items-center gap-2 text-base font-bold tracking-tight">
                <Disc3 className="size-4 text-[rgb(var(--tint))]" />
                Sounds of {capitalize(season)}
              </h3>
              <RemoteRows
                items={remote.seasonal}
                max={4}
                onPlay={playRemoteItem}
                resolvingId={resolvingId}
                className="mt-2"
              />
            </div>
          )}
        </section>
      )}

      {/* Trending artists — from your plays, live */}
      {artistTrendList.length >= 2 && (
        <section>
          <div className="mb-3">
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Trending artists
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Who you&apos;ve been playing the most.
            </p>
          </div>
          <div className="slider-rail -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {artistTrendList.slice(0, 8).map(({ artist, items }) => (
              <button
                key={artist}
                type="button"
                onClick={() => {
                  if (items[0]) playRemoteItem(items[0], items);
                }}
                className="group w-28 shrink-0 text-left"
              >
                <img
                  src={items[0]?.thumbnail ?? ""}
                  alt=""
                  className="aspect-square w-full rounded-full object-cover ring-1 ring-white/10 transition-transform duration-300 group-hover:scale-105"
                />
                <p className="mt-2 truncate text-sm font-semibold">{artist}</p>
                <p className="truncate text-xs text-muted-foreground">Artist</p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* most played (personal, cross-source) */}
      {mostPlayedItems.length >= 2 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
                Your most played
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Your real listening history — every source.
              </p>
            </div>
          </div>
          <RemoteRows items={mostPlayedItems} onPlay={playRemoteItem} resolvingId={resolvingId} />
        </section>
      )}

      {/* recently played (personal, cross-source) */}
      {historyItems.length >= 2 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
                Recently played
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Jump back in where you left off — any source.
              </p>
            </div>
          </div>
          <RemoteRows items={historyItems} onPlay={playRemoteItem} resolvingId={resolvingId} />
        </section>
      )}
    </div>
  );
}

// --- section shell -----------------------------------------------------------

/**
 * A section that renders only remote rows. Shows a skeleton
 * while loading and hides itself entirely when there's nothing to show —
 * no catalog fallback anywhere.
 */
function RemoteSection({
  title,
  subtitle,
  icon,
  items,
  children,
}: {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
  items: YtItem[] | undefined;
  children: (items: YtItem[]) => React.ReactNode;
}) {
  if (items === undefined) {
    return (
      <section>
        <SectionHeader title={title} subtitle={subtitle} icon={icon} />
        <div className="mt-1 flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-white/[0.04]" />
          ))}
        </div>
      </section>
    );
  }
  if (items.length === 0) return null;
  return (
    <section>
      <SectionHeader title={title} subtitle={subtitle} icon={icon} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="stagger mt-1 flex flex-col gap-0.5"
      >
        {children(items)}
      </motion.div>
    </section>
  );
}

function SectionHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
        {icon}
        {title}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function RemoteRows({
  items,
  onPlay,
  resolvingId,
  max = 5,
  className = "flex flex-col gap-0.5",
}: {
  items: YtItem[];
  onPlay: (item: YtItem, rest: YtItem[]) => void;
  resolvingId: string | null;
  max?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {items.slice(0, max).map((item, i) => (
        <RemoteTrackRow
          key={item.id}
          item={item}
          index={i + 1}
          onPlay={(it) => onPlay(it, items)}
          resolving={resolvingId === item.id}
          source="youtube"
        />
      ))}
    </div>
  );
}

// --- helpers -----------------------------------------------------------------

function isPlayableSource(snap: LastPlayedSnapshot): boolean {
  return snap.source === "youtube" && !!snap.youtubeId;
}

function snapshotToPlayable(snap: LastPlayedSnapshot): Playable {
  return {
    id: snap.id,
    title: snap.title,
    artistName: snap.artistName,
    albumName: snap.albumName,
    coverUrl: snap.coverUrl,
    duration: snap.duration,
    source: snap.source,
    youtubeId: snap.youtubeId,
    audioUrl: snap.audioUrl,
  };
}

function timeOfDayLabel(): string {
  const h = new Date().getHours();
  if (h < 6) return "late night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}

function seasonLabel(): string {
  const m = new Date().getMonth();
  if (m < 3) return "winter";
  if (m < 6) return "spring";
  if (m < 9) return "summer";
  return "fall";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Group history items by artist name, sorted by entry count, for "Trending artists".
function artistTrend(items: YtItem[]): Array<{ artist: string; items: YtItem[] }> {
  const byArtist = new Map<string, YtItem[]>();
  for (const item of items) {
    const key = item.artist || "Unknown artist";
    const list = byArtist.get(key) ?? [];
    list.push(item);
    byArtist.set(key, list);
  }
  return [...byArtist.entries()]
    .map(([artist, list]) => ({ artist, items: list }))
    .sort((a, b) => b.items.length - a.items.length);
}
