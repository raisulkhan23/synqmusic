import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";

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
    // Enrich with the auth provider(s) each account signed up with —
    // Convex Auth keeps one authAccounts row per linked credential
    // ("github", "google", "email-otp", "anonymous", …).
    const accounts = await ctx.db.query("authAccounts").collect();
    const byUser = new Map<string, { provider: string; accountId: string | null }[]>();
    for (const acc of accounts) {
      const arr = byUser.get(acc.userId) ?? [];
      // tokenIdentifier embeds the provider prefix, e.g. "github:123456" —
      // extract a readable provider + external account id when present.
      const raw = (acc as unknown as { tokenIdentifier?: string }).tokenIdentifier ?? "";
      const providerMatch = raw.match(/^(github|google|email-otp|anonymous)/);
      const provider = providerMatch?.[1] ?? "credentials";
      const externalId = raw.includes(":") ? raw.split(":").slice(1).join(":") : null;
      arr.push({ provider, accountId: externalId });
      byUser.set(acc.userId, arr);
    }
    return users
      .map((u) => ({
        _id: u._id,
        _creationTime: u._creationTime,
        name: u.name ?? null,
        email: u.email ?? null,
        image: u.image ?? null,
        isAnonymous: u.isAnonymous ?? false,
        role: u.role ?? null,
        providers: (byUser.get(u._id) ?? []).map((a) => a.provider),
        githubId: (byUser.get(u._id) ?? []).find((a) => a.provider === "github")?.accountId ?? null,
      }))
      .sort((a, b) => a._creationTime - b._creationTime);
  },
});

/**
 * Resolve GitHub account details for a user (admin only). Uses the public
 * GitHub API with the external account id stored by Convex Auth — no token
 * needed for public profile info.
 */
export const githubProfile = action({
  args: { githubId: v.string() },
  handler: async (_ctx, { githubId }) => {
    const numeric = githubId.replace(/[^0-9]/g, "");
    const res = await fetch(`https://api.github.com/user/${numeric}`, {
      headers: { "User-Agent": "soniq-admin", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    return {
      login: (j.login as string) ?? null,
      name: (j.name as string) ?? null,
      avatarUrl: (j.avatar_url as string) ?? null,
      htmlUrl: (j.html_url as string) ?? null,
      publicRepos: (j.public_repos as number) ?? 0,
      createdAt: (j.created_at as string) ?? null,
    };
  },
});

/** Moderate: delete any playlist (admin only). */
export const moderateDeletePlaylist = mutation({
  args: { playlistId: v.id("playlists") },
  handler: async (ctx, { playlistId }) => {
    await getAdminUser(ctx);
    await ctx.db.delete(playlistId);
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

/**
 * Every user's liked songs — both catalog likes and remote (streamed) likes
 * with their metadata snapshots (admin only).
 */
export const listAllLikes = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const [likes, remotes, users] = await Promise.all([
      ctx.db.query("likedSongs").collect(),
      ctx.db.query("likedRemote").collect(),
      ctx.db.query("users").collect(),
    ]);
    const owners = new Map(users.map((u) => [u._id, u]));
    const remoteByUserTrack = new Map(
      remotes.map((r) => [`${r.userId}:${r.trackId}`, r]),
    );
    return likes
      .map((like) => {
        const owner = owners.get(like.userId);
        const remote = remoteByUserTrack.get(`${like.userId}:${like.trackId}`);
        return {
          _id: like._id,
          trackId: like.trackId,
          createdAt: like.createdAt,
          ownerName: owner?.name ?? null,
          ownerEmail: owner?.email ?? null,
          title: remote?.title ?? like.trackId,
          artistName: remote?.artistName ?? "SYNQ catalog",
          coverUrl: remote?.coverUrl ?? "",
          duration: remote?.duration ?? 0,
        };
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
  },
});

/**
 * Recent signups across the deployment (admin only).
 */
export const recentSignups = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await getAdminUser(ctx);
    const users = await ctx.db.query("users").collect();
    return users
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, limit ?? 10)
      .map((u) => ({
        _id: u._id,
        _creationTime: u._creationTime,
        name: u.name ?? null,
        email: u.email ?? null,
        isAnonymous: u.isAnonymous ?? false,
        role: u.role ?? null,
      }));
  },
});

/**
 * Platform-wide listening statistics for the last 14 days (admin only):
 * total plays, unique tracks, daily activity, and most active hour.
 */
export const platformListeningStats = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const dayMs = 24 * 60 * 60 * 1000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const windowStart = today.getTime() - 13 * dayMs;
    // The dashboard is a 14-day view. Use the time index so this does not
    // scan the entire append-only event history on every admin refresh.
    const events = await ctx.db
      .query("playEvents")
      .withIndex("by_playedAt", (q) => q.gte("playedAt", windowStart))
      .collect();

    const totalPlays = events.length;

    // plays per day, last 14 days
    const daily: { day: string; label: string; plays: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const start = today.getTime() - i * dayMs;
      const next = start + dayMs;
      const plays = events
        .filter((h) => h.playedAt >= start && h.playedAt < next)
        .length;
      const d = new Date(start);
      daily.push({
        day: d.toISOString().slice(0, 10),
        label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        plays,
      });
    }

    // most active hour of day (0-23)
    const hourBuckets = new Array(24).fill(0) as number[];
    for (const h of events) hourBuckets[new Date(h.playedAt).getHours()] += 1;
    const peakHour = totalPlays === 0 ? null : hourBuckets.indexOf(Math.max(...hourBuckets));

    // distinct tracks in the catalog history
    const uniqueTracks = new Set(events.map((h) => h.trackId)).size;

    return { totalPlays, uniqueTracks, daily, peakHour, hourBuckets };
  },
});

