import { albumById, artistById, type Track } from "@/lib/catalog";
import { coverArt } from "@/lib/covers";
import type { YtItem } from "@/lib/youtube";

/**
 * A normalized item in the player queue. Catalog tracks and YouTube results
 * both become Playables, so the player UI never has to care where the audio
 * came from.
 */
export interface Playable {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  coverUrl: string;
  audioUrl: string;
  duration: number;
  source: "catalog" | "youtube";
  /** Present for catalog tracks, used for album navigation. */
  catalogTrack?: Track;
  /** Set when this track plays through the YouTube IFrame engine (by video id). */
  youtubeId?: string;
  /** Present for YouTube tracks, used for manual source switching. */
  alternatives?: YtItem[];
}

export function toPlayable(track: Track): Playable {
  const album = albumById(track.albumId);
  return {
    id: track.id,
    title: track.title,
    artistName: artistById(track.artistId).name,
    albumName: album.title,
    coverUrl: coverArt(album),
    audioUrl: track.audioUrl,
    duration: track.duration,
    source: "catalog",
    catalogTrack: track,
  };
}

export function toPlayableYoutube(
  item: YtItem,
  audioUrl: string,
  alternatives: YtItem[] = [],
): Playable {
  return {
    id: item.id,
    title: item.title,
    artistName: item.artist,
    albumName: "YouTube",
    coverUrl: item.thumbnail,
    audioUrl,
    duration: item.duration,
    source: "youtube",
    youtubeId: item.id,
    alternatives,
  };
}

export function isPlayable(t: Track | Playable): t is Playable {
  return "source" in t;
}
