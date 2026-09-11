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
