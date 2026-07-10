import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("ask history button toggles the thread sidebar", () => {
  const source = read("src/components/AskAgent.tsx");
  const appShell = read("src/components/AppShell.tsx");
  const chrome = read("src/components/chrome/ChromeContext.tsx");

  assert.match(
    chrome,
    /const \[askSidebarOpen, setAskSidebarOpen\] = useState\(false\)/,
  );
  assert.match(
    appShell,
    /onClick=\{\(\) => setAskSidebarOpen\(\(open\) => !open\)\}/,
  );
  assert.match(
    appShell,
    /aria-label=\{askSidebarOpen \? "Close history" : "Open history"\}/,
  );
  assert.match(appShell, /aria-expanded=\{askSidebarOpen\}/);
  assert.match(source, /askSidebarOpen: sidebarOpen/);
  assert.match(source, /open=\{sidebarOpen\}/);
  assert.match(source, /onClose=\{\(\) => setSidebarOpen\(false\)\}/);
});

test("ask places the sidebar toggle before the Lawplain header logo", () => {
  const source = read("src/components/AskAgent.tsx");
  const appShell = read("src/components/AppShell.tsx");
  const globalStyles = read("src/app/globals.css");
  const askPage = read("src/app/ask/page.tsx");
  const threadPage = read("src/app/ask/[id]/page.tsx");

  assert.match(
    appShell,
    /askRoute && askSidebarAvailable[\s\S]*<button[\s\S]*<Link href="\/"/,
  );
  assert.doesNotMatch(source, /fixed left-4 top-/);
  assert.match(source, /duration-300[\s\S]*lg:translate-x-36/);
  assert.match(source, /transition-\[transform,width,border-color\]/);
  assert.match(source, /lg:w-0 lg:border-transparent/);
  assert.match(source, /min-w-72[^"]*transition-\[transform,opacity\]/);
  assert.match(source, /translate-x-0 opacity-100 delay-75/);
  assert.match(source, /motion-reduce:transition-none/);
  assert.match(
    globalStyles,
    /--ease-smooth-out: cubic-bezier\(0\.22, 1, 0\.36, 1\)/,
  );
  assert.doesNotMatch(source, /Back to search/);
  assert.doesNotMatch(source, /sticky top-14 z-20/);
  assert.doesNotMatch(source, /shadow-xl/);
  assert.match(source, /bg-transparent transition-opacity/);
  assert.match(source, /<ThreadSidebar[\s\S]*onNewChat=\{newChat\}/);
  assert.doesNotMatch(source, /aria-label=\{sidebarOpen/);
  assert.match(source, /flex min-h-14 items-center px-4/);
  assert.doesNotMatch(source, /min-h-14 items-center border-b/);
  assert.match(source, /bg-surface-2\/30/);
  assert.match(source, /hover:bg-background\/70/);
  assert.match(appShell, /const askRoute = pathname\.startsWith\("\/ask"\)/);
  assert.match(appShell, /askRoute \? "" : "mx-auto max-w-6xl"/);
  assert.doesNotMatch(askPage, /Back to search/);
  assert.doesNotMatch(threadPage, /Back to search/);
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
  assert.match(
    source,
    /title: shortTitle\([\s\S]*messagesRef\.current\.find\([\s\S]*\?\.text \?\? q/,
  );
  assert.match(source, /loading && allItems\.length === 0/);
});

test("ask history accepts reconciled terminal status over stale optimistic running", () => {
  const source = read("src/components/AskAgent.tsx");
  const routeSource = read("src/app/api/ask-threads/route.ts");

  assert.match(
    source,
    /fetched\?\.status[\s\S]*thread\.status === "running"[\s\S]*fetched\.status !== "running"[\s\S]*fetchedLastPromptAt >= thread\.lastPromptAt/,
  );
  assert.match(source, /return \{\s*\.\.\.thread,\s*\.\.\.fetched,\s*\}/);
  assert.match(source, /return \{\s*\.\.\.fetched,\s*\.\.\.thread,\s*\}/);
  assert.match(routeSource, /reconcileRunningThreads/);
  assert.match(routeSource, /thread\.status !== "running" \|\| !thread\.runId/);
  assert.match(routeSource, /runStatus === "stopped" \? "stopped" : "done"/);
  assert.match(routeSource, /unread: status === "done"/);
  assert.match(routeSource, /const unread = body\.unread === true/);
  assert.match(routeSource, /if \(unread && status === "done"\)/);
});

test("a follow-up prompt immediately outranks stale completed server state", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(
    source,
    /const fetchedLastPromptAt = fetched[\s\S]*fetched\.lastPromptAt[\s\S]*fetched\.createdAt/,
  );
  assert.match(
    source,
    /fetchedLastPromptAt >= thread\.lastPromptAt[\s\S]*return \{\s*\.\.\.thread,\s*\.\.\.fetched/,
  );
  assert.match(source, /return \{\s*\.\.\.fetched,\s*\.\.\.thread,\s*\}/);
});

test("ask run hosts mark completed background threads unread done", () => {
  const askRouteSource = read("src/app/api/ask/route.ts");
  const doSource = read("src/server/ask-run-do.ts");
  const memorySource = read("src/server/ask-run-memory.ts");

  assert.match(askRouteSource, /userId: session\.user\.id,[\s\S]*threadId,/);
  assert.match(
    doSource,
    /userId: body\.userId,[\s\S]*threadId: body\.threadId/,
  );
  assert.match(doSource, /private async updateThreadStatus/);
  assert.match(doSource, /persistedStatus === "done" \? 1 : 0/);
  assert.match(memorySource, /import \{ updateThreadRunStatus \}/);
  assert.match(memorySource, /threadId\?: string/);
  assert.match(memorySource, /await updateThreadStatus\(input, run\.status\)/);
  assert.match(memorySource, /unread: persistedStatus === "done"/);
});

test("ask thread detail reconciles completed background runs before marking seen", () => {
  const routeSource = read("src/app/api/ask-threads/route.ts");

  assert.match(
    routeSource,
    /if \(id\) \{[\s\S]*const thread = await getThread\(session\.user\.id, id\)/,
  );
  assert.match(
    routeSource,
    /const \[reconciled\] = await reconcileRunningThreads\(session\.user\.id, \[[\s\S]*thread,[\s\S]*\]\)/,
  );
  assert.match(
    routeSource,
    /markThreadSeen\(session\.user\.id, id\)[\s\S]*Response\.json\(\{ thread: \{ \.\.\.reconciled, unread: false \} \}\)/,
  );
});

test("ask history polls running threads while closed and advertises unread done", () => {
  const source = read("src/components/AskAgent.tsx");
  const appShell = read("src/components/AppShell.tsx");

  assert.match(source, /onUnreadDoneChange=\{setAskSidebarUnread\}/);
  assert.match(
    source,
    /const hasUnreadDoneThread = allItems\.some\([\s\S]*thread\.status !== "running" && thread\.unread/,
  );
  assert.match(source, /onUnreadDoneChange\(hasUnreadDoneThread\)/);
  assert.match(
    source,
    /const completedInBackground =[\s\S]*finalThreadId !== threadIdRef\.current/,
  );
  assert.match(source, /unread: completedInBackground/);
  assert.match(source, /if \(!hasRunningThreads\) return/);
  assert.doesNotMatch(source, /if \(!open \|\| !hasRunningThreads\) return/);
  assert.match(appShell, /askSidebarUnread && !askSidebarOpen/);
  assert.match(
    source,
    /activeStatus === "running"[\s\S]*t\.status &&[\s\S]*t\.status !== "running"/,
  );
});

test("ask thread sidebar orders by latest prompt, not latest view or save", () => {
  const source = read("src/components/AskAgent.tsx");
  const serverSource = read("src/lib/ask-threads.ts");
  const migration = read("migrations/0016_ask_threads_last_prompt.sql");

  assert.match(source, /function compareThreadsByLastPromptDesc/);
  assert.match(source, /lastPromptAt:[\s\S]*createdAt:[\s\S]*updatedAt:/);
  assert.match(source, /startedAt: promptAt/);
  assert.match(
    source,
    /return \[next, \.\.\.rest\]\.sort\(compareThreadsByLastPromptDesc\)/,
  );
  assert.match(source, /sort\(compareThreadsByLastPromptDesc\)/);
  assert.match(
    serverSource,
    /SELECT id, title, cite, kind, sourceHref, messageCount, lastPromptAt, createdAt, updatedAt/,
  );
  assert.match(
    serverSource,
    /ORDER BY lastPromptAt DESC, createdAt DESC, id DESC/,
  );
  assert.match(
    serverSource,
    /WHEN excluded\.lastPromptAt > ask_threads\.lastPromptAt[\s\S]*THEN excluded\.lastPromptAt[\s\S]*ELSE ask_threads\.lastPromptAt/,
  );
  assert.match(migration, /SET lastPromptAt = createdAt/);
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

test("returning to Ask paints the cached latest thread before refreshing it", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /useLayoutEffect/);
  assert.match(
    source,
    /const restoreOptimisticSnapshot = \(reconnect = true\)/,
  );
  assert.match(
    source,
    /flushThread\(\);\s*restoreOptimisticSnapshot\(false\);\s*const ac/,
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*void loadThread\(initialThreadId\)/,
  );
  assert.match(
    source,
    /localStorage\.getItem\(LAST_THREAD_ID_KEY\)[\s\S]*void loadThread\(lastThreadId\)/,
  );
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
