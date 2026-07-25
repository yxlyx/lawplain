/**
 * Every shipped research API must be reachable from the UI.
 *
 * Five issues were closed with working, tested data layers and no way for a
 * reader to get at them. This test fails if that happens again: an API route
 * with no client caller is an unfinished feature, not a finished one.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const all = walk("src");
const clientSource = all
  .filter((p) => /\.tsx?$/.test(p) && !p.includes(`${"api"}/`))
  .map((p) => readFileSync(p, "utf8"))
  .join("\n");

/** Routes a browser never calls directly, with the reason. */
const NOT_CALLED_BY_UI = {
  "/api/auth/[...all]": "better-auth talks to it through authClient",
  "/api/v1/[...path]": "public API for external consumers, not this UI",
};

/**
 * APIs that exist with no UI yet, and the issue that owes one. This list must
 * shrink, never grow — the assertion below is an equality, so building a UI
 * without removing its entry fails just as loudly as adding a new orphan.
 */
const PENDING_UI = [
  "/api/ask-private-context", // #200 — deferred until the privacy contract is reviewed
  "/api/research-groups", // #197
  "/api/research-groups/[id]", // #197
  "/api/research-groups/membership", // #197
  "/api/research-search", // #196
];

test("no research API is shipped without a way to reach it", () => {
  const routes = all
    .filter(
      (p) => p.endsWith(`${"api"}/route.ts`) || /api[\\/].*route\.ts$/.test(p),
    )
    .map((p) =>
      `/${p.replace(/^src[\\/]app[\\/]/, "").replace(/[\\/]route\.ts$/, "")}`.replace(
        /\\/g,
        "/",
      ),
    );
  assert.ok(
    routes.length > 20,
    `expected the API surface, saw ${routes.length}`,
  );

  const unreachable = routes.filter((route) => {
    if (route in NOT_CALLED_BY_UI) return false;
    const key = route.replace("/[id]", "").replace(/\/$/, "");
    return !clientSource.includes(key);
  });
  assert.deepEqual(
    unreachable.sort(),
    [...PENDING_UI].sort(),
    "an API gained or lost a client caller: add a UI and remove its PENDING_UI " +
      "entry, or explain a new orphan.\n" +
      `  unreachable now: ${unreachable.join(", ") || "(none)"}`,
  );
});

test("copying a quote keeps the private note an explicit second choice", () => {
  const saved = readFileSync("src/components/SavedAnnotations.tsx", "utf8");
  assert.match(saved, /formatCopiedQuote/);
  // Default copy excludes the note...
  assert.match(saved, /copyQuote\(annotation, false\)/);
  // ...and including it is a separate, differently-labelled control.
  assert.match(saved, /copyQuote\(annotation, true\)/);
  assert.match(saved, /Copy with my note/);
  assert.match(saved, /explicit choice rather than a default/);
});

test("follow-ups can be opened, resolved, reopened and removed", () => {
  const saved = readFileSync("src/components/SavedAnnotations.tsx", "utf8");
  assert.match(saved, /\/api\/follow-ups/);
  assert.match(saved, /Follow up/);
  assert.match(saved, /Resolve/);
  assert.match(saved, /Reopen/);
  assert.match(saved, /Remove follow-up/);
  // Resolved items stay visible rather than disappearing.
  assert.match(saved, /state=all/);
  assert.match(saved, /Follow-up overdue/);
});

test("export offers notes only as a separate, labelled action", () => {
  const workspace = readFileSync("src/components/SavedWorkspace.tsx", "utf8");
  assert.match(workspace, /\/api\/research-export\?format=md"/);
  assert.match(workspace, /\/api\/research-export\?format=json"/);
  assert.match(workspace, /includeNotes=true/);
  assert.match(workspace, /Export with my notes/);
  // The plain exports must not silently carry note text.
  assert.doesNotMatch(
    workspace,
    /format=md&includeNotes=true"[\s\S]{0,40}Export Markdown/,
  );
});
