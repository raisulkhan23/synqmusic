// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";

const SITE_URL_ENV = (process.env.SITE_URL ?? process.env.CONVEX_SITE_URL ?? "").replace(/\/$/, "");

const TRUSTED_ORIGINS = [
  SITE_URL_ENV,
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
    // The deployment's SITE_URL points at the convex.site host, so
    // absolute redirects to the real frontend domain get rejected by the
    // default callback. The client sends a RELATIVE path; we resolve it
    // against the trusted frontend origin here.
    redirect: async ({ redirectTo }) => {
      const base = TRUSTED_ORIGINS.find((o) => o.includes("freebuff.app")) ?? SITE_URL_ENV;
      if (redirectTo.startsWith("/") || redirectTo.startsWith("?")) {
        return `${base}${redirectTo}`;
      }
      // Absolute URL — only allow trusted origins.
      const origin = new URL(redirectTo).origin.replace(/\/$/, "");
      if (!TRUSTED_ORIGINS.includes(origin)) {
        throw new Error(`Untrusted redirect origin: ${origin}`);
      }
      return redirectTo;
    },
  },
});
