import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("search history refills the visible list after deleting one item", () => {
  const source = read("src/components/SearchExplorer.tsx");
  assert.match(source, /const loadRecentSearches = useCallback/);
  assert.match(source, /method: "DELETE"/);
  assert.match(source, /await loadRecentSearches\(\{ clearOnError: false \}\)/);
});

test("saved answers expose an accessible full-answer toggle", () => {
  const source = read("src/components/SavedAnswers.tsx");
  assert.match(source, /expandedAnswerIds/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{answerId\}/);
  assert.match(source, /Read full answer/);
  assert.match(source, /Hide full answer/);
});

test("recently viewed documents require auth, are persisted, and stay off the saved page", () => {
  const route = read("src/app/api/recently-viewed/route.ts");
  const lib = read("src/lib/recently-viewed.ts");
  const migration = read("migrations/0011_recently_viewed_documents.sql");
  const savedPage = read("src/app/saved/page.tsx");

  assert.match(route, /getSession\(req\.headers\)/);
  assert.match(route, /Authentication required/);
  assert.match(lib, /ON CONFLICT\(userId, docType, docId\) DO UPDATE/);
  assert.match(lib, /LIMIT \?/);
  assert.match(migration, /REFERENCES user\(id\) ON DELETE CASCADE/);
  assert.match(migration, /idx_recently_viewed_documents_user_doc/);
  assert.doesNotMatch(savedPage, /RecentlyViewedDocuments/);
  assert.match(savedPage, /Your saved documents live here\./);
  assert.doesNotMatch(
    savedPage,
    /Your saved judgments and statutes live here\./,
  );
});

test("recently viewed page uses concise copy", () => {
  const recentsPage = read("src/app/recents/page.tsx");
  const recentsList = read("src/components/RecentlyViewedList.tsx");

  assert.match(recentsPage, /Documents you have opened while signed in\./);
  assert.doesNotMatch(recentsPage, /newest first/);
  assert.doesNotMatch(recentsPage, /re-running searches/);
  assert.doesNotMatch(
    recentsList,
    /Documents you have opened while signed in\.\s*<br \/>\s*Sign in or create an account to get started\./,
  );
  assert.match(
    recentsList,
    /body="Sign in or create an account to get started\."/,
  );
  assert.doesNotMatch(recentsList, /quickly resume your research/);
});

test("supported document pages record recently viewed documents", () => {
  for (const path of [
    "src/app/judgment/[citation]/page.tsx",
    "src/app/statute/[reference]/page.tsx",
    "src/app/document/[kind]/[id]/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /RecentlyViewedRecorder/);
  }
});
