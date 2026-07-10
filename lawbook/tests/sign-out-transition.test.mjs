import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("signing out fades the private workspace before returning to Search", () => {
  const authClient = read("src/lib/auth-client.ts");
  const authMenu = read("src/components/AuthMenu.tsx");
  const appShell = read("src/components/AppShell.tsx");

  assert.match(authClient, /SIGN_OUT_TRANSITION_START/);
  assert.doesNotMatch(authClient, /SIGN_OUT_FADE_MS/);
  assert.doesNotMatch(authClient, /await new Promise<void>/);
  assert.match(
    authClient,
    /onSignedOut\(\);[\s\S]*await authClient\.signOut\(\)/,
  );
  assert.match(authClient, /await authClient\.signOut\(\)/);
  assert.match(authMenu, /await signOutWithTransition/);
  assert.match(appShell, /transition-opacity duration-\[50ms\]/);
  assert.match(appShell, /pointer-events-none opacity-0/);
  assert.doesNotMatch(appShell, /blur-\[2px\]/);
  assert.match(
    appShell,
    /tab\.href !== "\/ask" \|\| Boolean\(sessionUserId\) \|\| signingOut/,
  );
  assert.match(appShell, /tab\.href === "\/ask" && signingOut/);
  assert.match(appShell, /setSigningOut\(false\)[\s\S]*\[pathname\]/);
});
