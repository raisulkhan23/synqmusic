import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.authHelpers.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);

    if (user === null) {
      return null;
    }

    return user;
  },
});

/**
 * Use this function internally to get the current user data. Remember to handle the null user case.
 * @param ctx
 * @returns
 */
export const getCurrentUser = async (ctx: QueryCtx) => {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get(userId);
};

/**
 * Update the signed-in user's display name. Used by the Settings dialog.
 */
export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Sign in first");
    const trimmed = name.trim().slice(0, 40);
    if (trimmed.length === 0) throw new ConvexError("Name can't be empty");
    await ctx.db.patch(userId, { name: trimmed });
    return trimmed;
  },
});

/** Update the signed-in user's profile picture with a small data URL. */
export const updateImage = mutation({
  args: { image: v.optional(v.string()) },
  handler: async (ctx, { image }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new ConvexError("Sign in first");
    if (image !== undefined) {
      if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i.test(image)) {
        throw new ConvexError("Profile picture must be an image data URL");
      }
      // Convex documents are limited to 1 MiB; leave room for the document
      // metadata and keep the avatar responsive rather than storing huge art.
      if (image.length > 700_000) {
        throw new ConvexError("Profile picture must be smaller than 700 KB");
      }
    }
    await ctx.db.patch(userId, { image });
    return image ?? null;
  },
});
