/** A YouTube search result (mirrors the shape returned by the Convex action). */
export interface YtItem {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
}

/** Remove upload metadata while preserving the actual song title. */
export function cleanTrackTitle(value: string): string {
  let title = value.replace(/\s+/g, " ").trim();
  const suffixPatterns = [
    /\s+[-–—]\s+music\s+for\s+.*$/i,
    /\s+[-–—|]\s*(?:official\s+)?(?:music\s+video|music\s+audio|audio|lyrics?|visualizer)\s*$/i,
    /\s*[\[(]\s*(?:official\s+)?(?:music\s+video|music\s+audio|audio|lyrics?|visualizer)\s*[\])]\s*$/i,
  ];
  for (const pattern of suffixPatterns) title = title.replace(pattern, "").trim();
  return title || value.trim();
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