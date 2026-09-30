import { cleanArtistName, cleanTrackTitle, type YtItem } from "@/lib/youtube";
import type { JamendoTrack } from "@/lib/jamendo";

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
   * Which engine owns this track.
   *
   * `"youtube"` means the IFrame engine, addressed by `youtubeId`.
   * `"jamendo"` means a direct Creative Commons stream played by the `<audio>`
   * element — the branch the player already had for "catalog tracks" and which
   * Jamendo is the first real provider to use.
   */
  source: "youtube" | "jamendo";
  /** Set when this track plays through the YouTube IFrame engine (by video id). */
  youtubeId?: string;
  /** Present for YouTube tracks, used for manual source switching. */
  alternatives?: YtItem[];
  /**
   * Licence and origin for a non-YouTube source.
   *
   * Jamendo's catalogue is Creative Commons, and attribution is a condition of
   * those licences rather than a courtesy. Carrying the licence URL and the
   * artist's own page on the track means the UI can credit them and can send
   * the listener somewhere that pays the artist.
   */
  attribution?: {
    licenseUrl: string;
    shareUrl: string;
  };
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
 * A Jamendo track, queued for the direct-audio engine.
 *
 * `id` is namespaced (`jamendo:<id>`) rather than the bare Jamendo id. A
 * Jamendo track and a YouTube video are different things that can share a
 * title, and the queue, the liked map and the resume-position store are all
 * keyed on `id` — an unnamespaced id would let one silently overwrite the
 * other's saved position.
 *
 * `youtubeId` is deliberately absent, which is the switch that routes this
 * track to the `<audio>` element instead of the IFrame engine.
 */
export function toPlayableJamendo(track: JamendoTrack): Playable {
  return {
    id: `jamendo:${track.jamendoId}`,
    title: track.title,
    artistName: track.artistName,
    // Left empty rather than filled with "Single": Jamendo genuinely has no
    // album for a single, and inventing one would give the recommendation
    // engine a fake album axis to diversify on.
    albumName: track.albumName,
    coverUrl: track.coverUrl,
    audioUrl: track.audioUrl,
    duration: track.duration,
    source: "jamendo",
    attribution: {
      licenseUrl: track.licenseUrl,
      shareUrl: track.shareUrl,
    },
  };
}
