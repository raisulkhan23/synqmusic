import { motion } from "framer-motion";
import { Link } from "react-router";
import { AlbumCard } from "@/components/tracks/AlbumCard";
import { MixCard } from "@/components/tracks/MixCard";
import { PlayHeaderButton } from "@/components/tracks/PlayHeaderButton";
import { SectionRow } from "@/components/tracks/SectionRow";
import { TrackRow } from "@/components/tracks/TrackRow";
import { api } from "@/convex/_generated/api";
import { albumsByNewest, ALBUMS, MIXES, topTracks, tracksByIds } from "@/lib/catalog";
import { formatTime, greeting, pluralize } from "@/lib/format";
import { usePlayerStore } from "@/store/player";
import { useQuery } from "convex/react";
import { Heart, LibraryBig, ListMusic, Search } from "lucide-react";

export default function Home() {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const likedCount = usePlayerStore((s) => Object.keys(s.liked).length);
  const likedLoaded = usePlayerStore((s) => s.likedLoaded);
  const playlists = useQuery(api.playlists.myPlaylists);
  const featured = MIXES.find((m) => m.id === "mix-top") ?? MIXES[0];
  const featuredTracks = tracksByIds(featured.trackIds);
  const mixes = MIXES.filter((m) => m.id !== featured.id);
  const albums = albumsByNewest();
  const top = topTracks(8);

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

      {/* personal quick links */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      <SectionRow title="New releases" subtitle="Fresh from the Soundscape label">
        {albums.map((album) => (
          <AlbumCard key={album.id} album={album} />
        ))}
      </SectionRow>

      <section>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight sm:text-xl">
              Today&apos;s top tracks
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              The most played songs in the catalog right now.
            </p>
          </div>
          <PlayHeaderButton list={top} />
        </div>
        <div className="mt-1 flex flex-col gap-0.5">
          {top.map((track, i) => (
            <TrackRow key={track.id} track={track} list={top} index={i + 1} />
          ))}
        </div>
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