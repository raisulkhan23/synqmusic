import { v } from "convex/values";
import { action } from "./_generated/server";

export interface LyricLine {
  /** seconds from track start */
  t: number;
  text: string;
}

/**
 * Fetch synced lyrics from LRCLIB (https://lrclib.net) — a free, open lyrics
 * database that needs no API key. Returns LRC-format lines parsed into
 * { time, text } pairs, or null when nothing is found.
 */
export const fetchLyrics = action({
  args: {
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: async (_ctx, { title, artist, album, duration }): Promise<{ lines: LyricLine[] } | null> => {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (album) params.set("album_name", album);
    if (duration && duration > 0) params.set("duration", String(Math.round(duration)));

    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: { "User-Agent": "SoundScape/1.0 (web player)" },
    });

    // Try a fuzzy search fallback when the exact lookup misses.
    let synced: string | null = null;
    if (res.ok) {
      const data = (await res.json()) as { syncedLyrics?: string | null };
      synced = data.syncedLyrics ?? null;
    }

    if (!synced) {
      const searchRes = await fetch(
        `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist }).toString()}`,
        { headers: { "User-Agent": "SoundScape/1.0 (web player)" } },
      );
      if (searchRes.ok) {
        const results = (await searchRes.json()) as { syncedLyrics?: string | null }[];
        synced = results.find((r) => r.syncedLyrics)?.syncedLyrics ?? null;
      }
    }

    if (!synced) return null;

    const lines: LyricLine[] = [];
    for (const raw of synced.split("\n")) {
      const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/);
      if (!m) continue;
      const t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
      const text = m[4].trim();
      if (text) lines.push({ t, text });
    }

    return lines.length > 0 ? { lines } : null;
  },
});
