import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
      following: v.optional(v.array(v.id("users"))), // social follows
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // catalog track ids liked by a user (ordered by when they were liked)
    likedSongs: defineTable({
      userId: v.id("users"),
      trackId: v.string(), // id of the track in the SYNQ demo catalog
      createdAt: v.number(),
    })
      .index("by_user_track", ["userId", "trackId"])
      .index("by_user", ["userId"]),

    // playback snapshots for liked remote tracks (YouTube/Spotify chart items
    // that don't exist in the catalog), keyed by the same trackId as likedSongs
    likedRemote: defineTable({
      userId: v.id("users"),
      trackId: v.string(),
      title: v.string(),
      artistName: v.string(),
      coverUrl: v.string(),
      duration: v.number(),
      youtubeId: v.optional(v.string()),
      source: v.string(),
      createdAt: v.number(),
    })
      .index("by_user_track", ["userId", "trackId"])
      .index("by_user", ["userId"]),

    // user-created playlists referencing track ids (any source)
    playlists: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      trackIds: v.array(v.string()),
      // Durable display/playback metadata. Optional so existing playlists stay
      // valid; new saves never rely on a fragile id-only lookup later.
      trackSnapshots: v.optional(
        v.array(
          v.object({
            id: v.string(),
            title: v.string(),
            artist: v.string(),
            album: v.optional(v.string()),
            coverUrl: v.string(),
            duration: v.number(),
            youtubeId: v.optional(v.string()),
          }),
        ),
      ),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user", ["userId"]),

    // listening history: one row per user+track, updated on every play.
    // Covers ALL sources — remote plays store a title/artist/cover snapshot.
    playHistory: defineTable({
      userId: v.id("users"),
      trackId: v.string(), // opaque per-source id (youtube video id, etc.)
      playedAt: v.number(),
      playCount: v.number(),
      source: v.optional(v.string()),
      title: v.optional(v.string()),
      artistName: v.optional(v.string()),
      coverUrl: v.optional(v.string()),
      duration: v.optional(v.number()),
    })
      .index("by_user_track", ["userId", "trackId"])
      .index("by_user_playedAt", ["userId", "playedAt"])
      .index("by_user", ["userId"]),

    // One row per individual play. playHistory is an upsert per track (so
    // replaying a song only bumps a counter), which made time-based stats
    // impossible — analytics read from this append-only log instead.
    playEvents: defineTable({
      userId: v.id("users"),
      trackId: v.string(),
      playedAt: v.number(),
      source: v.optional(v.string()),
      title: v.optional(v.string()),
      artistName: v.optional(v.string()),
    })
      .index("by_playedAt", ["playedAt"])
      .index("by_user", ["userId"]),

    // playlists imported from other music services. Tracks are stored as
    // snapshots (title + artist) and resolved to playable YouTube tracks at
    // play time — so a CSV export from any provider works without OAuth.
    // audit trail of playlist changes (rename, add/remove tracks, delete)
    playlistEvents: defineTable({
      userId: v.id("users"),
      playlistId: v.id("playlists"),
      playlistName: v.string(),
      kind: v.string(), // "created" | "renamed" | "added" | "removed" | "deleted"
      detail: v.optional(v.string()), // e.g. track title
      at: v.number(),
    }).index("by_playlist", ["playlistId"]),

    // social: who follows whom (stored on the follower for cheap reads)
    listeningRooms: defineTable({
      name: v.string(),
      hostId: v.id("users"),
      hostName: v.optional(v.string()),
      members: v.array(
        v.object({
          userId: v.id("users"),
          name: v.optional(v.string()),
          joinedAt: v.number(),
        }),
      ),
      nowPlaying: v.optional(v.string()),
      updatedAt: v.number(),
    }).index("by_host", ["hostId"]),

    importedPlaylists: defineTable({
      userId: v.id("users"),
      name: v.string(),
      origin: v.string(), // e.g. "YouTube Music", "Spotify", "Other"
      tracks: v.array(
        v.object({
          title: v.string(),
          artist: v.string(),
          duration: v.optional(v.number()),
        }),
      ),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Lyrics lookups, keyed by the normalised "title|artist" that actually hit.
    // Stores misses too (`missing: true`) so a song with no lyrics anywhere is
    // only looked up once instead of on every open of the panel. Free lyrics
    // APIs are rate limited, so this is what keeps the panel responsive.
    lyricsCache: defineTable({
      key: v.string(),
      lines: v.any(), // LyricLine[]; empty when `missing`
      synced: v.boolean(),
      source: v.string(),
      missing: v.boolean(),
      fetchedAt: v.number(),
    }).index("byKey", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
