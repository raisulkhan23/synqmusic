import type { YtItem } from "@/lib/youtube";

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
  const artistName = cleanArtistName(item.artist);
  return {
    id: item.id,
    title: item.title,
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

function cleanArtistName(value: string): string {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name || /^(?:unknown artist|artist|song|video|single|album|ep|music|official|unknown)$/i.test(name) || !/[\p{L}\p{N}]/u.test(name)) {
    return "Unknown artist";
  }
  return name;
}
