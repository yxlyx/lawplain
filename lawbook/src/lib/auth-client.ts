"use client";

import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [usernameClient()],
});

export const SIGN_OUT_TRANSITION_START = "lawplain:sign-out-transition-start";
export const SIGN_OUT_TRANSITION_END = "lawplain:sign-out-transition-end";

/** Leave private UI immediately, then finish invalidating the session. */
export async function signOutWithTransition(onSignedOut: () => void) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SIGN_OUT_TRANSITION_START));
  }

  onSignedOut();

  try {
    await authClient.signOut();
  } finally {
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() =>
        window.dispatchEvent(new Event(SIGN_OUT_TRANSITION_END)),
      );
    }
  }
}
