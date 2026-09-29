import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";

/**
 * A normalized item in the player queue. Every source (YouTube, imports,
 * liked snapshots) becomes a Playable, so the player UI never has to care
 * where the audio came from.
 */
export interface Playable {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  coverUrl: string;
  audioUrl: string;
  duration: number;
  source: "youtube";
  /** Set when this track plays through the YouTube IFrame engine (by video id). */
  youtubeId?: string;
  /** Present for YouTube tracks, used for manual source switching. */
  alternatives?: YtItem[];
}

export function toPlayableYoutube(
  item: YtItem,
  audioUrl: string,
  alternatives: YtItem[] = [],
): Playable {
  const artistName = cleanArtistName(item.artist, item.title);
  return {
    id: item.id,
    title: cleanTrackTitle(item.title),
    artistName,
    albumName: "Single",
    coverUrl: item.thumbnail,
    audioUrl,
    duration: item.duration,
    source: "youtube",
    youtubeId: item.id,
    alternatives,
  };
}

