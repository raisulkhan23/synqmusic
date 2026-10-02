// Relative, not the `@/` alias: the Convex bundler does not resolve it, and
// this module is reachable from `src/convex/` via the recommendation
// discovery path.
import { cleanArtistName, cleanTrackTitle, type YtItem } from "./youtube";

/**
 * A normalized item in the player queue. Every source (YouTube, Jamendo,
 * imports, liked snapshots) becomes a Playable, so the player UI never has to
 * care where the audio came from.
 */
export interface Playable {
  id: string;
  title: string;
  artistName: string;
  albumName: string;
  coverUrl: string;
  audioUrl: string;
  duration: number;
  /**
   * Where this track's audio came from.
   *
   * `"youtube"` is everything resolved against a video id. `"local"` is a file
   * the listener imported from their own device — it needs no resolver, no
   * network and no provider permission, and the player finds its bytes on disk
   * exactly the same way it finds a downloaded track's.
   *
   * (Jamendo is NOT a playable source, and that is deliberate: it was once a
   * second `<audio>`-fed provider and every track came back silent. It remains
   * a DISCOVERY index — see `src/lib/jamendoDiscovery.ts`.)
   */
  source: "youtube" | "local";
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

/**
 * A Jamendo track, described for DISCOVERY — never for playback.
 *
 * Removed: this used to build a queueable `Playable` carrying Jamendo's own
 * stream URL, and every track it produced was silent. What remains of the
 * idea lives in `src/lib/jamendoDiscovery.ts`, which resolves a Jamendo hit
 * to a YouTube upload before anything can be queued.
 */
