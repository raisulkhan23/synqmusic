/** A YouTube search result (mirrors the shape returned by the Convex action). */
export interface YtItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

// Resolved stream URLs are cached for the session so replaying a track never
// hits the resolver twice.
const streamCache = new Map<string, string>();

export function getCachedStream(videoId: string): string | undefined {
  return streamCache.get(videoId);
}

export function cacheStream(videoId: string, url: string): void {
  streamCache.set(videoId, url);
}