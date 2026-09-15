import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Social backend: listening rooms (shared queues). Room membership is live —
 * everyone who joined sees the host's now-playing.
 */

/** Rooms list for the Listening Rooms tab (live membership counts). */
export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("listeningRooms").collect();
    return rooms
      .map((r) => ({
        _id: r._id,
        name: r.name,
        hostName: r.hostName ?? null,
        members: r.members ?? [],
        listenerCount: (r.members ?? []).length,
        nowPlaying: r.nowPlaying ?? null,
      }))
      .sort((a, b) => b.listenerCount - a.listenerCount);
  },
});

export const createRoom = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Sign in first");
    const me = await ctx.db.get(userId);
    const trimmed = name.trim().slice(0, 60);
    if (trimmed.length === 0) throw new ConvexError("Room name can't be empty");

    await ctx.db.insert("listeningRooms", {
      name: trimmed,
      hostId: userId,
      hostName: me?.name ?? undefined,
      members: [{ userId, name: me?.name ?? undefined, joinedAt: Date.now() }],
      updatedAt: Date.now(),
    });
  },
});

export const joinRoom = mutation({
  args: { roomId: v.id("listeningRooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Sign in first");
    const me = await ctx.db.get(userId);
    const room = await ctx.db.get(roomId);
    if (room === null) throw new ConvexError("Room not found");

    const members = (room.members ?? []).filter((m) => m.userId !== userId);
    members.push({ userId, name: me?.name ?? undefined, joinedAt: Date.now() });
    await ctx.db.patch(roomId, { members, updatedAt: Date.now() });
  },
});

export const leaveRoom = mutation({
  args: { roomId: v.id("listeningRooms") },
  handler: async (ctx, { roomId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Sign in first");
    const room = await ctx.db.get(roomId);
    if (room === null) return;

    // Last member leaves → the room closes itself.
    const members = (room.members ?? []).filter((m) => m.userId !== userId);
    if (members.length === 0) {
      await ctx.db.delete(roomId);
      return;
    }
    await ctx.db.patch(roomId, { members, updatedAt: Date.now() });
  },
});

/** Update what a room's host is playing (called by the host's player). */
export const setRoomNowPlaying = mutation({
  args: { roomId: v.id("listeningRooms"), title: v.union(v.string(), v.null()) },
  handler: async (ctx, { roomId, title }) => {
    const userId = await getAuthUserId(ctx);
    const room = await ctx.db.get(roomId);
    if (room === null || room.hostId !== userId) return;
    await ctx.db.patch(roomId, {
      nowPlaying: title ?? undefined,
      updatedAt: Date.now(),
    });
  },
});
