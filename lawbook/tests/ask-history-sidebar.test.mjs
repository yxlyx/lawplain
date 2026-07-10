import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("ask history button toggles the thread sidebar", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(
    source,
    /const \[sidebarOpen, setSidebarOpen\] = useState\(false\)/,
  );
  assert.match(
    source,
    /onClick=\{\(\) => setSidebarOpen\(\(open\) => !open\)\}/,
  );
  assert.match(source, /aria-expanded=\{sidebarOpen\}/);
  assert.match(source, /open=\{sidebarOpen\}/);
  assert.match(source, /onClose=\{\(\) => setSidebarOpen\(false\)\}/);
});

test("new chat appears optimistically in history and is renamed on first prompt", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /const \[optimisticThreads, setOptimisticThreads\]/);
  assert.match(
    source,
    /setOptimisticThreads\(\(threads\) => \{[\s\S]*\.\.\.threads\.filter\(\(item\) => item\.id !== thread\.id\)/,
  );
  assert.match(source, /function ThreadSidebar\([\s\S]*optimisticThreads/);
  assert.match(
    source,
    /const allItems = \[[\s\S]*\.\.\.optimisticThreads\.map/,
  );
  assert.match(source, /title: "New Chat"/);
  assert.match(
    source,
    /optimisticThreadSnapshotsRef\.current\.set\(nextThreadId,[\s\S]*messages: \[\]/,
  );
  assert.match(source, /createPlaceholder: true/);
  assert.match(source, /setSidebarOpen\(true\)/);
  assert.match(source, /title: shortTitle\(q\)/);
  assert.match(source, /loading && allItems\.length === 0/);
});

test("ask thread sidebar orders by chat creation, not latest update", () => {
  const source = read("src/components/AskAgent.tsx");
  const serverSource = read("src/lib/ask-threads.ts");

  assert.match(source, /function compareThreadsByCreatedAtDesc/);
  assert.match(source, /createdAt:[\s\S]*updatedAt:/);
  assert.match(source, /sort\(compareThreadsByCreatedAtDesc\)/);
  assert.doesNotMatch(source, /b\.updatedAt\s*-\s*a\.updatedAt/);
  assert.match(
    serverSource,
    /SELECT id, title, cite, kind, sourceHref, messageCount, createdAt, updatedAt/,
  );
  assert.match(serverSource, /ORDER BY createdAt DESC, id DESC/);
});

test("loading and reconnecting a thread cannot send from an empty UI", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /const \[loadingThreadId, setLoadingThreadId\]/);
  assert.match(source, /loadingThreadId && !internalReconnect/);
  assert.match(source, /setLoadingThreadId\(threadId\)/);
  assert.match(source, /setLoadingThreadId\(null\)/);
  assert.match(source, /loadThreadRef\.current\?\.\(ar\.threadId\)/);
  assert.doesNotMatch(source, /sendRef\.current\?\.\(ar\.question, ar\.runId/);
  assert.match(
    source,
    /readLocalThreadSnapshots\(\)\.find\([\s\S]*snapshot\.runId === ar\.runId/,
  );
  assert.match(source, /sessionStorage\.removeItem\("ask:activeRun"\)/);
  assert.match(source, /undefined,\s*true,\s*\)/);
});

test("thread persistence keeps fuller transcripts over stale saves", () => {
  const source = read("src/lib/ask-threads.ts");
  const migration = read("migrations/0015_ask_thread_transcript_score.sql");

  assert.match(source, /function transcriptScore/);
  assert.match(source, /transcriptScore, cite, kind/);
  assert.match(
    source,
    /COALESCE\(excluded\.transcriptScore, 0\) < COALESCE\(ask_threads\.transcriptScore, 0\)/,
  );
  assert.match(
    source,
    /ask_threads\.runId IS NOT NULL[\s\S]*ask_threads\.runId != excluded\.runId[\s\S]*COALESCE\(excluded\.transcriptScore, 0\) <= COALESCE\(ask_threads\.transcriptScore, 0\)/,
  );
  assert.match(migration, /ADD COLUMN transcriptScore/);
  assert.match(migration, /UPDATE ask_threads/);
  assert.match(migration, /LENGTH\(messages\) \+ \(messageCount \* 1000\)/);
});

test("new chat preserves the previous thread while creating the blank placeholder", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /const snapshot = \[\.\.\.messagesRef\.current\]/);
  assert.match(source, /const currentThreadId = threadIdRef\.current/);
  assert.match(source, /upsertOptimisticThread\(\{[\s\S]*id: currentThreadId/);
  assert.match(
    source,
    /persistThreadSnapshot\(snapshot, \{[\s\S]*threadId: currentThreadId/,
  );
  assert.match(source, /const runThreadId = threadIdRef\.current/);
  assert.match(source, /const finalThreadId = runThreadId/);
  assert.match(source, /sendGenerationRef\.current \+= 1/);
  assert.match(source, /abortCurrent = true/);
  assert.match(
    source,
    /resetChatState\(\{\s*createPlaceholder: true,\s*abortCurrent: false,?\s*\}\)/,
  );
  assert.match(source, /let runSnapshot/);
  assert.match(source, /const finalSnapshot = runSnapshot\.map/);
});
