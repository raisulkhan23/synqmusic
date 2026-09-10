import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

type Ctx = QueryCtx | MutationCtx;

const getAdminUser = async (ctx: Ctx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError("Sign in to access the admin area");
  }
  const user = await ctx.db.get(userId);
  if (user === null || user.role !== "admin") {
    throw new ConvexError("Admin access required");
  }
  return userId;
};

/**
 * Bootstrap: the very first account on the deployment becomes an admin so the
 * workspace can be managed from day one. No-op for everyone else.
 */
export const claimAdminIfEmpty = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;

    const me = await ctx.db.get(userId);
    if (me === null || me.role !== undefined) return false;

    const users = await ctx.db.query("users").collect();
    const adminExists = users.some((u) => u.role === "admin");
    if (adminExists) return false;

    await ctx.db.patch(userId, { role: "admin" });
    return true;
  },
});

/**
 * Admin status + headline numbers. Returns null when the caller is not an
 * admin so the UI can render a clean "restricted" state.
 */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const me = await ctx.db.get(userId);
    if (me === null || me.role !== "admin") return null;

    const [users, playlists, likes] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("playlists").collect(),
      ctx.db.query("likedSongs").collect(),
    ]);

    return {
      isAdmin: true,
      counts: {
        users: users.length,
        admins: users.filter((u) => u.role === "admin").length,
        playlists: playlists.length,
        likes: likes.length,
      },
    };
  },
});

/** Every account on the deployment (admin only). */
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .map((u) => ({
        _id: u._id,
        _creationTime: u._creationTime,
        name: u.name ?? null,
        email: u.email ?? null,
        isAnonymous: u.isAnonymous ?? false,
        role: u.role ?? null,
      }))
      .sort((a, b) => a._creationTime - b._creationTime);
  },
});

/** Promote or demote a user (admin only; you cannot change your own role). */
export const setRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("user"), v.literal("member"), v.null()),
  },
  handler: async (ctx, { userId, role }) => {
    const adminId = await getAdminUser(ctx);
    if (userId === adminId) {
      throw new ConvexError("You cannot change your own role");
    }
    const target = await ctx.db.get(userId);
    if (target === null) {
      throw new ConvexError("User not found");
    }
    await ctx.db.patch(userId, { role: role ?? undefined });
  },
});

/** Delete an account and everything they created (admin only). */
export const deleteUser = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const adminId = await getAdminUser(ctx);
    if (userId === adminId) {
      throw new ConvexError("You cannot delete your own account");
    }

    const likes = await ctx.db
      .query("likedSongs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const like of likes) {
      await ctx.db.delete(like._id);
    }

    const playlists = await ctx.db
      .query("playlists")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const playlist of playlists) {
      await ctx.db.delete(playlist._id);
    }

    await ctx.db.delete(userId);
  },
});

/** Every playlist across the deployment, with its owner (admin only). */
export const listAllPlaylists = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const [playlists, users] = await Promise.all([
      ctx.db.query("playlists").collect(),
      ctx.db.query("users").collect(),
    ]);
    const owners = new Map(users.map((u) => [u._id, u]));
    return playlists
      .map((p) => {
        const owner = owners.get(p.userId);
        return {
          _id: p._id,
          _creationTime: p._creationTime,
          name: p.name,
          trackCount: p.trackIds.length,
          ownerName: owner?.name ?? null,
          ownerEmail: owner?.email ?? null,
        };
      })
      .sort((a, b) => b._creationTime - a._creationTime);
  },
});

/** Delete any playlist on the deployment (admin only). */
export const deletePlaylist = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    await getAdminUser(ctx);
    const playlist = await ctx.db.get(playlistId);
    if (playlist === null) {
      throw new ConvexError("Playlist not found");
    }
    await ctx.db.delete(playlistId);
  },
});