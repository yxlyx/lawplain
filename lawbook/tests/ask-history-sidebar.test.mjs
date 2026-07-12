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

test("selecting a history thread returns focus to the prompt composer", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /const pendingHistoryFocusRef = useRef<string \| null>/);
  assert.match(source, /data-ask-history-thread=\{t\.id\}/);
  assert.match(
    source,
    /pendingHistoryFocusRef\.current = id;[\s\S]*inputRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(
    source,
    /window\.matchMedia\("\(max-width: 1023px\)"\)\.matches[\s\S]*setSidebarOpen\(false\)/,
  );
  assert.match(
    source,
    /const threadLoad = loadThread\(id, "bottom"\);[\s\S]*focusComposerAfterHistorySelection\(id\);[\s\S]*threadLoad\.then\(settleHistoryFocus, settleHistoryFocus\)/,
  );
  assert.match(source, /ref=\{bindComposerInput\}/);
  assert.match(
    source,
    /document\.activeElement === previousComposer[\s\S]*composer\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(source, /!loadComplete && focused === document\.body/);
  assert.match(source, /composer\?\.focus\(\{ preventScroll: true \}\)/);
});

test("starting a new chat returns focus to the prompt composer", () => {
  const source = read("src/components/AskAgent.tsx");

  assert.match(source, /const pendingNewChatFocusRef = useRef\(false\)/);
  assert.match(
    source,
    /pendingNewChatFocusRef\.current = true;\s*inputRef\.current\?\.focus\(\{ preventScroll: true \}\);[\s\S]*resetChatState\(\{ createPlaceholder: true, abortCurrent: false \}\)/,
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{\s*if \(!pendingNewChatFocusRef\.current\) return;\s*pendingNewChatFocusRef\.current = false;\s*inputRef\.current\?\.focus\(\{ preventScroll: true \}\);\s*\}\)/,
  );
  assert.match(
    source,
    /setSidebarOpen\(!window\.matchMedia\("\(max-width: 1023px\)"\)\.matches\)/,
  );
});
test("history chats open at the bottom while Saved Answers target one answer", () => {
  const source = read("src/components/AskAgent.tsx");
  const savedAnswers = read("src/components/SavedAnswers.tsx");

  assert.match(source, /type ThreadScrollIntent = "bottom" \| "saved-answer"/);
  assert.match(
    source,
    /scrollIntent: ThreadScrollIntent = "bottom"[\s\S]*pendingThreadScrollRef\.current = \{\s*threadId,\s*intent: scrollIntent/,
  );
  assert.match(
    source,
    /request\?\.intent !== "bottom"[\s\S]*request\.threadId !== activeThreadId[\s\S]*scroller\.scrollTop = scroller\.scrollHeight[\s\S]*pendingThreadScrollRef\.current = null/,
  );
  assert.match(source, /const threadLoad = loadThread\(id, "bottom"\)/);
  assert.match(
    source,
    /messageIdFromChatHash\(window\.location\.hash\)[\s\S]*"saved-answer"[\s\S]*loadThread\(initialThreadId, scrollIntent\)/,
  );
  assert.match(
    source,
    /request\?\.intent !== "saved-answer"[\s\S]*target\.scrollIntoView\(\{ block: "start" \}\)/,
  );
  assert.match(savedAnswers, /`#answer-\$\{a\.messageId\}`/);
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
  assert.doesNotMatch(source, /lg:translate-x-36/);
  assert.match(source, /transition-\[transform,width,border-color\]/);
  assert.match(source, /lg:w-0 lg:border-transparent/);
  assert.match(source, /translate-x-0 lg:w-\[19rem\]/);
  assert.match(source, /min-w-72[^"]*transition-\[transform,opacity\]/);
  assert.match(source, /translate-x-0 opacity-100 delay-75/);
  assert.doesNotMatch(source, /rounded-r-2xl/);
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
  assert.match(source, /flex h-10 items-center px-3/);
  assert.match(
    source,
    /text-\[13px\] font-semibold leading-none uppercase tracking-wide/,
  );
  assert.match(source, /flex h-10 w-full items-center gap-2/);
  assert.doesNotMatch(source, /min-h-14 items-center border-b/);
  assert.match(source, /bg-surface-2\/30/);
  assert.match(source, /hover:bg-background\/70/);
  assert.match(appShell, /const askRoute = pathname\.startsWith\("\/ask"\)/);
  assert.match(appShell, /askRoute \? "" : "mx-auto max-w-6xl"/);
  assert.match(askPage, /min-h-0 w-full overflow-hidden/);
  assert.match(threadPage, /min-h-0 w-full overflow-hidden/);
  assert.match(
    appShell,
    /askRoute && askSidebarOpen \? "lg:ml-72 lg:rounded-l-2xl" : ""/,
  );
  assert.match(
    appShell,
    /transition-opacity duration-\[50ms\][\s\S]*signingOut[\s\S]*\? "pointer-events-none opacity-0"[\s\S]*: "opacity-100"/,
  );
  assert.doesNotMatch(appShell, /blur-\[2px\]|scale-\[0\.995\]/);
  assert.match(appShell, /flex h-14 w-full items-center justify-between/);
  assert.match(appShell, /h-5 w-5 translate-y-px/);
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
    /const fetchedMatchesOptimisticRun =[\s\S]*fetched\?\.runId === thread\.runId/,
  );
  assert.match(
    source,
    /fetched\?\.status[\s\S]*fetched\.status !== thread\.status[\s\S]*fetchedMatchesOptimisticRun[\s\S]*fetchedLastPromptAt >= thread\.lastPromptAt/,
  );
  assert.match(source, /older completion racing a newer running follow-up/);
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
  assert.match(source, /runId\?: string \| null/);
  assert.match(source, /runId: snapshot\.runId/);
  assert.match(source, /const runId = resumeRunId \?\? crypto\.randomUUID\(\)/);
  assert.match(
    source,
    /upsertOptimisticThread\(\{[\s\S]*runId,[\s\S]*status: "running"/,
  );
  assert.match(source, /return \{\s*\.\.\.fetched,\s*\.\.\.thread,\s*\}/);
});

test("ask run hosts mark completed background threads unread done", () => {
  const askRouteSource = read("src/app/api/ask/route.ts");
  const doSource = read("src/server/ask-run-do.ts");
  const memorySource = read("src/server/ask-run-memory.ts");
  const threadsSource = read("src/lib/ask-threads.ts");

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
  assert.match(memorySource, /unreadOnlyIfRunning: true/);
  assert.match(doSource, /WHEN \? = 1 AND status = 'running' THEN 1/);
  assert.match(
    threadsSource,
    /\? = 1 AND \(\? = 0 OR status = 'running'\) THEN 1/,
  );
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
  assert.match(source, /loadThreads\(open, \(\) => cancelled\)/);
  assert.match(
    source,
    /const hasUnreadDoneThread = allItems\.some\([\s\S]*thread\.status === "done" && thread\.unread/,
  );
  assert.match(source, /onUnreadDoneChange\(hasUnreadDoneThread\)/);
  assert.doesNotMatch(source, /completedInBackground/);
  assert.match(source, /status: "done",\s*unread: true/);
  assert.match(
    source,
    /const unreadDone =[\s\S]*!researching && status === "done" && t\.unread/,
  );
  assert.doesNotMatch(
    source,
    /\{t\.title \|\| "Untitled"\}[\s\S]{0,160}shrink-0 rounded-full bg-accent/,
  );
  assert.match(source, /if \(!hasRunningThreads\) return/);
  assert.doesNotMatch(source, /if \(!open \|\| !hasRunningThreads\) return/);
  assert.match(
    source,
    /pollRunningThreads\(\)[\s\S]*setInterval\(pollRunningThreads, 2_000\)/,
  );
  assert.match(
    source,
    /window\.addEventListener\("focus", pollWhenVisible\)[\s\S]*document\.addEventListener\("visibilitychange", pollWhenVisible\)/,
  );
  assert.match(appShell, /askSidebarUnread && !askSidebarOpen/);
  assert.match(
    source,
    /activeStatus === "running"[\s\S]*t\.status &&[\s\S]*t\.status !== "running"/,
  );
});

test("the persistent app header discovers and dots completions", () => {
  const source = read("src/components/AskAgent.tsx");
  const appShell = read("src/components/AppShell.tsx");

  assert.match(appShell, /fetch\("\/api\/ask-threads"/);
  assert.match(
    appShell,
    /thread\.status === "done" && thread\.unread === true/,
  );
  assert.match(appShell, /hasRunningThread[\s\S]*nextPollMs = 5_000/);
  assert.match(
    appShell,
    /window\.addEventListener\("focus", refreshWhenVisible\)[\s\S]*document\.addEventListener\("visibilitychange", refreshWhenVisible\)/,
  );
  assert.match(
    appShell,
    /window\.removeEventListener\("focus", refreshWhenVisible\)[\s\S]*document\.removeEventListener\("visibilitychange", refreshWhenVisible\)/,
  );
  assert.match(
    appShell,
    /tab\.href === "\/ask" && askSidebarUnread[\s\S]*title="Completed chat"[\s\S]*bg-accent/,
  );
  assert.doesNotMatch(appShell, />\s*Done\s*</);
  assert.match(
    source,
    /return \(\) => \{\s*setAskSidebarAvailable\(false\);\s*setSidebarOpen\(false\);\s*\}/,
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
    /readLocalThreadSnapshots\(sessionUserId\)\.find\([\s\S]*snapshot\.runId === ar\.runId/,
  );
  assert.match(
    source,
    /const activeRunKey = askCacheKey\(sessionUserId, "activeRun"\)/,
  );
  assert.match(source, /sessionStorage\.removeItem\(activeRunKey\)/);
  assert.match(
    source,
    /undefined,\s*true,\s*data\.thread\?\.status !== "running",\s*\)/,
  );
  assert.match(source, /setBusy\(!silentReplay\)/);
  assert.match(
    source,
    /sendGenerationRef\.current !== sendGeneration \|\| silentReplay/,
  );
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
    /useLayoutEffect\(\(\) => \{[\s\S]*void loadThread\(initialThreadId, scrollIntent\)/,
  );
  assert.match(
    source,
    /askCacheKey\(sessionUserId, LAST_THREAD_ID_KEY\)[\s\S]*localStorage\.getItem\(lastThreadKey\)[\s\S]*void loadThread\(lastThreadId\)/,
  );
});

test("guests can open Ask but submitting requires an account", () => {
  const source = read("src/components/AskAgent.tsx");
  const appShell = read("src/components/AppShell.tsx");
  const askPage = read("src/app/ask/page.tsx");
  const threadPage = read("src/app/ask/[id]/page.tsx");
  const askRoute = read("src/app/api/ask/route.ts");
  const authMenu = read("src/components/AuthMenu.tsx");

  assert.match(
    source,
    /return userId \? `ask:v2:\$\{userId\}:\$\{key\}` : null/,
  );
  assert.doesNotMatch(
    source,
    /if \(!sessionPending && !sessionUserId\) return null/,
  );
  assert.match(
    source,
    /if \(!isSignedIn\) \{[\s\S]*Please sign in to use Ask Lawplain\./,
  );
  assert.match(
    source,
    /Please\{" "\}[\s\S]*sign in[\s\S]*or\{" "\}[\s\S]*sign up/,
  );
  assert.match(appShell, /const visibleNav = NAV;/);
  assert.doesNotMatch(appShell, /NAV\.filter\([\s\S]*tab\.href !== "\/ask"/);
  assert.doesNotMatch(askPage, /getSession|redirect\(/);
  assert.match(
    askPage,
    /<AskAgent initialContext=\{context \?\? undefined\} \/>/,
  );
  assert.match(threadPage, /getSession\(new Headers\(await headers\(\)\)\)/);
  assert.match(threadPage, /redirect\(`\/sign-in\?next=/);
  assert.match(
    threadPage,
    /getThread\(session\.user\.id, id\)[\s\S]*if \(!thread\) notFound\(\)/,
  );
  assert.match(askRoute, /if \(!session\?\.user\?\.id\)/);
  assert.match(askRoute, /status: 401/);
  assert.match(
    authMenu,
    /await signOutWithTransition\(\(\) => \{[\s\S]*router\.replace\("\/"\)/,
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
