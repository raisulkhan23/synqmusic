import { motion } from "framer-motion";
import { Link } from "react-router";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { greeting } from "@/lib/format";
import { toPlayableYoutube, type Playable } from "@/lib/playable";

import { cleanArtistName, type YtItem } from "@/lib/youtube";
import { usePlayerStore, peekResumePosition } from "@/store/player";
import {
  readLastPlayed,
  readPlayHistory,
  subscribePlayHistory,
  type HistoryEntry,
  type LastPlayedSnapshot,
} from "@/store/player";
import { useAction, useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Compass,
  Dices,
  Disc3,
  Flame,
  Heart,
  ListMusic,
  Play,
  Repeat2,
  Search,
  Sparkles,
  Sun,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

type RemoteMap = Record<string, YtItem[] | undefined>;

const DISCOVERY_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
const DISCOVERY_REFRESH_KEY = "synq:discovery-refreshed-at";
const HOME_REQUEST_TIMEOUT_MS = 12_000;
/** Discovery ("random genre") searches fan out to several artist-backed
 *  lookups server-side, so they legitimately take longer than a shelf fetch. */
const DISCOVERY_REQUEST_TIMEOUT_MS = 30_000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs = HOME_REQUEST_TIMEOUT_MS,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Home shelf request timed out")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const MOOD_LAUNCHES = [
  {
    label: "Focus",
    query: "focus concentration music",
    tone: "from-sky-500/25 to-cyan-500/5",
  },
  {
    label: "Slow morning",
    query: "soft acoustic morning songs",
    tone: "from-amber-500/25 to-orange-500/5",
  },
  {
    label: "Workout",
    query: "high energy workout songs",
    tone: "from-rose-500/25 to-pink-500/5",
  },
  {
    label: "Late night",
    query: "late night lofi chill beats",
    tone: "from-violet-500/25 to-indigo-500/5",
  },
  {
    label: "Good vibes",
    query: "feel good upbeat songs",
    tone: "from-emerald-500/25 to-lime-500/5",
  },
  {
    label: "Bengali moods",
    query: "Bengali acoustic songs",
    tone: "from-teal-500/25 to-cyan-500/5",
  },
] as const;

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
  const setQueueOpen = usePlayerStore((s) => s.setQueueOpen);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const playlists = useQuery(api.playlists.myPlaylists);
  const listeningStats = useQuery(api.history.listeningStats);
  const spotifyChart = useAction(api.spotify.spotifyChart);
  const searchYt = useAction(api.youtube.searchYoutube);

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteMap>({});
  const [remoteRefreshToken, setRemoteRefreshToken] = useState(0);

  // Songs of the week — global chart, streamed live.
  const [trending, setTrending] = useState<YtItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    withTimeout(spotifyChart({}))
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
    const primaryArtist = cleanArtistName(item.artist, item.title);
    withTimeout(searchYt({ query: `${item.title} ${primaryArtist}` }))
      .then(({ items }) => {
        const best = items[0];
        if (!best) {
          toast.error(`Couldn't load "${item.title}" — try another song`);
          return;
        }
        const playable = {
          ...toPlayableYoutube(
            item,
            `https://youtu.be/${best.id}`,
            items.slice(1),
          ),
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
  const [lastPlayed] = useState<LastPlayedSnapshot | null>(() =>
    readLastPlayed(),
  );
  const continueTrack: Playable | null = useMemo(
    () =>
      lastPlayed && isPlayableSource(lastPlayed)
        ? snapshotToPlayable(lastPlayed)
        : null,
    [lastPlayed],
  );

  // Cross-source play history (all sources alike) — SUBSCRIBED, not snapshotted.
  // Reading it once at mount meant the listening pulse and the history shelves
  // stayed frozen at whatever was in localStorage when Home first rendered.
  const history = useSyncExternalStore(
    subscribePlayHistory,
    readPlayHistory,
    readPlayHistory,
  ) as HistoryEntry[];

  // Saved position for the continue-listening card (resume exactly where stopped).
  const continueResume = useMemo(
    () =>
      continueTrack
        ? peekResumePosition(continueTrack.id, continueTrack.duration)
        : 0,
    [continueTrack],
  );

  const historyItems: YtItem[] = useMemo(
    () =>
      history.map((h) => ({
        id: h.youtubeId ?? h.id,
        title: h.title,
        artist: cleanArtistName(h.artistName, h.title),
        duration: h.duration,
        thumbnail: h.coverUrl,
      })),
    [history],
  );
  const mostPlayedItems: YtItem[] = useMemo(
    () =>
      [...historyItems].sort((a, b) => {
        const ca =
          history.find((h) => (h.youtubeId ?? h.id) === a.id)?.playCount ?? 0;
        const cb =
          history.find((h) => (h.youtubeId ?? h.id) === b.id)?.playCount ?? 0;
        return cb - ca;
      }),
    [historyItems, history],
  );
  const jumpBackItems = useMemo(() => historyItems.slice(1, 6), [historyItems]);

  // --- live remote fills for every section -----------------------------------
  const timeLabel = timeOfDayLabel();
  const [localTime, setLocalTime] = useState(() => formatLocalTime());
  useEffect(() => {
    const timer = window.setInterval(
      () => setLocalTime(formatLocalTime()),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const season = seasonLabel();
  const continueArtistName = lastPlayed
    ? cleanArtistName(lastPlayed.artistName, lastPlayed.title)
    : "";
  const favArtist = mostPlayedItems[0]
    ? cleanArtistName(mostPlayedItems[0].artist, mostPlayedItems[0].title)
    : undefined;

  const remoteQueries = useMemo(() => {
    const q: Array<{ key: string; query: string; fallback?: string }> = [
      {
        key: "discover",
        query: "new music friday",
        fallback: "fresh music this week",
      },
      { key: "topTracks", query: "top hits right now", fallback: "top hits" },
      {
        key: "newReleases",
        query: "new songs just released",
        fallback: "latest hits",
      },
    ];
    if (continueTrack) {
      q.push({
        key: "because",
        query:
          `songs similar to ${continueTrack.title} ${continueArtistName}`.trim(),
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
      lastRefresh =
        Number(window.localStorage.getItem(DISCOVERY_REFRESH_KEY)) || 0;
    } catch {
      // Ignore unavailable storage and use the in-memory timer below.
    }

    if (
      !lastRefresh ||
      Date.now() - lastRefresh >= DISCOVERY_REFRESH_INTERVAL
    ) {
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
              const { items } = await withTimeout(searchYt({ query: q }));
              if (cancelled) return;
              if (items.length > 0) {
                setRemote((prev) => ({ ...prev, [key]: items.slice(0, 6) }));
                return;
              }
            } catch {
              // Try the fallback query, then resolve the section below.
            }
          }
          if (!cancelled) {
            setRemote((prev) => ({ ...prev, [key]: [] }));
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
      toPlayableYoutube(
        item,
        `https://youtu.be/${item.id}`,
        rest.filter((r) => r.id !== item.id),
      ),
    );
  };

  // "Play something random" — random seed, random pick.
  const surpriseSeeds = [
    "indie pop",
    "synthwave",
    "lo-fi beats",
    "alternative rock",
    "dream pop",
    "electronic",
    "jazz",
    "funk",
    "soul",
    "ambient",
    "hip hop",
    "reggae",
    "classic rock",
    "house",
    "techno",
    "r&b",
    "folk",
    "punk",
    "k-pop",
    "afrobeats",
    "latin",
    "country",
    "metal",
    "disco",
    "blues",
  ];
  const [surprising, setSurprising] = useState(false);
  const surpriseMe = () => {
    if (surprising) return;
    setSurprising(true);
    const seed =
      surpriseSeeds[Math.floor(Math.random() * surpriseSeeds.length)];
    // Genre seeds go through the slower discovery search (several artist-backed
    // lookups), so they get a longer budget than the plain 12s shelf timeout.
    // A second, concrete seed is the fallback so one unlucky genre never leaves
    // the button dead.
    withTimeout(searchYt({ query: seed }), DISCOVERY_REQUEST_TIMEOUT_MS)
      .catch(() => searchYt({ query: "Taylor Swift songs" }))
      .then(({ items }) => {
        const pool = items.filter((i) => i.duration > 0);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (!pick) {
          toast.error("No results — try again");
          return;
        }
        // Queue the whole result pool, not just the picked track. Passing only
        // the playable left the queue holding a SINGLE entry, so the button
        // whose entire job is to start music instantly played one song and
        // then sat in silence waiting on a background fetch to find the next
        // one. The search we already paid for is the queue.
        const queue = pool
          .slice(0, 15)
          .map((item) =>
            toPlayableYoutube(item, `https://youtu.be/${item.id}`),
          );
        const selected = queue.find((t) => t.id === pick.id) ?? queue[0];
        playTrack(selected, queue);
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
      " Feel good hit",
      "guaranteed banger",
      "feel-good anthem",
      "crowd favorite",
      "legendary song",
      "timeless classic",
    ];
    const pick = seeds[Math.floor(Math.random() * seeds.length)];
    withTimeout(searchYt({ query: pick }), DISCOVERY_REQUEST_TIMEOUT_MS)
      .then(({ items }) => {
        const pool = items.filter((i) => i.duration > 0);
        const song = pool[Math.floor(Math.random() * pool.length)];
        if (!song) {
          toast.error("No luck this time — try again");
          return;
        }
        // Same fix as "Play something random": the picked track was passed on
        // its own, so the "lucky mix" was one song long. Shuffle has to be on
        // BEFORE playTrack runs, because that is when the store physically
        // orders the rest of the queue around the picked track.
        usePlayerStore.getState().startShuffle();
        const queue = pool
          .slice(0, 15)
          .map((item) =>
            toPlayableYoutube(item, `https://youtu.be/${item.id}`),
          );
        const selected = queue.find((t) => t.id === song.id) ?? queue[0];
        playTrack(selected, queue);
      })
      .catch(() => toast.error("Couldn't reach our music sources — try again"))
      .finally(() => setLuckyBusy(false));
  };

  const quickLinks = [
    {
      to: "/liked",
      label: "Liked Songs",
      detail: likedLoaded
        ? `${likedCount} ${likedCount === 1 ? "song" : "songs"}`
        : "…",
      icon: Heart,
    },
    {
      to: "/playlists",
      label: "Playlists",
      detail:
        playlists === undefined
          ? "…"
          : `${playlists.length} ${playlists.length === 1 ? "playlist" : "playlists"}`,
      icon: ListMusic,
    },
    {
      to: "/search",
      label: "Search",
      detail: "Find any song across our sources",
      icon: Search,
    },
  ];

  const artistTrendList = useMemo(
    () => artistTrend(historyItems),
    [historyItems],
  );
  const listeningPulse = useMemo(() => {
    // Use signed-in server stats as the source of truth so the pulse remains
    // stable when navigating between Home and other routes. Local history is
    // retained only as a fallback while the query is loading.
    if (listeningStats) {
      const bars = listeningStats.dailyActivity
        .slice(-7)
        .map((day) => day.plays);
      const safeBars = bars.length > 0 ? bars : [1, 1, 1, 1, 1, 1, 1];
      const uniqueArtists = listeningStats.uniqueArtists;
      const topRepeat = listeningStats.topTracks.reduce(
        (max, track) => Math.max(max, track.playCount),
        0,
      );
      return {
        totalPlays: listeningStats.totalPlays,
        uniqueArtists,
        topRepeat,
        bars: safeBars,
        maxBar: Math.max(1, ...safeBars),
      };
    }

    const totalPlays = history.reduce((sum, entry) => sum + entry.playCount, 0);
    const uniqueArtists = new Set(
      history.map((entry) => cleanArtistName(entry.artistName, entry.title)),
    ).size;
    const topRepeat = history.reduce(
      (max, entry) => Math.max(max, entry.playCount),
      0,
    );
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bars = Array.from({ length: 7 }, (_, index) => {
      const start = today.getTime() - (6 - index) * dayMs;
      return history.reduce(
        (count, entry) =>
          count +
          (entry.at >= start && entry.at < start + dayMs ? entry.playCount : 0),
        0,
      );
    });
    return {
      totalPlays,
      uniqueArtists,
      topRepeat,
      bars: bars.some((count) => count > 0) ? bars : [1, 1, 1, 1, 1, 1, 1],
      maxBar: Math.max(1, ...bars),
    };
  }, [history, listeningStats]);

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Everything the world is listening to — streamed live from our global
          music sources.
        </p>
        <p className="mt-2 inline-flex rounded-full border border-[rgb(var(--tint)_/_0.2)] bg-[rgb(var(--tint)_/_0.08)] px-2.5 py-1 text-[10px] font-semibold tracking-wide text-[rgb(var(--tint))]">
          Live shelves refresh daily
        </p>
      </header>
      {/* continue listening + surprise me — stacks on mobile so the buttons
            never truncate against the continue card */}
      {/* The random buttons are not tied to "Continue listening" — they used to
          sit inside its conditional, so a brand-new account with nothing in
          its history and no liked songs yet saw neither of them at all. Only
          the resume card is conditional; the row itself always renders. */}
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
                  Resume from {Math.floor(continueResume / 60)}:
                  {String(Math.floor(continueResume % 60)).padStart(2, "0")}
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
          <Dices
            className={cn(
              "size-4 text-[rgb(var(--tint))]",
              surprising && "animate-pulse",
            )}
          />
          Play something random
        </button>
        <button
          type="button"
          onClick={feelingLucky}
          className="glass-card flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold"
        >
          <Sparkles
            className={cn(
              "size-4 text-[rgb(var(--tint))]",
              luckyBusy && "animate-pulse",
            )}
          />
          I'm feeling lucky
        </button>
      </section>
      {/* personal quick links — 3 columns squeeze the labels on phones, so
            stack 2-wide on mobile and spread out from sm up */}
      <section className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
        {quickLinks.map(({ to, label, detail, icon: Icon }) => (
          <Link key={to} to={to} className="glass-card group rounded-2xl p-4">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[rgb(var(--tint)_/_0.14)] text-[rgb(var(--tint))] transition-transform group-hover:scale-105">
              <Icon className="size-[18px]" />
            </span>
            <p className="mt-3 font-display text-[15px] font-semibold">
              {label}
            </p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {detail}
            </p>
          </Link>
        ))}
      </section>
      {/* Listening pulse — server-backed for signed-in listeners, with local
          history as an offline/loading fallback. */}
      <section aria-labelledby="listening-pulse-title">
        <div className="glass-card relative overflow-hidden rounded-2xl p-4 sm:p-5">
          <div className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-[rgb(var(--tint)_/_0.1)] blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
                <BarChart3 className="size-3.5 text-[rgb(var(--tint))]" />
                Listening pulse
              </div>
              <h2
                id="listening-pulse-title"
                className="mt-1 font-display text-lg font-bold tracking-tight sm:text-xl"
              >
                Your week in sound
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                A small look at the music keeping you company.
              </p>
            </div>
            <Link
              to="/stats"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-[rgb(var(--tint)_/_0.35)] hover:text-foreground"
            >
              Full stats <BarChart3 className="size-3.5" />
            </Link>
          </div>

          <div className="relative mt-4 grid grid-cols-3 gap-1.5 sm:gap-2">
            <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/10 p-2 sm:p-3">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Play className="size-3 shrink-0 text-[rgb(var(--tint))]" />
                <span className="truncate">Sessions</span>
              </div>
              <p className="mt-0.5 text-base font-bold tabular-nums sm:mt-1 sm:text-xl">
                {listeningPulse.totalPlays}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/10 p-2 sm:p-3">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <UsersRound className="size-3 shrink-0 text-[rgb(var(--tint))]" />
                <span className="truncate">Artists</span>
              </div>
              <p className="mt-0.5 text-base font-bold tabular-nums sm:mt-1 sm:text-xl">
                {listeningPulse.uniqueArtists}
              </p>
            </div>
            <div className="min-w-0 rounded-xl border border-white/[0.07] bg-black/10 p-2 sm:p-3">
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Repeat2 className="size-3 shrink-0 text-[rgb(var(--tint))]" />
                <span className="truncate">Top repeat</span>
              </div>
              <p className="mt-0.5 text-base font-bold tabular-nums sm:mt-1 sm:text-xl">
                {listeningPulse.topRepeat}×
              </p>
            </div>
          </div>

          {/* Bars live in the card's own content box: no extra inset, so they
              can never run into the rounded corners, and the row clips so a
              narrow phone can never push a bar past the card edge. */}
          <div className="relative mt-4 flex h-14 items-end gap-1 overflow-hidden border-b border-white/[0.08] sm:h-16 sm:gap-1.5">
            {listeningPulse.bars.map((count, index) => (
              <div
                key={`${index}-${count}`}
                className="group flex h-full min-w-0 flex-1 items-end"
              >
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-[rgb(var(--tint)_/_0.3)] to-[rgb(var(--tint))] opacity-65 transition-all duration-300 group-hover:opacity-100"
                  style={{
                    height: `${Math.max(12, (count / listeningPulse.maxBar) * 100)}%`,
                  }}
                  title={`${count} ${count === 1 ? "play" : "plays"}`}
                />
              </div>
            ))}
          </div>
          <div className="relative mt-2 flex justify-between text-[10px] text-muted-foreground">
            <span>Recent listening</span>
            <span>Keep the streak going</span>
          </div>
        </div>
      </section>
      {/* quick actions */}
      <section className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[rgb(var(--tint))]">
              Quick actions
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight">
              Jump straight into listening
            </h2>
          </div>
          <Dices className="size-5 text-[rgb(var(--tint))]" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setQueueOpen(true)}
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:bg-white/[0.06]"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-violet-400/10 text-violet-300">
              <ListMusic className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Open queue</span>
              <span className="block truncate text-xs text-muted-foreground">
                Rearrange what plays next
              </span>
            </span>
          </button>
          <Link
            to="/stats"
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:bg-white/[0.06]"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
              <BarChart3 className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                Listening stats
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                See your listening pulse
              </span>
            </span>
          </Link>
          <Link
            to="/playlists"
            className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:bg-white/[0.06]"
          >
            <span className="flex size-9 items-center justify-center rounded-lg bg-rose-400/10 text-rose-300">
              <ListMusic className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Your library</span>
              <span className="block truncate text-xs text-muted-foreground">
                Playlists and liked songs
              </span>
            </span>
          </Link>
        </div>
      </section>
      {/* one-tap mood launcher */}
      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Set the mood
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Start a focused listening session without typing a thing.
            </p>
          </div>
          <Link
            to="/search"
            className="hidden items-center gap-1 text-xs font-semibold text-[rgb(var(--tint))] transition-colors hover:text-foreground sm:flex"
          >
            Browse all <Search className="size-3.5" />
          </Link>
        </div>
        <div className="slider-rail -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-6">
          {MOOD_LAUNCHES.map(({ label, query, tone }) => (
            <Link
              key={label}
              to={`/search?q=${encodeURIComponent(query)}`}
              className={cn(
                "group relative flex h-24 w-36 shrink-0 flex-col justify-end overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br p-3 transition-all hover:-translate-y-0.5 hover:border-[rgb(var(--tint)_/_0.35)] sm:w-auto",
                tone,
              )}
            >
              <span className="absolute -top-5 -right-4 size-20 rounded-full bg-white/[0.06] blur-xl transition-transform duration-500 group-hover:scale-125" />
              <span className="relative text-sm font-semibold text-foreground">
                {label}
              </span>
              <span className="relative mt-0.5 text-[10px] text-muted-foreground">
                Open mix →
              </span>
            </Link>
          ))}
        </div>
      </section>
      {/* Songs of the week — global chart */}{" "}
      <RemoteSection
        title="Songs of the week"
        subtitle="The most-played songs across the globe right now."
        icon={<Flame className="size-5 text-[rgb(var(--tint))]" />}
        items={trending ?? undefined}
      >
        {(items) =>
          items
            .slice(0, 8)
            .map((item, i) => (
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
      </RemoteSection>{" "}
      {trending && trending.length > 1 && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            onClick={() => playRemoteItem(trending[0], trending.slice(1))}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-[rgb(var(--tint)_/_0.4)] hover:text-foreground"
          >
            <Dices className="h-3.5 w-3.5 text-[rgb(var(--tint))]" />
            Shuffle the week
          </button>
        </div>
      )}
      <RemoteSection
        title="Today's top tracks"
        subtitle="The biggest songs right now, streamed live."
        items={remote.topTracks}
      >
        {(items) =>
          items
            .slice(0, 8)
            .map((item, i) => (
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
        {(items) => (
          <RemoteRows
            items={items}
            max={6}
            onPlay={playRemoteItem}
            resolvingId={resolvingId}
          />
        )}
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
                  <span className="block truncate text-sm font-semibold">
                    {item.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {cleanArtistName(item.artist, item.title)}
                  </span>
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
        {(items) => (
          <RemoteRows
            items={items}
            max={6}
            onPlay={playRemoteItem}
            resolvingId={resolvingId}
          />
        )}
      </RemoteSection>
      {/* Because you listened to... */}
      {continueTrack && (
        <RemoteSection
          title={`Because you listened to ${continueTrack.title}`}
          subtitle="More like this, matched live to what you love."
          icon={<Sparkles className="size-5 text-[rgb(var(--tint))]" />}
          items={remote.because}
        >
          {(items) => (
            <RemoteRows
              items={items}
              onPlay={playRemoteItem}
              resolvingId={resolvingId}
            />
          )}
        </RemoteSection>
      )}
      {/* Time of day + seasonal side-by-side */}
      {(remote.timeOfDay || remote.seasonal) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {remote.timeOfDay && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <h3 className="font-display flex items-center gap-2 text-base font-bold tracking-tight">
                <Sun className="size-4 text-[rgb(var(--tint))]" />
                Right now for you · {localTime}
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
          <RemoteRows
            items={mostPlayedItems}
            onPlay={playRemoteItem}
            resolvingId={resolvingId}
          />
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
          <RemoteRows
            items={historyItems}
            onPlay={playRemoteItem}
            resolvingId={resolvingId}
          />
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
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-white/[0.04]"
            />
          ))}
        </div>
      </section>
    );
  }
  if (!Array.isArray(items)) return null;
  const safeItems = items.filter(isUsableRemoteItem);
  if (safeItems.length === 0) return null;
  return (
    <section>
      <SectionHeader title={title} subtitle={subtitle} icon={icon} />
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="stagger mt-1 flex flex-col gap-0.5"
      >
        {children(safeItems)}
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
  const safeItems = Array.isArray(items)
    ? items.filter(isUsableRemoteItem)
    : [];
  return (
    <div className={className}>
      {safeItems.slice(0, max).map((item, i) => (
        <RemoteTrackRow
          key={item.id}
          item={item}
          index={i + 1}
          onPlay={(it) => onPlay(it, safeItems)}
          resolving={resolvingId === item.id}
          source="youtube"
        />
      ))}
    </div>
  );
}

function isUsableRemoteItem(item: YtItem): boolean {
  return (
    !!item &&
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.title === "string" &&
    typeof item.artist === "string"
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
    artistName: cleanArtistName(snap.artistName, snap.title),
    albumName: snap.albumName,
    coverUrl: snap.coverUrl,
    duration: snap.duration,
    source: "youtube",
    youtubeId: snap.youtubeId,
    audioUrl: snap.audioUrl,
  };
}

function formatLocalTime(date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
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
function artistTrend(
  items: YtItem[],
): Array<{ artist: string; items: YtItem[] }> {
  const byArtist = new Map<string, YtItem[]>();
  for (const item of items) {
    const key = cleanArtistName(item.artist, item.title);
    const list = byArtist.get(key) ?? [];
    list.push(item);
    byArtist.set(key, list);
  }
  return [...byArtist.entries()]
    .map(([artist, list]) => ({ artist, items: list }))
    .sort((a, b) => b.items.length - a.items.length);
}
