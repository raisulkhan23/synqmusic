import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const playSnapshot = {
  source: v.optional(v.string()),
  title: v.optional(v.string()),
  artistName: v.optional(v.string()),
  coverUrl: v.optional(v.string()),
  duration: v.optional(v.number()),
};

/**
 * Record a play of ANY track (catalog-era ids, YouTube video ids, etc.):
 * upserts the user's playHistory row (bumping playCount + playedAt).
 * Remote plays include a title/artist/cover snapshot so stats and history
 * can render them without resolving anything.
 */
export const recordPlay = mutation({
  args: { trackId: v.string(), ...playSnapshot },
  handler: async (ctx, { trackId, source, title, artistName, coverUrl, duration }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Sign in to track listening history");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("playHistory")
      .withIndex("by_user_track", (q) => q.eq("userId", userId).eq("trackId", trackId))
      .first();

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        playedAt: now,
        playCount: existing.playCount + 1,
        ...(source !== undefined ? { source } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(artistName !== undefined ? { artistName } : {}),
        ...(coverUrl !== undefined ? { coverUrl } : {}),
        ...(duration !== undefined ? { duration } : {}),
      });

      // Log the replay in the per-play analytics table (see insert branch).
      await ctx.db.insert("playEvents", {
        userId,
        trackId,
        playedAt: now,
        ...(source !== undefined ? { source } : {}),
        ...(title !== undefined ? { title } : {}),
        ...(artistName !== undefined ? { artistName } : {}),
      });

      return existing.playCount + 1;
    }

    await ctx.db.insert("playHistory", {
      userId,
      trackId,
      playedAt: now,
      playCount: 1,
      source,
      title,
      artistName,
      coverUrl,
      duration,
    });

    // Append-only per-play log — analytics (plays per day, peak hour) read
    // from this instead of playHistory, which is an upsert per track and
    // collapses every replay into one timestamp.
    await ctx.db.insert("playEvents", {
      userId,
      trackId,
      playedAt: now,
      ...(source !== undefined ? { source } : {}),
      ...(title !== undefined ? { title } : {}),
      ...(artistName !== undefined ? { artistName } : {}),
    });

    return 1;
  },
});

/**
 * The user's most recently played tracks (unique, newest first) across all
 * sources. Self-contained rows: title/artist/cover snapshot included.
 */
export const recentlyPlayed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const rows = await ctx.db
      .query("playHistory")
      .withIndex("by_user_playedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 12);

    return rows.map((r) => ({
      trackId: r.trackId,
      playedAt: r.playedAt,
      playCount: r.playCount,
      title: r.title,
      artistName: r.artistName,
      coverUrl: r.coverUrl,
      duration: r.duration,
    }));
  },
});

/**
 * The user's most played tracks by total play count, across all sources.
 */
export const mostPlayed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const rows = await ctx.db
      .query("playHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    rows.sort((a, b) => b.playCount - a.playCount);
    return rows.slice(0, limit ?? 8).map((r) => ({
      trackId: r.trackId,
      playedAt: r.playedAt,
      playCount: r.playCount,
      title: r.title,
      artistName: r.artistName,
      coverUrl: r.coverUrl,
      duration: r.duration,
    }));
  },
});

/**
 * The track the user listened to last (for "Continue listening").
 */
export const continueListening = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const last = await ctx.db
      .query("playHistory")
      .withIndex("by_user_playedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .first();

    if (!last) return null;
    return {
      trackId: last.trackId,
      playedAt: last.playedAt,
      title: last.title,
      artistName: last.artistName,
      coverUrl: last.coverUrl,
    };
  },
});

/**
 * Full listening-statistics dashboard data for the signed-in user —
 * counted across ALL sources (every play of every song, catalog or not):
 * totals, most played, daily activity for the last 30 days, monthly
 * history, listening streaks and most-active hours.
 */
export const listeningStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const rows = await ctx.db
      .query("playHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (rows.length === 0) {
      return {
        totalPlays: 0,
        uniqueSongs: 0,
        totalSeconds: 0,
        topTracks: [],
        dailyActivity: [],
        monthlyActivity: [],
        streak: 0,
        activeHours: [] as number[],
      };
    }

    const totalPlays = rows.reduce((sum, r) => sum + r.playCount, 0);
    const totalSeconds = rows.reduce(
      (sum, r) => sum + (r.duration ?? 0) * r.playCount,
      0,
    );

    // Top tracks by play count, with self-contained display info.
    const topTracks = [...rows]
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 10)
      .map((r) => ({
        trackId: r.trackId,
        playCount: r.playCount,
        playedAt: r.playedAt,
        title: r.title ?? "Unknown song",
        artistName: r.artistName ?? "Unknown artist",
        coverUrl: r.coverUrl ?? "",
        duration: r.duration,
      }));

    // Daily activity for the last 30 days (weight by playCount).
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const daily: { day: string; label: string; plays: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const dayStart = today.getTime() - i * dayMs;
      const next = dayStart + dayMs;
      const plays = rows
        .filter((r) => r.playedAt >= dayStart && r.playedAt < next)
        .reduce((sum, r) => sum + r.playCount, 0);
      const d = new Date(dayStart);
      daily.push({
        day: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        plays,
      });
    }

    // Monthly activity for the last 12 months.
    const monthly: { month: string; plays: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const start = d.getTime();
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const plays = rows
        .filter((r) => r.playedAt >= start && r.playedAt < end)
        .reduce((sum, r) => sum + r.playCount, 0);
      monthly.push({ month: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), plays });
    }

    // Listening streak — consecutive days (ending today or yesterday) with plays.
    const playedDaySet = new Set(rows.map((r) => new Date(r.playedAt).setHours(0, 0, 0, 0)));
    let streak = 0;
    const todayStart = today.getTime();
    const startOffset = playedDaySet.has(todayStart) ? 0 : 1;
    for (let i = startOffset; ; i++) {
      if (playedDaySet.has(todayStart - i * dayMs)) streak++;
      else break;
    }

    // Most active listening hours (0-23 buckets).
    const hourBuckets = new Array(24).fill(0) as number[];
    for (const r of rows) {
      hourBuckets[new Date(r.playedAt).getHours()] += r.playCount;
    }

    return {
      totalPlays,
      uniqueSongs: rows.length,
      totalSeconds,
      topTracks,
      dailyActivity: daily,
      monthlyActivity: monthly,
      streak,
      activeHours: hourBuckets,
    };
  },
});

/**
 * Clear all listening history for the signed-in user.
 */
export const clearHistory = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError("Sign in first");
    }
    const rows = await ctx.db
      .query("playHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const events = await ctx.db
      .query("playEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of [...rows, ...events]) {
      await ctx.db.delete(row._id);
    }
    return rows.length;
  },
});
