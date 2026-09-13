import { motion } from "framer-motion";
import { Link } from "react-router";
import { AlbumCard } from "@/components/tracks/AlbumCard";
import { MixCard } from "@/components/tracks/MixCard";
import { PlayHeaderButton } from "@/components/tracks/PlayHeaderButton";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { SectionRow } from "@/components/tracks/SectionRow";
import { TrackRow } from "@/components/tracks/TrackRow";
import { api } from "@/convex/_generated/api";
import {
  albumsByNewest,
  ALBUMS,
  artistById,
  artistTracks,
  becauseYouListened,
  discoverWeekly,
  MIXES,
  releaseRadar,
  seasonalTracks,
  timeOfDayTracks,
  topTracks,
  trackById,
  tracksByIds,
  trendingArtists,
  type Track,
} from "@/lib/catalog";
import { coverArt } from "@/lib/covers";
import { formatTime, greeting, pluralize } from "@/lib/format";
import { toPlayableYoutube, type Playable } from "@/lib/playable";
import type { YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";
import { readLastPlayed, readPlayHistory, type HistoryEntry, type LastPlayedSnapshot } from "@/store/player";
import { isPlayable } from "@/lib/playable";
import { useAction, useQuery } from "convex/react";
import { cn } from "@/lib/utils";
import {
  Compass,
  Dices,
  Disc3,
  Flame,
  Heart,
  LibraryBig,
  ListMusic,
  Play,
  Radio,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";

export default function Home() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const playlists = useQuery(api.playlists.myPlaylists);
  const recent = useQuery(api.history.recentlyPlayed, { limit: 8 });
  const mostPlayed = useQuery(api.history.mostPlayed, { limit: 8 });
  // Chart data comes from Spotify (key-free public embed data); clicking a row
  // then resolves the matching video on YouTube for playback.
  const spotifyChart = useAction(api.spotify.spotifyChart);
  const searchYt = useAction(api.youtube.searchYoutube);

  const featured = MIXES.find((m) => m.id === "mix-top") ?? MIXES[0];
  const featuredTracks = tracksByIds(featured.trackIds);
  const mixes = MIXES.filter((m) => m.id !== featured.id);
  const albums = albumsByNewest();
  const top = topTracks(8);

  // Trending songs of the week, sourced from Spotify's public chart data and
  // fetched once on load. Playback resolves through the YouTube engine.
  const [trending, setTrending] = useState<YtItem[] | null>(null);
  const [trendingError, setTrendingError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    spotifyChart({})
      .then(({ items }) => {
        if (!cancelled) setTrending(items);
      })
      .catch(() => {
        if (!cancelled) setTrendingError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [spotifyChart]);

  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const playTrending = (item: YtItem) => {
    // Spotify supplies the chart metadata; playback resolves through YouTube.
    setResolvingId(item.id);
    // Drop the comma-separated featured artists for a cleaner search query.
    const primaryArtist = item.artist.split(",")[0]?.trim() ?? item.artist;
    searchYt({ query: `${item.title} ${primaryArtist}` })
      .then(({ items }) => {
        const best = items[0];
        if (!best) {
          toast.error(`Couldn't find "${item.title}" on YouTube`);
          return;
        }
        // Keep the Spotify id for highlighting + the Spotify artwork, but route
        // the actual playback to the matched YouTube video.
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

  const recentTracks = useMemo(
    () => (recent ?? []).map((r) => trackById(r.trackId)).filter((t): t is Track => t !== undefined),
    [recent],
  );
  const mostTracks = useMemo(
    () => (mostPlayed ?? []).map((r) => trackById(r.trackId)).filter((t): t is Track => t !== undefined),
    [mostPlayed],
  );

  // "Play something random" across ALL sources — a random seed query is
  // searched on YouTube (via YouTube Music, music-only results) and a random
  // result plays. Falls back to a random catalog track when YouTube is
  // unreachable.
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
          surpriseCatalog();
        }
      })
      .catch(() => {
        surpriseCatalog();
      })
      .finally(() => {
        setSurprising(false);
      });
  };

  const surpriseCatalog = () => {
    const all = topTracks(999);
    if (all.length === 0) return;
    const pick = all[Math.floor(Math.random() * all.length)];
    playTrack(pick, all);
    toast.success(`🎲 Now playing: ${pick.title}`);
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
      to: "/library",
      label: "Library",
      detail: `${ALBUMS.length} albums in the catalog`,
      icon: LibraryBig,
    },
    {
      to: "/search",
      label: "Search",
      detail: "Find any track, album or artist",
      icon: Search,
    },
  ];

  // the single last-played track, for "Continue listening" — the most recent
  // song from ANY source (YouTube included), falling back to catalog history.
  const [lastPlayed, setLastPlayed] = useState<LastPlayedSnapshot | null>(null);
  useEffect(() => {
    setLastPlayed(readLastPlayed());
  }, []);
  const continueTrack: (Playable | Track) | null = useMemo(() => {
    const local = lastPlayed;
    const server = recent?.[0];
    const serverTrack = server ? trackById(server.trackId) : undefined;
    if (serverTrack && server && local) {
      return server.playedAt > local.at ? serverTrack : local;
    }
    if (local) return local;
    return serverTrack ?? null;
  }, [lastPlayed, recent]);

  // --- discovery rails -------------------------------------------------------
  const recentIds = useMemo(() => (recent ?? []).map((r) => r.trackId), [recent]);
  const discover = useMemo(() => discoverWeekly(recentIds), [recentIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const radar = useMemo(() => releaseRadar([], 6), []);
  const because = useMemo(
    () => (continueTrack ? becauseYouListened(continueTrack.id, 6) : []),
    [continueTrack?.id], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const timeOfDay = useMemo(() => timeOfDayTracks(), []);
  const seasonal = useMemo(() => seasonalTracks(), []);
  const artists = useMemo(() => trendingArtists(8), []);
  // --- remote (YouTube) discovery fills -------------------------------------
  // Discovery sections prefer LIVE YouTube results matched by section title
  // (not just the 24-track catalog). The catalog lists render instantly and
  // are replaced once the YouTube rows for each section arrive.
  const continueArtistName = !continueTrack
    ? ""
    : "artistName" in continueTrack
      ? String(continueTrack.artistName ?? "")
      : artistNameOf(continueTrack);

  // Cross-source play history (YouTube + catalog alike) drives the personal
  // sections so they reflect real listening, not just catalog plays.
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
    () => [...historyItems].sort((a, b) => {
      const ca = history.find((h) => (h.youtubeId ?? h.id) === a.id)?.playCount ?? 0;
      const cb = history.find((h) => (h.youtubeId ?? h.id) === b.id)?.playCount ?? 0;
      return cb - ca;
    }),
    [historyItems, history],
  );
  const jumpBackItems = useMemo(() => historyItems.slice(1, 6), [historyItems]);

  // Live YouTube charts power the global sections (top tracks / artists /
  // new releases) so they come from YouTube, not the catalog.
  const remoteQueries = useMemo(() => {
    const q: Array<{ key: string; query: string }> = [
      { key: "discover", query: "new music this week" },
      { key: "radar", query: "new releases this week" },
      { key: "topTracks", query: "top hits right now" },
      { key: "newReleases", query: "new songs just released" },
    ];
    if (continueTrack) {
      q.push({
        key: "because",
        query: `songs similar to ${continueTrack.title} ${continueArtistName}`.trim(),
      });
    }
    const favArtist = mostPlayedItems[0]?.artist;
    if (favArtist) q.push({ key: "artists", query: `${favArtist} songs` });
    q.push({ key: "timeOfDay", query: `${timeOfDay.label} music hits`.toLowerCase() });
    q.push({ key: "seasonal", query: `${seasonal.label} hits`.toLowerCase() });
    return q;
  }, [continueTrack?.title, continueArtistName, timeOfDay.label, seasonal.label, mostPlayedItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const [remote, setRemote] = useState<Record<string, YtItem[]>>({});
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const { key, query } of remoteQueries) {
        if (cancelled || fetchedRef.current.has(key)) continue;
        fetchedRef.current.add(key);
        try {
          const { items } = await searchYt({ query });
          if (!cancelled && items.length > 0) {
            setRemote((prev) => ({ ...prev, [key]: items.slice(0, 6) }));
          }
        } catch {
          // keep the catalog fallback in place on failure
        }
      }
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

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your dashboard — the catalog is ready, 24 tracks, zero ads.
        </p>
      </header>

      {/* continue listening + surprise me */}
      {(continueTrack || likedLoaded) && (
        <section className="flex flex-wrap items-center gap-3">
          {continueTrack && (
            <button
              type="button"
              onClick={() =>
                // YouTube snapshots aren't in the catalog history list —
                // passing recentTracks as the queue would make playTrack()
                // fall back to index 0 and play a catalog song instead.
                // Play the exact track, with the recent list queued after it.
                isPlayable(continueTrack)
                  ? playTrack(continueTrack)
                  : playTrack(continueTrack, recentTracks)
              }
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
      <section className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">        {quickLinks.map(({ to, label, detail, icon: Icon }) => (
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

      {/* featured mix hero */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative h-60 overflow-hidden rounded-3xl sm:h-72"
      >
        <div
          className="absolute inset-0 transition-transform duration-700"
          style={{
            background: `linear-gradient(115deg, ${featured.gradient[0]}, ${featured.gradient[1]})`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
        <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8">
          <p className="text-[11px] font-semibold tracking-[0.2em] text-white/60 uppercase">
            Featured mix
          </p>
          <h2 className="mt-1 max-w-md font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {featured.title}
          </h2>
          <p className="mt-1 max-w-md text-sm text-white/70">{featured.description}</p>
          <p className="mt-0.5 text-xs font-medium text-white/50">
            {pluralize(featuredTracks.length, "track")} · {formatTime(featuredTracks.reduce((s, t) => s + t.duration, 0))}
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => playTrack(featuredTracks[0], featuredTracks)}
              className="flex items-center gap-2 rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-black transition-transform hover:scale-[1.03] active:scale-95"
            >
              <PlayIcon />
              Play
            </button>
          </div>
        </div>
      </motion.section>

      <SectionRow title="Made for you" subtitle="Editorial mixes, curated from the catalog">
        {mixes.map((mix) => (
          <MixCard key={mix.id} mix={mix} />
        ))}
      </SectionRow>

      {/* songs of the week, sourced from Spotify's public chart */}
      {trending && trending.length > 0 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
                <Flame className="size-5 text-[rgb(var(--tint))]" />
                Songs of the week
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Spotify&apos;s most-played songs right now, playable via YouTube.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            {trending.slice(0, 8).map((item, i) => (
              <RemoteTrackRow
                key={item.id}
                item={item}
                index={i + 1}
                onPlay={playTrending}
                resolving={resolvingId === item.id}
                source="spotify"
              />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-3">
          <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
            New releases
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Fresh songs just dropped, streamed from YouTube.
          </p>
        </div>
        <SectionTracks
          remoteItems={remote.newReleases}
          fallback={[]}
          onPlayRemote={playRemoteItem}
          resolvingId={resolvingId}
          max={6}
        />
      </section>

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

      {/* Discover Weekly */}
      {discover.length >= 4 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
                <Compass className="size-5 text-[rgb(var(--tint))]" />
                Discover Weekly
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                A fresh mix every week, tuned to what you haven&apos;t heard yet.
              </p>
            </div>
            <PlayHeaderButton list={remote.discover?.length ? [] : discover} label="Play mix" />
          </div>
          <SectionTracks
            remoteItems={remote.discover}
            fallback={discover}
            onPlayRemote={playRemoteItem}
            resolvingId={resolvingId}
            max={6}
          />
        </section>
      )}

      {/* Release Radar */}
      {radar.length >= 3 && (
        <section>
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
                <Radio className="size-5 text-[rgb(var(--tint))]" />
                Release Radar
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Newest tracks from artists you follow.
              </p>
            </div>
            <PlayHeaderButton list={remote.radar?.length ? [] : radar} label="Play radar" />
          </div>
          <SectionTracks
            remoteItems={remote.radar}
            fallback={radar}
            onPlayRemote={playRemoteItem}
            resolvingId={resolvingId}
          />
        </section>
      )}

      {/* Because you listened to... */}
      {because.length >= 4 && continueTrack && (
        <section>
          <div className="mb-3">
            <h2 className="font-display flex items-center gap-2 text-lg font-bold tracking-tight sm:text-xl">
              <Sparkles className="size-5 text-[rgb(var(--tint))]" />
              Because you listened to {continueTrack.title}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              More like this, matched from YouTube live.
            </p>
          </div>
          <SectionTracks
            remoteItems={remote.because}
            fallback={because}
            onPlayRemote={playRemoteItem}
            resolvingId={resolvingId}
          />
        </section>
      )}

      {/* Time of day + seasonal side-by-side */}
      {(timeOfDay.tracks.length >= 3 || seasonal.tracks.length >= 3) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {timeOfDay.tracks.length >= 3 && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <h3 className="font-display flex items-center gap-2 text-base font-bold tracking-tight">
                <Sun className="size-4 text-[rgb(var(--tint))]" />
                {timeOfDay.label}
              </h3>
              <SectionTracks
                remoteItems={remote.timeOfDay}
                fallback={timeOfDay.tracks}
                onPlayRemote={playRemoteItem}
                resolvingId={resolvingId}
                max={4}
                className="mt-2"
              />
            </div>
          )}
          {seasonal.tracks.length >= 3 && (
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <h3 className="font-display flex items-center gap-2 text-base font-bold tracking-tight">
                <Disc3 className="size-4 text-[rgb(var(--tint))]" />
                Sounds of {seasonal.label}
              </h3>
              <SectionTracks
                remoteItems={remote.seasonal}
                fallback={seasonal.tracks}
                onPlayRemote={playRemoteItem}
                resolvingId={resolvingId}
                max={4}
                className="mt-2"
              />
            </div>
          )}
        </section>
      )}

      {/* Trending artists — live from your top played + YouTube */}
      {historyItems.length >= 2 && (
        <section>
          <div className="mb-3">
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Trending artists
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Who you&apos;ve been playing the most.
            </p>
          </div>
          <div className="hide-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
            {artistTrend(historyItems).slice(0, 8).map(({ artist, items }) => (
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
          <SectionTracks
            remoteItems={mostPlayedItems}
            fallback={[]}
            onPlayRemote={playRemoteItem}
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
          <SectionTracks
            remoteItems={historyItems}
            fallback={[]}
            onPlayRemote={playRemoteItem}
            resolvingId={resolvingId}
          />
        </section>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Today&apos;s top tracks
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The biggest songs right now, streamed from YouTube.
            </p>
          </div>
        </div>
        <SectionTracks
          remoteItems={remote.topTracks}
          fallback={top}
          onPlayRemote={playRemoteItem}
          resolvingId={resolvingId}
          max={8}
        />
      </section>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86a1 1 0 0 0-1.5.86Z" />
    </svg>
  );
}

/**
 * Renders one discovery section: live YouTube rows when they've arrived,
 * otherwise the catalog fallback rows. Keeps the section populated at all
 * times (catalog renders instantly; YouTube swaps in when ready).
 */
function SectionTracks({
  remoteItems,
  fallback,
  onPlayRemote,
  resolvingId,
  max = 5,
  className = "stagger mt-1 flex flex-col gap-0.5",
}: {
  remoteItems: YtItem[] | undefined;
  fallback: Track[];
  onPlayRemote: (item: YtItem, rest: YtItem[]) => void;
  resolvingId: string | null;
  max?: number;
  className?: string;
}) {
  if (remoteItems && remoteItems.length > 0) {
    return (
      <div className={className}>
        {remoteItems.slice(0, max).map((item, i) => (
          <RemoteTrackRow
            key={item.id}
            item={item}
            index={i + 1}
            onPlay={(item) => onPlayRemote(item, remoteItems)}
            resolving={resolvingId === item.id}
            source="youtube"
          />
        ))}
      </div>
    );
  }
  return (
    <div className={className}>
      {fallback.slice(0, max).map((track, i) => (
        <TrackRow key={track.id} track={track} list={fallback} index={i + 1} />
      ))}
    </div>
  );
}

// Group history items by artist name, sorted by play count (approximated by
// number of entries), for the "Trending artists" rail.
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

// Helpers to get display metadata from a Track without importing heavy deps.
function artistNameOf(track: Track): string {
  return artistById(track.artistId).name;
}

function coverOf(track: Track): string {
  const album = albumsByNewest().find((a) => a.id === track.albumId);
  return album ? coverArt(album) : "";
}