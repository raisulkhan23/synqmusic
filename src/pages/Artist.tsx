import { Link, useParams } from "react-router";
import { useAction } from "convex/react";
import { Disc3, Loader2, Play, Radio, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Shelf } from "@/components/core/shelf";
import { MediaCard } from "@/components/tracks/MediaCard";
import { RemoteTrackRow } from "@/components/tracks/RemoteTrackRow";
import { api } from "@/convex/_generated/api";
import { groupByAlbum, uniqueTracks } from "@/lib/artistLinks";
import { toPlayableYoutube } from "@/lib/playable";
import { artistSearchQuery, cleanArtistName, type YtItem } from "@/lib/youtube";
import { usePlayerStore } from "@/store/player";

/**
 * An artist page.
 *
 * SYNQ stores no artist table — there is no artist id, no discography, no
 * follower graph. So this page does the honest thing: it resolves the artist
 * by searching the same music sources the rest of the app uses, and shows what
 * actually comes back. Everything below the fold is derived from those real
 * results: the albums are the albums those tracks report, and "more like
 * this" is a genuine similarity search, not a generated list.
 */
export default function Artist() {
  const params = useParams();
  const artistName = params.artist
    ? decodeURIComponent(params.artist).trim()
    : "";
  const query = artistSearchQuery(artistName);

  const searchYt = useAction(api.youtube.searchYoutube);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const startRadio = usePlayerStore((s) => s.startRadio);

  const [tracks, setTracks] = useState<YtItem[] | null>(null);
  const [related, setRelated] = useState<YtItem[] | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    if (!query) {
      setTracks([]);
      setRelated([]);
      return;
    }
    let cancelled = false;
    setTracks(null);
    setRelated(null);

    void searchYt({ query })
      .then(({ items }) => {
        if (cancelled) return;
        // Only keep what actually belongs to this artist. A search for an
        // artist name returns plenty of songs by other people, and silently
        // filing them under this artist would be the same fabrication the
        // recommendation engine refuses to make.
        const owned = uniqueTracks(
          (items ?? []).filter(
            (item) =>
              !!item &&
              item.duration > 0 &&
              cleanArtistName(item.artist, item.title).toLowerCase() ===
                cleanArtistName(query, "").toLowerCase(),
          ),
        );
        setTracks(owned);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      });

    void searchYt({ query: `artists similar to ${query}` })
      .then(({ items }) => {
        if (cancelled) return;
        // Everything that is NOT this artist is, by construction, somewhere to
        // go next.
        setRelated(
          uniqueTracks(
            (items ?? []).filter(
              (item) =>
                !!item &&
                item.duration > 0 &&
                cleanArtistName(item.artist, item.title).toLowerCase() !==
                  cleanArtistName(query, "").toLowerCase(),
            ),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setRelated([]);
      });

    return () => {
      cancelled = true;
    };
  }, [query, searchYt]);

  const albums = useMemo(() => groupByAlbum(tracks ?? []), [tracks]);

  const playAll = (list: YtItem[]) => {
    const playable = list.map((item) =>
      toPlayableYoutube(item, `https://youtu.be/${item.id}`),
    );
    const first = playable[0];
    if (!first) return;
    playTrack(first, playable);
  };

  const playOne = (item: YtItem, list: YtItem[]) => {
    setResolvingId(item.id);
    void searchYt({ query: `${item.title} ${item.artist}` })
      .then(({ items: found }) => {
        const match = found[0];
        if (!match) {
          toast.error(`Couldn't load "${item.title}"`);
          return;
        }
        const queue = [match, ...found.slice(1)].map((entry) =>
          toPlayableYoutube(entry, `https://youtu.be/${entry.id}`),
        );
        playTrack({ ...queue[0], id: item.id, title: item.title }, queue);
      })
      .catch(() => toast.error("Playback failed — try again in a moment"))
      .finally(() => setResolvingId(null));
    void list;
  };

  if (!artistName) {
    return (
      <EmptyState
        title="No artist"
        body="That link didn't include an artist name."
      />
    );
  }

  const topTracks = (tracks ?? []).slice(0, 10);
  const hasContent = topTracks.length > 0;

  return (
    <div className="flex flex-col gap-9 sm:gap-12">
      {/* ── Artist header ─────────────────────────────────────────────── */}
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end">
        {topTracks[0]?.thumbnail ? (
          <img
            src={topTracks[0].thumbnail}
            alt=""
            className="size-28 shrink-0 rounded-2xl object-cover ring-1 ring-white/10 sm:size-36"
          />
        ) : (
          <span className="flex size-28 shrink-0 items-center justify-center rounded-2xl bg-[rgb(var(--tint)_/_0.12)] text-[rgb(var(--tint))] sm:size-36">
            <Disc3 className="size-8" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-[rgb(var(--tint))] uppercase">
            Artist
          </p>
          <h1 className="font-display mt-1 text-2xl font-bold tracking-tight sm:text-4xl">
            {artistName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tracks === null
              ? "Loading…"
              : `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"} available`}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {hasContent ? (
              <button
                type="button"
                onClick={() => playAll(topTracks)}
                className="inline-flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-5 py-2.5 text-sm font-bold text-black transition-transform hover:scale-[1.02]"
              >
                <Play className="size-4 fill-current" />
                Play
              </button>
            ) : null}
            {hasContent ? (
              <button
                type="button"
                onClick={() => {
                  const seed = topTracks[0];
                  if (!seed) return;
                  startRadio(
                    toPlayableYoutube(seed, `https://youtu.be/${seed.id}`),
                    artistName,
                  );
                }}
                className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.05] px-4 py-2.5 text-sm font-semibold transition-colors hover:border-[rgb(var(--tint)_/_0.4)]"
              >
                <Radio className="size-4" />
                Radio
              </button>
            ) : null}
            <Link
              to={`/search?q=${encodeURIComponent(artistName)}`}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <Search className="size-4" />
              Search
            </Link>
          </div>
        </div>
      </header>

      {/* ── Top tracks. A list is genuinely the right shape here: these are
          the same songs, and picking "track 3" is what a listener means. */}
      {tracks === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading tracks…
        </div>
      ) : hasContent ? (
        <section aria-labelledby="artist-top-tracks">
          <h2
            id="artist-top-tracks"
            className="font-display mb-3 text-lg font-bold tracking-tight sm:text-xl"
          >
            Popular
          </h2>
          <div className="flex flex-col gap-0.5">
            {topTracks.map((item, index) => (
              <RemoteTrackRow
                key={item.id}
                item={item}
                index={index + 1}
                onPlay={() => playOne(item, topTracks)}
                resolving={resolvingId === item.id}
              />
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="Nothing found"
          body={`We couldn't find any playable tracks for ${artistName}.`}
          searchTerm={artistName}
        />
      )}

      {/* ── Albums. Only the albums those tracks actually report. */}
      {albums.length > 0 ? (
        <Shelf
          id="artist-albums"
          title="Albums"
          icon={<Disc3 className="size-4 text-[rgb(var(--tint))]" />}
        >
          {albums.map((album) => (
            <MediaCard
              key={`${album.artist}-${album.album}`}
              variant="playlist"
              item={{
                id: `${album.artist}-${album.album}`,
                title: album.album,
                artist: album.artist,
                duration: 0,
                thumbnail: album.items[0]?.thumbnail ?? "",
              }}
              onOpen={() => playAll(album.items)}
              meta={`${album.items.length} ${album.items.length === 1 ? "track" : "tracks"}`}
            />
          ))}
        </Shelf>
      ) : null}

      {/* ── A genuine similarity search, so the listener has somewhere to go. */}
      <Shelf
        id="artist-related"
        title="Fans also like"
        icon={<Sparkles className="size-4 text-[rgb(var(--tint))]" />}
        skeleton={related === null}
        hidden={related !== null && related.length === 0}
      >
        {(related ?? []).slice(0, 14).map((item) => (
          <MediaCard
            key={item.id}
            item={item}
            onOpen={() => playOne(item, related ?? [])}
            onPlay={() => playOne(item, related ?? [])}
            resolving={resolvingId === item.id}
          />
        ))}
      </Shelf>
    </div>
  );
}

function EmptyState({
  title,
  body,
  searchTerm,
}: {
  title: string;
  body: string;
  searchTerm?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-8 text-center">
      <p className="font-display text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        {body}
      </p>
      {searchTerm ? (
        <Link
          to={`/search?q=${encodeURIComponent(searchTerm)}`}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-[rgb(var(--tint))] px-4 py-2 text-sm font-bold text-black"
        >
          <Search className="size-4" />
          Search instead
        </Link>
      ) : null}
    </div>
  );
}
