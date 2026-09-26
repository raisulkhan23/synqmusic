import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";

export interface LyricLine {
  /** seconds from track start */
  t: number;
  text: string;
}

const UA = { "User-Agent": "SYNQ/1.0 (web player)" };
/** Upstream providers are free and rate limited; a miss is cached too so a
 *  song with genuinely no lyrics anywhere is only looked up once. */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
/** Wall-clock budget for the whole lookup. Providers are tried in order, so a
 *  slow first provider must not eat the budget of the ones after it. */
const LOOKUP_BUDGET_MS = 6000;

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

// ---------------------------------------------------------------------------
// Matching
//
// The single biggest cause of a miss is a title that carries the decoration
// YouTube/catalogue titles come with. LRCLIB answers 404 for
// "Show Me Love (Radio Edit)" and 200 for "Show Me Love" — same song. So the
// raw title is never the only thing we try.
// ---------------------------------------------------------------------------

/** Words that mark a version/edition rather than part of the song title. */
const VERSION_WORDS =
  /\b(radio edit|single version|album version|extended mix|extended edit|remaster(?:ed)?(?: \d{4})?|deluxe|bonus track|explicit|clean version|edit|remix|version|live|acoustic|instrumental|demo|mono|stereo|album edit|full album video|official (?:music )?video|official audio|lyric video|lyrics|visualizer|audio|hd|hq|4k|mv|visualiser)\b/gi;

const FEATURED = /\s*[([]?\s*\b(?:feat|ft|featuring|with)\b\.?\s[^)\]]*[)\]]?/gi;
const ARTIST_NOISE = /\s*[-–—]\s*(?:topic|official|video|audio|lyrics?|hd|hq|mv|visualizer)\s*$/i;

