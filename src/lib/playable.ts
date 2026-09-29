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
  /**
   * How this track entered the queue. `undefined` means the listener put it
   * there on purpose — the recommendation engine only ever appends tracks
   * tagged `autoplay`, so an automatically generated suggestion stays
   * distinguishable from a manual pick and can be reported back as a
   * rejection when it is removed.
   */
  queueOrigin?: "autoplay";
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
    // The real album when the source supplied one, empty when it did not.
    // This used to be a hardcoded "Single", which is a fabricated value: it
    // made every track look like it belonged to its own album and gave the
    // recommendation engine a fake album axis to diversify on.
    albumName: item.album ?? "",
    coverUrl: item.thumbnail,
    audioUrl,
    duration: item.duration,
    source: "youtube",
    youtubeId: item.id,
    alternatives,
  };
}
