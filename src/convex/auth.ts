// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";

const TRUSTED_ORIGINS = [
  process.env.CONVEX_SITE_URL,
  process.env.SITE_URL,
  "https://synqmusic.freebuff.app",
  "https://synq-music.freebuff.app",
].filter((x): x is string => !!x).map((x) => x.replace(/\/$/, ""));

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    emailOtp,
    // OAuth providers — credentials come from the deployment's env vars:
    //   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
    //   AUTH_GITHUB_ID, AUTH_GITHUB_SECRET
    Google,
    GitHub,
  ],
  callbacks: {
    // The deployment's SITE_URL may point at the convex.site host, which
    // rejects post-login redirects back to the real frontend domain.
    // Explicitly allow our own trusted frontend origins here.
    redirect: async ({ redirectTo }) => {
      if (!redirectTo.startsWith("/")) {
        try {
          const origin = new URL(redirectTo).origin.replace(/\/$/, "");
          if (!TRUSTED_ORIGINS.includes(origin)) {
            throw new Error(`Untrusted redirect origin: ${origin}`);
          }
        } catch (e) {
          if ((e as Error).message.startsWith("Untrusted")) throw e;
          throw new Error(`Invalid redirect URL: ${redirectTo}`);
        }
      }
      return redirectTo;
    },
  },
});
