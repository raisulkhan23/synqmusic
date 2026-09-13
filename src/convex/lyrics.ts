import { v } from "convex/values";
import { action } from "./_generated/server";

export interface LyricLine {
  /** seconds from track start */
  t: number;
  text: string;
}

const UA = { "User-Agent": "SYNQ/1.0 (web player)" };

/** Parse LRC-format text into timed lines. */
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const m = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\](.*)$/);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(`0.${m[3]}`) : 0);
    const text = m[4].trim();
    if (text) lines.push({ t, text });
  }
  return lines;
}

/**
 * Distribute unsynced plain-text lyrics evenly across the track duration so
 * they can be shown in the synced-style view (approximate, but far better
 * than "no lyrics found" when only plain text exists).
 */
function distributePlain(text: string, duration: number): LyricLine[] {
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[.*\]$/.test(l)); // skip [Chorus] style tags
  if (rawLines.length === 0) return [];
  // Reserve 8% at the end for the outro; spread lines over the rest.
  const usable = duration > 60 ? duration * 0.92 : duration * 0.8;
  const step = usable / rawLines.length;
  return rawLines.map((text, i) => ({ t: Number((i * step).toFixed(2)), text }));
}

async function lrclibSynced(title: string, artist: string, album?: string, duration?: number): Promise<string | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  if (album) params.set("album_name", album);
  if (duration && duration > 0) params.set("duration", String(Math.round(duration)));
  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { headers: UA });
  if (res.ok) {
    const data = (await res.json()) as { syncedLyrics?: string | null };
    if (data.syncedLyrics) return data.syncedLyrics;
  }
  // Fuzzy search — first result with synced lyrics wins.
  const searchRes = await fetch(
    `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist }).toString()}`,
    { headers: UA },
  );
  if (searchRes.ok) {
    const results = (await searchRes.json()) as { syncedLyrics?: string | null }[];
    return results.find((r) => r.syncedLyrics)?.syncedLyrics ?? null;
  }
  return null;
}

async function lrclibPlain(title: string, artist: string): Promise<string | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: artist });
  const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, { headers: UA });
  if (res.ok) {
    const data = (await res.json()) as { plainLyrics?: string | null };
    if (data.plainLyrics) return data.plainLyrics;
  }
  const searchRes = await fetch(
    `https://lrclib.net/api/search?${new URLSearchParams({ track_name: title, artist_name: artist }).toString()}`,
    { headers: UA },
  );
  if (searchRes.ok) {
    const results = (await searchRes.json()) as { plainLyrics?: string | null }[];
    return results.find((r) => r.plainLyrics)?.plainLyrics ?? null;
  }
  return null;
}

/** lyrics.ovh — free plain-text lyrics API, no key required. */
async function lyricsOvh(title: string, artist: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { headers: UA },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lyrics?: string };
    return data.lyrics?.trim() || null;
  } catch {
    return null;
  }
}

/** ChartLyrics — another free plain-text API (apiv2.chartlyrics.com). */
async function chartLyrics(title: string, artist: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(artist)}&song=${encodeURIComponent(title)}`,
      { headers: UA },
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const m = xml.match(/<lyric>[\s\S]*?<\/lyric>/i);
    const text = m?.[0]?.replace(/<\/?lyric>/gi, "").trim();
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Fetch lyrics with multiple providers, in priority order:
 * 1. LRCLIB synced (frame-accurate, best experience)
 * 2. LRCLIB plain text (distributed across duration)
 * 3. lyrics.ovh plain text
 * 4. ChartLyrics plain text
 * Returns timed lines in all cases (plain sources are time-distributed).
 */
export const fetchLyrics = action({
  args: {
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: async (_ctx, { title, artist, album, duration }): Promise<{ lines: LyricLine[] } | null> => {
    const dur = duration && duration > 0 ? duration : 210; // reasonable default

    // 1. Synced from LRCLIB.
    try {
      const synced = await lrclibSynced(title, artist, album, dur);
      if (synced) {
        const lines = parseLrc(synced);
        if (lines.length > 0) return { lines };
      }
    } catch {
      /* next provider */
    }

    // 2–4. Plain-text sources, in order.
    const plainSources: (() => Promise<string | null>)[] = [
      () => lrclibPlain(title, artist),
      () => lyricsOvh(title, artist),
      () => chartLyrics(title, artist),
    ];
    for (const source of plainSources) {
      try {
        const text = await source();
        if (text) {
          const lines = distributePlain(text, dur);
          if (lines.length > 0) return { lines };
        }
      } catch {
        /* next provider */
      }
    }

    return null;
  },
});
