import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const trackSnapshotValidator = v.object({
  id: v.string(),
  title: v.string(),
  artist: v.string(),
  album: v.optional(v.string()),
  coverUrl: v.string(),
  duration: v.number(),
  youtubeId: v.optional(v.string()),
});

type TrackSnapshot = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl: string;
  duration: number;
  youtubeId?: string;
};

const requireUser = async (ctx: MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Sign in to manage playlists");
  }
  return userId;
};

async function logEvent(
  ctx: MutationCtx,
  userId: Id<"users">,
  playlistId: Id<"playlists">,
  playlistName: string,
  kind: string,
  detail?: string,
) {
  await ctx.db.insert("playlistEvents", {
    userId,
    playlistId,
    playlistName,
    kind,
    detail,
    at: Date.now(),
  });
}

/**
 * Create a playlist for the signed-in user. Returns the new playlist id.
 */
export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    tracks: v.optional(v.array(trackSnapshotValidator)),
  },
  handler: async (ctx, { name, description, tracks }) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const playlistName = name.trim() || "New playlist";
    const snapshots = tracks?.filter((track) => track.id.trim()) ?? [];
    const uniqueSnapshots = [...new Map(snapshots.map((track) => [track.id, track])).values()];
    const uniqueIds = uniqueSnapshots.map((track) => track.id);
    const id = await ctx.db.insert("playlists", {
      userId,
      name: playlistName,
      description,
      trackIds: uniqueIds,
      ...(uniqueSnapshots.length > 0 ? { trackSnapshots: uniqueSnapshots } : {}),
      createdAt: now,
      updatedAt: now,
    });
    await logEvent(ctx, userId, id, playlistName, "created");
    return id;
  },
});

/**
 * Delete one of the signed-in user's playlists.
 */
export const remove = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const userId = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      throw new ConvexError("Playlist not found");
    }
    const name = playlist.name;
    await ctx.db.delete(playlistId);
    await logEvent(ctx, userId, playlistId, name, "deleted");
  },
});

/**
 * Rename one of the signed-in user's playlists.
 */
export const rename = mutation({
  args: { playlistId: v.id("playlists"), name: v.string() },
  handler: async (ctx, { playlistId, name }) => {
    const userId = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      throw new ConvexError("Playlist not found");
    }
    await ctx.db.patch(playlistId, {
      name: name.trim() || playlist.name,
      updatedAt: Date.now(),
    });
    await logEvent(ctx, userId, playlistId, name.trim() || playlist.name, "renamed", playlist.name);
  },
});

/**
 * Add a catalog track to a playlist (no duplicates).
 */
export const addTrack = mutation({
  args: {
    playlistId: v.id("playlists"),
    trackId: v.string(),
    detail: v.optional(v.string()),
    track: v.optional(trackSnapshotValidator),
  },
  handler: async (ctx, { playlistId, trackId, detail, track }) => {
    const userId = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      throw new ConvexError("Playlist not found");
    }
    if (!playlist.trackIds.includes(trackId)) {
      const snapshots = playlist.trackSnapshots ?? [];
      const nextSnapshots = track
        ? [...snapshots.filter((snapshot) => snapshot.id !== trackId), track]
        : snapshots;
      await ctx.db.patch(playlistId, {
        trackIds: [...playlist.trackIds, trackId],
        ...(nextSnapshots.length > 0 ? { trackSnapshots: nextSnapshots } : {}),
        updatedAt: Date.now(),
      });
      await logEvent(ctx, userId, playlistId, playlist.name, "added", detail);
    }
  },
});

/**
 * Remove a catalog track from a playlist.
 */
export const removeTrack = mutation({
  args: {
    playlistId: v.id("playlists"),
    trackId: v.string(),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { playlistId, trackId, detail }) => {
    const userId = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      throw new ConvexError("Playlist not found");
    }
    const removed = playlist.trackIds.includes(trackId);
    const snapshots = playlist.trackSnapshots?.filter((track) => track.id !== trackId);
    await ctx.db.patch(playlistId, {
      trackIds: playlist.trackIds.filter((id) => id !== trackId),
      ...(playlist.trackSnapshots !== undefined ? { trackSnapshots: snapshots ?? [] } : {}),
      updatedAt: Date.now(),
    });
    if (removed) await logEvent(ctx, userId, playlistId, playlist.name, "removed", detail);
  },
});

/** Change history for one playlist (newest first, capped). */
export const changeHistory = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const events = await ctx.db
      .query("playlistEvents")
      .withIndex("by_playlist", (q) => q.eq("playlistId", playlistId))
      .order("desc")
      .take(30);
    return events.filter((e) => e.userId === userId);
  },
});

/**
 * Save a playlist imported from another music service (CSV/text export).
 * Tracks are snapshots — resolved to playable streams at play time.
 */
export const saveImported = mutation({
  args: {
    name: v.string(),
    origin: v.string(),
    tracks: v.array(
      v.object({
        title: v.string(),
        artist: v.string(),
        duration: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, { name, origin, tracks }) => {
    const userId = await requireUser(ctx);
    if (tracks.length === 0) {
      throw new ConvexError("No tracks found in the import");
    }
    const id = await ctx.db.insert("importedPlaylists", {
      userId,
      name: name.trim() || "Imported playlist",
      origin,
      tracks,
      createdAt: Date.now(),
    });
    return id;
  },
});

/**
 * Replace all tracks of an imported playlist (used to cache resolved plays).
 */
export const removeImported = mutation({
  args: { playlistId: v.id("importedPlaylists") },
  handler: async (ctx, { playlistId }) => {
    const userId = await requireUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      throw new ConvexError("Playlist not found");
    }
    await ctx.db.delete(playlistId);
  },
});

/**
 * The signed-in user's imported playlists, newest first.
 */
export const myImportedPlaylists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("importedPlaylists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * The signed-in user's playlists, most recently updated first.
 */
export const myPlaylists = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return [];
    }
    return await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * A single playlist owned by the signed-in user.
 */
export const get = query({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null || playlist.userId !== userId) {
      return null;
    }
    return playlist;
  },
});