/** Strip quotes, collapse whitespace, tidy punctuation. */
function tidy(value: string): string {
  return value
    .replace(/["'“”‘’`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*,\s*/g, ", ")
    .trim();
}

/** Remove bracketed suffixes, then any trailing version/edition wording. */
export function cleanTitle(title: string): string {
  let out = title;
  // Leading "Artist - Title" is a very common catalogue shape.
  const dash = out.match(/^(.{2,60}?)\s+[-–]\s+(.+)$/);
  if (dash && !VERSION_WORDS.test(dash[1])) out = dash[2];
  out = out.replace(/\((?:[^()]*)\)/g, " ");
  out = out.replace(/\[(?:[^\][]*)\]/g, " ");
  out = out.replace(FEATURED, " ");
  out = out.replace(VERSION_WORDS, " ");
  out = tidy(out);
  // A title that was *only* decoration ("(Live)") leaves nothing behind; fall
  // back to the original so we never search for an empty string.
  return out.length >= 2 ? out : tidy(title);
}

/** The head artist, without featured guests or channel suffixes. */
export function cleanArtist(artist: string): string {
  let out = artist.replace(ARTIST_NOISE, "");
  out = out.replace(FEATURED, " ");
  out = out.split(/\s+(?:&|x|and|\/|,)\s+/)[0] ?? out;
  out = tidy(out);
  return out.length >= 2 ? out : tidy(artist);
}

type Candidate = { title: string; artist: string };

/** Ordered, de-duplicated lookup pairs. Raw first, then progressively cleaner. */
export function buildCandidates(title: string, artist: string): Candidate[] {
  const cleanT = cleanTitle(title);
  const cleanA = cleanArtist(artist);
  const ordered: Candidate[] = [
    { title: tidy(title), artist: tidy(artist) },
    { title: cleanT, artist: cleanA },
    { title: cleanT, artist: tidy(artist) },
    { title: tidy(title), artist: cleanA },
  ];
  // Some providers match on the title alone better than on a half-wrong artist.
  ordered.push({ title: cleanT, artist: "" });
  const seen = new Set<string>();
  return ordered.filter((candidate) => {
    if (!candidate.title) return false;
    const key = `${candidate.title.toLowerCase()}|${candidate.artist.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Cheap similarity in [0,1] used to rank search results. */
function similarity(a: string, b: string): number {
  const left = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const right = b.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.8;
  const leftWords = new Set(left.split(/\s+/));
  const rightWords = right.split(/\s+/);
  const shared = rightWords.filter((word) => leftWords.has(word)).length;
  return shared / Math.max(leftWords.size, rightWords.length);
}

type LrcRecord = {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number | null;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
};

/** One `/api/get` call returns BOTH forms, so this is a single request. */
async function lrclibGet(
  candidate: Candidate,
  album: string | undefined,
  duration: number | undefined,
): Promise<LrcRecord | null> {
  const params = new URLSearchParams({ track_name: candidate.title });
  if (candidate.artist) params.set("artist_name", candidate.artist);
  if (album) params.set("album_name", album);
  // Only send a duration when we trust it: `/api/get` matches on duration to
  // the second, and a live/radio cut differs from the studio one, which turns
  // a would-be hit into a 404.
  if (duration && duration > 0) params.set("duration", String(Math.round(duration)));
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params.toString()}`, {
      headers: UA,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LrcRecord;
  } catch {
    return null;
  }
}

/**
 * Rank search results instead of taking the first hit. A result that matches
 * the title/artist and the duration is worth far more than the first row of a
 * loose search, and a live version is worth less when we did not ask for one.
 */
function rank(results: LrcRecord[], candidate: Candidate, duration?: number): LrcRecord | null {
  let best: LrcRecord | null = null;
  let bestScore = -Infinity;
  for (const result of results) {
    if (!result.syncedLyrics && !result.plainLyrics) continue;
    let score = 0;
    score += similarity(candidate.title, result.trackName ?? "") * 40;
    if (candidate.artist) score += similarity(candidate.artist, result.artistName ?? "") * 30;
    if (result.syncedLyrics) score += 18;
    if (duration && result.duration) {
      const delta = Math.abs(result.duration - duration);
      if (delta <= 2) score += 14;
      else if (delta <= 6) score += 6;
      else if (delta > 20) score -= 10;
    }
    // A live/acoustic cut is a worse match than the studio recording.
    const name = `${result.trackName ?? ""} ${result.albumName ?? ""}`.toLowerCase();
    if (/\b(live|acoustic|remaster|cover|karaoke|instrumental)\b/.test(name)) score -= 12;
    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }
  return bestScore > 0 ? best : null;
}

async function lrclibSearch(
  candidate: Candidate,
  duration: number | undefined,
): Promise<LrcRecord | null> {
  try {
    const res = await fetch(
      `https://lrclib.net/api/search?${new URLSearchParams({
        track_name: candidate.title,
        ...(candidate.artist ? { artist_name: candidate.artist } : {}),
      }).toString()}`,
      { headers: UA, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    return rank((await res.json()) as LrcRecord[], candidate, duration);
  } catch {
    return null;
  }
}

/** lyrics.ovh — free plain-text lyrics API, no key required. */
async function lyricsOvh(candidate: Candidate): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(candidate.artist)}/${encodeURIComponent(candidate.title)}`,
      { headers: UA, signal: AbortSignal.timeout(4000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lyrics?: string };
    return data.lyrics?.trim() || null;
  } catch {
    return null;
  }
}

export type FetchLyricsResult = {
  lines: LyricLine[];
  /** False when the lines are time-distributed guesses over plain text. */
  synced: boolean;
  source: string;
  /** Set when the lookup hit a cached "no lyrics anywhere" entry. */
  missing?: boolean;
};

function toResult(
  record: LrcRecord,
  source: string,
  duration: number,
): FetchLyricsResult | null {
  const syncedLines = record.syncedLyrics ? parseLrc(record.syncedLyrics) : [];
  if (syncedLines.length > 0) {
    return { lines: syncedLines, synced: true, source };
  }
  if (record.plainLyrics) {
    const lines = distributePlain(record.plainLyrics, duration);
    if (lines.length > 0) return { lines, synced: false, source };
  }
  return null;
}

/**
 * Fetch lyrics, widening the match rather than the provider list.
 *
 * LRCLIB is the only source with frame-accurate lyrics, so it is tried first
 * and hardest: every candidate pair, exact lookup then ranked search, taking
 * whichever form comes back (synced preferred, plain accepted). Only then does
 * the plain-text-only provider run, for the tracks LRCLIB does not carry.
 *
 * Provider notes: the ChartLyrics endpoint that used to be third here is dead
 * (the host no longer completes a TLS handshake), which meant every miss paid
 * a connection timeout before giving up. It has been removed rather than
 * replaced with another unverified host.
 */
export const fetchLyrics = action({
  args: {
    title: v.string(),
    artist: v.string(),
    album: v.optional(v.string()),
    duration: v.optional(v.number()),
  },
  handler: async (ctx, { title, artist, album, duration }): Promise<FetchLyricsResult | null> => {
    const dur = duration && duration > 0 ? duration : 210; // reasonable default
    const candidates = buildCandidates(title, artist);
    const deadline = Date.now() + LOOKUP_BUDGET_MS;
    const left = () => Date.now() < deadline;

    // Cached hits and cached misses both come back immediately.
    for (const candidate of candidates) {
      const cached = await ctx.runQuery(api.lyrics.cacheGet, { key: cacheKey(candidate) });
      if (cached) {
        if (cached.missing) return { lines: [], synced: false, source: "cache", missing: true };
        return {
          lines: cached.lines as LyricLine[],
          synced: cached.synced,
          source: cached.source,
        };
      }
    }

    const store = async (candidate: Candidate, result: FetchLyricsResult | null) => {
      await ctx.runMutation(internal.lyrics.cachePut, {
        key: cacheKey(candidate),
        lines: result?.lines ?? [],
        synced: result?.synced ?? false,
        source: result?.source ?? "none",
        missing: result === null,
        fetchedAt: Date.now(),
      });
    };

    // 1. LRCLIB, exact lookup per candidate. One request yields both forms.
    for (const candidate of candidates) {
      if (!left()) break;
      const record = await lrclibGet(candidate, album, dur);
      if (!record) continue;
      const result = toResult(record, "lrclib", dur);
      if (result) {
        await store(candidate, result);
        return result;
      }
    }

    // 2. LRCLIB search, ranked. Reaches versions LRCLIB stores under a
    //    slightly different name than the one we were handed.
    for (const candidate of candidates) {
      if (!left()) break;
      const record = await lrclibSearch(candidate, dur);
      if (!record) continue;
      const result = toResult(record, "lrclib", dur);
      if (result) {
        await store(candidate, result);
        return result;
      }
    }

    // 3. Plain-text provider, for the tracks LRCLIB does not carry at all.
    for (const candidate of candidates) {
      if (!left() || !candidate.artist) break;
      const text = await lyricsOvh(candidate);
      if (!text) continue;
      const lines = distributePlain(text, dur);
      if (lines.length > 0) {
        const result: FetchLyricsResult = { lines, synced: false, source: "lyrics.ovh" };
        await store(candidate, result);
        return result;
      }
    }

    await store(candidates[0]!, null);
    return null;
  },
});

function cacheKey(candidate: Candidate): string {
  return `${candidate.title.toLowerCase()}|${candidate.artist.toLowerCase()}`;
}

export const cacheGet = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const entry = await ctx.db
      .query("lyricsCache")
      .withIndex("byKey", (q) => q.eq("key", key))
      .unique();
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    return {
      lines: entry.lines,
      synced: entry.synced,
      source: entry.source,
      missing: entry.missing,
    };
  },
});

export const cachePut = internalMutation({
  args: {
    key: v.string(),
    lines: v.any(),
    synced: v.boolean(),
    source: v.string(),
    missing: v.boolean(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("lyricsCache")
      .withIndex("byKey", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return;
    }
    await ctx.db.insert("lyricsCache", args);
  },
});
