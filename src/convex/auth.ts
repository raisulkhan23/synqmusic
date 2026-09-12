// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { emailOtp } from "./auth/emailOtp";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    emailOtp,
    // OAuth providers — credentials come from the deployment's env vars:
    //   AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET
    //   AUTH_GITHUB_ID, AUTH_GITHUB_SECRET
    Google,
    GitHub,
  ],
});
