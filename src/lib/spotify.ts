/** A Spotify search result (mirrors the Convex action's return shape). */
export interface SpotifyTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** Seconds. */
  duration: number;
  thumbnail: string;
  /** 30s clip when Spotify exposes one; usually null. */
  previewUrl: string | null;
  spotifyUrl: string;
}
