import { motion } from "framer-motion";
import { Link } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { greeting } from "@/lib/format";
import { toPlayableYoutube, type Playable } from "@/lib/playable";

import type { YtItem } from "@/lib/youtube";
import { usePlayerStore, peekResumePosition } from "@/store/player";
import {
  readLastPlayed,
  readPlayHistory,
  type HistoryEntry,
  type LastPlayedSnapshot,
} from "@/store/player";
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
import { useEffect, useMemo, useState } from "react";

type RemoteMap = Record<string, YtItem[] | undefined>;

const DISCOVERY_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const DISCOVERY_REFRESH_KEY = "synq:discovery-refreshed-at";

function markDiscoveryRefreshed() {
  try {
    window.localStorage.setItem(DISCOVERY_REFRESH_KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable in private browsing; the in-memory refresh
    // timer should still keep the current Home session fresh.
  }
}

export default function Home() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const playlists = useQuery(api.playlists.myPlaylists);
  const spotifyChart = useAction(api.spotify.spotifyChart);
  const searchYt = useAction(api.youtube.searchYoutube);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteMap>({});
  const [remoteRefreshToken, setRemoteRefreshToken] = useState(0);

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
  }, [spotifyChart, remoteRefreshToken]);

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
  // Read once during the first render: localStorage isn't reactive, and
  // set-state-in-effect here just triggers a cascading second render.
  const [lastPlayed] = useState<LastPlayedSnapshot | null>(() => readLastPlayed());
  const continueTrack: Playable | null = useMemo(
    () => (lastPlayed && isPlayableSource(lastPlayed) ? snapshotToPlayable(lastPlayed) : null),
    [lastPlayed],
  );

  // Cross-source play history (all sources alike) — read once at mount.
  const [history] = useState<HistoryEntry[]>(() => readPlayHistory());

  // Saved position for the continue-listening card (resume exactly where stopped).
  const continueResume = useMemo(
    () => (continueTrack ? peekResumePosition(continueTrack.id, continueTrack.duration) : 0),
    [continueTrack],
  );

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

  // Remote shelves are live data, so refresh them once per day. The first
  // render always fetches current data; this timestamp makes the cadence
  // survive route changes and browser sessions instead of only living in
  // this mounted Home page.
  useEffect(() => {
    let lastRefresh = 0;
    try {
      lastRefresh = Number(window.localStorage.getItem(DISCOVERY_REFRESH_KEY)) || 0;
    } catch {
      // Ignore unavailable storage and use the in-memory timer below.
    }

    if (!lastRefresh || Date.now() - lastRefresh >= DISCOVERY_REFRESH_INTERVAL) {
      markDiscoveryRefreshed();
    }

    const timer = window.setInterval(() => {
      setRemote({});
      setTrending(null);
      setRemoteRefreshToken((value) => value + 1);
      markDiscoveryRefreshed();
    }, DISCOVERY_REFRESH_INTERVAL);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Fetch all sections in parallel; each falls back to a second query when
    // the first returns nothing, so sections never sit empty.
    (async () => {
      await Promise.all(
        remoteQueries.map(async ({ key, query, fallback }) => {
          if (cancelled) return;
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
  }, [remoteQueries, remoteRefreshToken, searchYt]);

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

  // "I'm feeling lucky" — plays a hit matching the current time of day,
  // with shuffle-on so the whole queue becomes a lucky mix.
  const [luckyBusy, setLuckyBusy] = useState(false);
  const feelingLucky = () => {
    if (luckyBusy) return;
    setLuckyBusy(true);
    const seeds = [
      " Feel good hit", "guaranteed banger", "feel-good anthem", "crowd favorite",
      "legendary song", "timeless classic",
    ];
    const pick = seeds[Math.floor(Math.random() * seeds.length)];
    searchYt({ query: pick })
      .then(({ items }) => {
        const pool = items.filter((i) => i.duration > 0);
        const song = pool[Math.floor(Math.random() * pool.length)];
        if (!song) {
          toast.error("No luck this time — try again");
          return;
        }
        const rest = pool.filter((p) => p.id !== song.id);
        playTrack(toPlayableYoutube(song, `https://youtu.be/${song.id}`, rest));
      })
      .catch(() => toast.error("Couldn't reach our music sources — try again"))
      .finally(() => setLuckyBusy(false));
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
        <p className="mt-2 inline-flex rounded-full border border-[rgb(var(--tint)_/_0.2)] bg-[rgb(var(--tint)_/_0.08)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[rgb(var(--tint))]">
          Live shelves refresh daily
        </p>
      </header>

      {/* continue listening + surprise me — stacks on mobile so the buttons
            never truncate against the continue card */}
      {(continueTrack || likedLoaded) && (
        <section className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {continueTrack && (
            <button
              type="button"
              onClick={() => playTrack(continueTrack)}
              className="glass-card group flex min-w-0 flex-1 items-center gap-3 rounded-2xl p-3 text-left"
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
                {continueResume > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    Resume from {Math.floor(continueResume / 60)}:{String(Math.floor(continueResume % 60)).padStart(2, "0")}
                  </span>
                )}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={surpriseMe}
            className="glass-card flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold"
          >
            <Dices className={cn("size-4 text-[rgb(var(--tint))]", surprising && "animate-pulse")} />
            Play something random
          </button>
          <button
            type="button"
            onClick={feelingLucky}
            className="glass-card flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold"
          >
            <Sparkles className={cn("size-4 text-[rgb(var(--tint))]", luckyBusy && "animate-pulse")} />
            I'm feeling lucky
          </button>
        </section>
      )}

      {/* personal quick links — 3 columns squeeze the labels on phones, so
            stack 2-wide on mobile and spread out from sm up */}
      <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
        {quickLinks.map(({ to, label, detail, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="glass-card group rounded-2xl p-4"
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
                  loading="lazy"
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
                  loading="lazy"
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
  return !!snap.youtubeId;
}

function snapshotToPlayable(snap: LastPlayedSnapshot): Playable {
  return {
    id: snap.id,
    title: snap.title,
    artistName: snap.artistName,
    albumName: snap.albumName,
    coverUrl: snap.coverUrl,
    duration: snap.duration,
    source: "youtube",
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