/**
 * Listening rooms overview for moderation (admin only).
 */
export const listRooms = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const rooms = await ctx.db.query("listeningRooms").collect();
    const users = await ctx.db.query("users").collect();
    const names = new Map(users.map((u) => [u._id, u.name ?? u.email ?? "Anonymous"]));
    return rooms
      .map((r) => ({
        _id: r._id,
        name: r.name,
        hostName: r.hostName ?? names.get(r.hostId) ?? "Unknown",
        hostId: r.hostId,
        memberCount: r.members.length,
        nowPlaying: r.nowPlaying ?? null,
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** Delete a listening room (admin only). */
export const deleteRoom = mutation({
  args: { roomId: v.id("listeningRooms") },
  handler: async (ctx, { roomId }) => {
    await getAdminUser(ctx);
    await ctx.db.delete(roomId);
  },
});

/**
 * Imported playlists audit (admin only) — shows what users brought in from
 * other platforms.
 */
export const listImports = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const [imports, users] = await Promise.all([
      ctx.db.query("importedPlaylists").collect(),
      ctx.db.query("users").collect(),
    ]);
    const names = new Map(users.map((u) => [u._id, u.name ?? u.email ?? "Anonymous"]));
    return imports
      .map((i) => ({
        _id: i._id,
        name: i.name,
        origin: i.origin,
        trackCount: i.tracks.length,
        ownerName: names.get(i.userId) ?? "Unknown",
        createdAt: i.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Delete an imported playlist (admin only). */
export const deleteImport = mutation({
  args: { importId: v.id("importedPlaylists") },
  handler: async (ctx, { importId }) => {
    await getAdminUser(ctx);
    await ctx.db.delete(importId);
  },
});

/** Rename any playlist (admin only). */
export const renamePlaylist = mutation({
  args: { playlistId: v.id("playlists"), name: v.string() },
  handler: async (ctx, { playlistId, name }) => {
    await getAdminUser(ctx);
    const trimmed = name.trim();
    if (!trimmed) throw new ConvexError("Name cannot be empty");
    const p = await ctx.db.get(playlistId);
    if (p === null) throw new ConvexError("Playlist not found");
    await ctx.db.patch(playlistId, { name: trimmed, updatedAt: Date.now() });
  },
});

/** Clear a user's entire listening history (admin only). */
export const clearUserHistory = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await getAdminUser(ctx);
    const rows = await ctx.db
      .query("playHistory")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const events = await ctx.db
      .query("playEvents")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const row of [...rows, ...events]) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/**
 * Global listening stats: most played tracks across the whole deployment
 * (admin only).
 */
export const globalTopTracks = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const history = await ctx.db.query("playHistory").collect();
    const byTrack = new Map<string, { plays: number; listeners: Set<string> }>();
    for (const h of history) {
      const entry = byTrack.get(h.trackId) ?? { plays: 0, listeners: new Set<string>() };
      entry.plays += h.playCount;
      entry.listeners.add(h.userId);
      byTrack.set(h.trackId, entry);
    }
    return [...byTrack.entries()]
      .map(([trackId, v]) => ({ trackId, plays: v.plays, listeners: v.listeners.size }))
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 25);
  },
});

/** Per-user activity rollup: likes, playlists, plays (admin only). */
export const userActivity = query({
  args: {},
  handler: async (ctx) => {
    await getAdminUser(ctx);
    const [users, likes, playlists, history] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("likedSongs").collect(),
      ctx.db.query("playlists").collect(),
      ctx.db.query("playHistory").collect(),
    ]);
    return users
      .map((u) => ({
        _id: u._id,
        name: u.name ?? null,
        email: u.email ?? null,
        likes: likes.filter((l) => l.userId === u._id).length,
        playlists: playlists.filter((p) => p.userId === u._id).length,
        plays: history
          .filter((h) => h.userId === u._id)
          .reduce((sum, h) => sum + h.playCount, 0),
        lastPlayedAt: history
          .filter((h) => h.userId === u._id)
          .reduce((max, h) => Math.max(max, h.playedAt), 0),
      }))
      .sort((a, b) => b.plays - a.plays);
  },
});