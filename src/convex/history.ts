import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Record a play of a catalog track: upserts the user's playHistory row for
 * the track (bumping playCount + playedAt). Only catalog tracks are tracked —
 * YouTube results are ephemeral.
 */
export const recordPlay = mutation({
  args: { trackId: v.string() },
  handler: async (ctx, { trackId }) => {
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
      await ctx.db.patch(existing._id, { playedAt: now, playCount: existing.playCount + 1 });
      return existing.playCount + 1;
    }

    await ctx.db.insert("playHistory", {
      userId,
      trackId,
      playedAt: now,
      playCount: 1,
    });
    return 1;
  },
});

/**
 * The user's most recently played catalog tracks (unique, newest first).
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

    return rows.map((r) => ({ trackId: r.trackId, playedAt: r.playedAt, playCount: r.playCount }));
  },
});

/**
 * The user's most played catalog tracks by total play count.
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
    }));
  },
});

/**
 * The track the user listened to last (for "Continue listening") plus how far
 * in they got. Returns null when there is no history yet.
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

    return last ? { trackId: last.trackId, playedAt: last.playedAt } : null;
  },
});

/**
 * Full listening-statistics dashboard data for the signed-in user:
 * totals, most played, daily activity for the last 30 days, monthly history,
 * and listening streaks.
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
        topTracks: [],
        dailyActivity: [],
        monthlyActivity: [],
        streak: 0,
        activeHours: [] as number[],
      };
    }

    const totalPlays = rows.reduce((sum, r) => sum + r.playCount, 0);

    // Top tracks by play count.
    const topTracks = [...rows]
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, 10)
      .map((r) => ({ trackId: r.trackId, playCount: r.playCount, playedAt: r.playedAt }));

    // Daily activity for the last 30 days (by play events — each row's
    // playedAt is its most recent play, so weight by playCount).
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
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return rows.length;
  },
});
