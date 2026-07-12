"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bubble,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  Message as MessageRow,
} from "@/components/ask/message";
import { useChrome } from "@/components/chrome/ChromeContext";

import {
  ArrowUpIcon,
  BookIcon,
  CheckIcon,
  CopyIcon,
  SparkleIcon,
  StopIcon,
  UserIcon,
  XIcon,
} from "@/components/icons";
import type { ChatContext } from "@/lib/agent";
import { authClient } from "@/lib/auth-client";

type ChatEvent =
  | { type: "delta"; text: string }
  | {
      type: "progress";
      phase: string;
      message: string;
      elapsedMs?: number;
    }
  | {
      type: "tool";
      name: string;
      key?: string;
      summary: string;
      kind?: "search" | "detail" | "setup" | "other";
      duplicate?: boolean;
      count?: number;
    }
  | {
      type: "tool_rejected";
      name: string;
      reason: "budget" | "duplicate";
      message: string;
    }
  | { type: "done"; text: string; costUsd: number; contextTokens: number }
  | { type: "error"; message: string };

type Phase =
  | "starting"
  | "sandbox"
  | "searching"
  | "reading"
  | "thinking"
  | "answering"
  | "done"
  | "stopped"
  | "error";

interface ToolStep {
  id: number;
  key: string;
  kind: "search" | "fetch" | "read" | "setup" | "other";
  label: string;
  count: number;
}

interface ProgressStep {
  id: number;
  message: string;
  elapsedMs?: number;
}

interface Message {
  id: number;
  role: "user" | "assistant";
  /** assistant text, accumulated from deltas (empty while still searching) */
  text: string;
  /** tool calls made while producing this assistant message */
  tools: ToolStep[];
  /** streaming/searching state for an assistant message */
  phase: Phase;
  progress: ProgressStep[];
  startedAt?: number;
  elapsedMs?: number;
  eventCursor?: number;
  error?: string;
  cost?: { usd: number; tokens: number };
}

interface AskQuestionHistoryEntry {
  id: string;
  question: string;
  createdAt: number;
}

interface OptimisticThreadSnapshot {
  messages: Message[];
  runId: string | null;
  status: "running" | "stopped" | "done";
}

type ThreadScrollIntent = "bottom" | "saved-answer";

interface PendingThreadScroll {
  threadId: string;
  intent: ThreadScrollIntent;
}

function messageIdFromChatHash(hash: string): number | null {
  const match = /^(?:#)?(?:answer|message)-(\d+)$/.exec(hash);
  return match ? Number(match[1]) : null;
}

/** Map a raw tool_call into a typed, human-readable step. */
function describeTool(ev: Extract<ChatEvent, { type: "tool" }>): ToolStep {
  const { name, summary } = ev;
  let kind: ToolStep["kind"] = "other";
  let label = summary;

  if (name === "sandbox") {
    kind = "setup";
    label = summary;
  } else if (name === "bash") {
    if (summary.startsWith("search: ")) {
      kind = "search";
      label = `Searching “${summary.slice(8)}”`;
    } else if (summary.startsWith("/v1/judgments/")) {
      kind = "fetch";
      label = `Additional judgment ${decodeURIComponentSafe(summary.split("?")[0].slice("/v1/judgments/".length))}`;
    } else if (summary.startsWith("/v1/statutes/")) {
      const ref = decodeURIComponentSafe(
        summary.split("?")[0].slice("/v1/statutes/".length),
      );
      kind = "fetch";
      label = `Additional statute ${ref}`;
    } else if (summary.startsWith("/v1/")) {
      kind = "fetch";
      label = `Fetching ${summary}`;
    }
  } else if (name === "webfetch") {
    kind = "fetch";
    label = `Fetching ${summary}`;
  } else if (name === "read_file") {
    kind = "read";
    label = `Reading ${summary}`;
  }

  return {
    id: 0,
    key: ev.key ?? `${kind}:${label.toLowerCase()}`,
    kind,
    label,
    count: ev.count ?? 1,
  };
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const PHASE_LABEL: Record<Phase, string> = {
  starting: "Starting research agent",
  sandbox: "Preparing secure sandbox",
  searching: "Searching legal sources",
  reading: "Reading source material",
  thinking: "Planning next step",
  answering: "Writing answer",
  done: "Answer",
  stopped: "Stopped",
  error: "Error",
};

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}m ${rest}s` : `${rest}s`;
}

function mapProgressPhase(phase: string): Phase {
  if (phase === "stopped") return "stopped";
  if (
    phase === "sandbox_start" ||
    phase === "agent_install" ||
    phase === "agent_start"
  )
    return "sandbox";
  if (phase === "searching") return "searching";
  if (phase === "reading") return "reading";
  if (phase === "answering") return "answering";
  return "thinking";
}

function stopBackendRun(runId: string | null, threadId: string): void {
  if (!runId || !threadId) return;
  void fetch("/api/ask/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, threadId }),
    keepalive: true,
  }).catch(() => {
    // best-effort cancellation; the local UI still exits immediately
  });
}

/* ── Markdown answer rendering (react-markdown + GFM) ───────────────── */

const mdComponents: Components = {
  h1: ({ children }) => (
    <h2 className="mt-1 font-serif text-xl font-semibold text-foreground">
      {children}
    </h2>
  ),
  h2: ({ children }) => (
    <h2 className="mt-1 font-serif text-lg font-semibold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-1 font-serif text-base font-semibold text-foreground">
      {children}
    </h3>
  ),
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => {
    const h = href ?? "";
    const internal = h.startsWith("/") || h.startsWith("#");
    return (
      <a
        href={h}
        className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
        {...(internal ? {} : { target: "_blank", rel: "noreferrer noopener" })}
      >
        {children}
      </a>
    );
  },
  ol: ({ children }) => <ol className="ask-ol space-y-1.5">{children}</ol>,
  ul: ({ children }) => (
    <ul className="ask-ul space-y-1.5 pl-5 marker:text-accent">{children}</ul>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code: ({ className, children }) =>
    (className ?? "").includes("language-") ? (
      <code className="font-mono text-[13px]">{children}</code>
    ) : (
      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    <pre className="thin-scroll overflow-x-auto rounded-lg bg-surface-2 p-3 text-[13px]">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 text-muted">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-border" />,
  table: ({ children }) => (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-surface-2 px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top">{children}</td>
  ),
};

const AnswerMarkdown = memo(function AnswerMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="ask-md space-y-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
});

const SUGGESTIONS = [
  "What must a plaintiff prove in a defamation claim?",
  "When can a court strike out a pleading as frivolous?",
  "What are the elements of the tort of misfeasance in public office?",
  "How does Singapore law treat indemnity clauses in contracts?",
];

const TOOL_DOT: Record<ToolStep["kind"], string> = {
  search: "bg-accent",
  fetch: "bg-emerald-500",
  read: "bg-amber-500",
  setup: "bg-violet-500",
  other: "bg-muted-2",
};

const ASK_HISTORY_LIMIT = 50;
const STICKY_BOTTOM_RESUME_PX = 24;
const THREAD_LIST_CACHE_KEY = "threadListCache";
const THREAD_SNAPSHOT_CACHE_KEY = "threadSnapshots";
const LAST_THREAD_ID_KEY = "lastThreadId";
const PENDING_ASK_KEY = "ask:pendingAfterAuth";
const PENDING_ASK_TTL_MS = 30 * 60 * 1000;

type PendingAsk = {
  v: 1;
  question: string;
  context?: {
    kind?: string;
    citation?: string;
  };
  createdAt: number;
};

function savePendingAsk(pending: PendingAsk): boolean {
  try {
    sessionStorage.setItem(PENDING_ASK_KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

function peekPendingAsk(): PendingAsk | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ASK_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingAsk>;
    if (
      parsed.v !== 1 ||
      typeof parsed.question !== "string" ||
      !parsed.question.trim() ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > PENDING_ASK_TTL_MS
    ) {
      clearPendingAsk();
      return null;
    }

    const context =
      parsed.context && typeof parsed.context === "object"
        ? {
            kind:
              typeof parsed.context.kind === "string"
                ? parsed.context.kind
                : undefined,
            citation:
              typeof parsed.context.citation === "string"
                ? parsed.context.citation
                : undefined,
          }
        : undefined;

    return {
      v: 1,
      question: parsed.question.trim(),
      context,
      createdAt: parsed.createdAt,
    };
  } catch {
    clearPendingAsk();
    return null;
  }
}

function clearPendingAsk(): void {
  try {
    sessionStorage.removeItem(PENDING_ASK_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

function hasPendingAsk(): boolean {
  return Boolean(peekPendingAsk());
}

function isCursorOnFirstLine(el: HTMLTextAreaElement): boolean {
  return !el.value.slice(0, el.selectionStart).includes("\n");
}

function isCursorOnLastLine(el: HTMLTextAreaElement): boolean {
  return !el.value.slice(el.selectionEnd).includes("\n");
}

function mergeQuestionHistory(
  history: AskQuestionHistoryEntry[],
  question: string,
): AskQuestionHistoryEntry[] {
  const trimmed = question.trim();
  if (!trimmed) return history;

  return [
    {
      id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      question: trimmed,
      createdAt: Date.now(),
    },
    ...history.filter((entry) => entry.question !== trimmed),
  ].slice(0, ASK_HISTORY_LIMIT);
}

export interface AskAgentProps {
  /** A document the user came from — pinned to the transcript and sent with
   *  every question so the agent grounds its answer in that document. */
  initialContext?: ChatContext;
  /** Thread id when opened at /ask/[id] — restores that saved conversation. */
  initialThreadId?: string;
}

const TITLE_STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "to",
  "do",
  "does",
  "did",
  "is",
  "are",
  "be",
  "what",
  "whats",
  "how",
  "why",
  "when",
  "where",
  "which",
  "who",
  "can",
  "could",
  "would",
  "should",
  "will",
  "there",
  "any",
  "some",
  "other",
  "that",
  "this",
  "these",
  "those",
  "for",
  "and",
  "or",
  "with",
  "about",
  "around",
  "into",
  "from",
  "i",
  "my",
  "me",
  "we",
  "our",
  "us",
  "you",
  "your",
  "singapore",
  "sg",
]);

/** Derive a short, scannable 3-5 word title from the first question. */
function shortTitle(question: string): string {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const key = words.filter((w) => w.length > 1 && !TITLE_STOP.has(w));
  const picked = (key.length >= 2 ? key : words).slice(0, 5);
  const title = picked
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return (title || question.trim()).slice(0, 60) || "Untitled";
}

function serializeMessages(messages: Message[]) {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    text: m.text,
    tools: m.tools,
    progress: m.progress,
    phase: m.phase,
    startedAt: m.startedAt,
    elapsedMs: m.elapsedMs,
    eventCursor: m.eventCursor,
    cost: m.cost,
    error: m.error,
  }));
}

function isLiveAssistant(m: Message): boolean {
  return (
    m.role === "assistant" && !["done", "error", "stopped"].includes(m.phase)
  );
}

function latestAssistantMessage(messages: Message[]): Message | undefined {
  return [...messages].reverse().find((m) => m.role === "assistant");
}

function transcriptScore(messages: Message[]): number {
  return messages.reduce(
    (score, message) =>
      score +
      1000 +
      message.text.length +
      message.progress.length * 20 +
      message.tools.length * 50 +
      (message.eventCursor ?? 0) * 100,
    0,
  );
}

function collapseDuplicateRunningTurns(messages: Message[]): Message[] {
  const pairs = messages
    .map((message, index) => {
      const user = messages[index - 1];
      return isLiveAssistant(message) && user?.role === "user"
        ? {
            assistant: message,
            assistantIndex: index,
            user,
            userIndex: index - 1,
          }
        : null;
    })
    .filter((pair): pair is NonNullable<typeof pair> => Boolean(pair));

  const duplicateQuestions = new Set<string>();
  const pairCounts = new Map<string, number>();
  for (const pair of pairs) {
    const question = pair.user.text.trim();
    if (!question) continue;
    const count = (pairCounts.get(question) ?? 0) + 1;
    pairCounts.set(question, count);
    if (count > 1) duplicateQuestions.add(question);
  }
  if (duplicateQuestions.size === 0) return messages;

  const remove = new Set<number>();
  for (const question of duplicateQuestions) {
    const duplicates = pairs.filter(
      (pair) => pair.user.text.trim() === question,
    );
    const keep = duplicates.reduce((best, pair) => {
      const score =
        (pair.assistant.eventCursor ?? 0) * 1000 +
        pair.assistant.tools.length * 20 +
        pair.assistant.progress.length;
      const bestScore =
        (best.assistant.eventCursor ?? 0) * 1000 +
        best.assistant.tools.length * 20 +
        best.assistant.progress.length;
      return score >= bestScore ? pair : best;
    });
    for (const pair of duplicates) {
      if (pair !== keep) {
        remove.add(pair.userIndex);
        remove.add(pair.assistantIndex);
      }
    }
  }

  return messages.filter((_, index) => !remove.has(index));
}

interface ThreadListItem {
  id: string;
  title: string;
  lastPromptAt: number;
  createdAt: number;
  updatedAt: number;
  runId?: string | null;
  status?: string | null;
  unread?: boolean;
}

interface LocalThreadSnapshot {
  id: string;
  title: string;
  lastPromptAt: number;
  createdAt: number;
  updatedAt: number;
  messages: ReturnType<typeof serializeMessages>;
  runId?: string | null;
  status?: "running" | "stopped" | "done";
  context?: ChatContext;
}

/** Browser caches are only a resilience layer; namespace them by account so
 * a shared browser can never show one user's Ask history to another user. */
function askCacheKey(
  userId: string | null | undefined,
  key: string,
): string | null {
  return userId ? `ask:v2:${userId}:${key}` : null;
}

function readLocalThreadSnapshots(
  userId: string | null | undefined,
): LocalThreadSnapshot[] {
  if (typeof window === "undefined") return [];
  const key = askCacheKey(userId, THREAD_SNAPSHOT_CACHE_KEY);
  if (!key) return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? (parsed as LocalThreadSnapshot[]) : [];
  } catch {
    return [];
  }
}

function writeLocalThreadSnapshots(
  userId: string | null | undefined,
  snapshots: LocalThreadSnapshot[],
): void {
  if (typeof window === "undefined") return;
  const key = askCacheKey(userId, THREAD_SNAPSHOT_CACHE_KEY);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(snapshots.slice(0, 50)));
  } catch {
    // Best-effort browser cache only.
  }
}

function latestPromptTimestamp(messages: Message[], fallback: number): number {
  return messages.reduce(
    (latest, message) =>
      message.role === "user" &&
      typeof message.startedAt === "number" &&
      Number.isFinite(message.startedAt)
        ? Math.max(latest, message.startedAt)
        : latest,
    fallback,
  );
}

function compareThreadsByLastPromptDesc(
  a: Pick<ThreadListItem, "id" | "lastPromptAt" | "createdAt" | "updatedAt">,
  b: Pick<ThreadListItem, "id" | "lastPromptAt" | "createdAt" | "updatedAt">,
): number {
  const aLastPromptAt = Number.isFinite(a.lastPromptAt)
    ? a.lastPromptAt
    : Number.isFinite(a.createdAt)
      ? a.createdAt
      : a.updatedAt;
  const bLastPromptAt = Number.isFinite(b.lastPromptAt)
    ? b.lastPromptAt
    : Number.isFinite(b.createdAt)
      ? b.createdAt
      : b.updatedAt;
  const promptDelta = bLastPromptAt - aLastPromptAt;
  if (promptDelta !== 0) return promptDelta;
  return String(b.id).localeCompare(String(a.id));
}

function localThreadSummaries(
  userId: string | null | undefined,
): ThreadListItem[] {
  return readLocalThreadSnapshots(userId).map((snapshot) => ({
    id: snapshot.id,
    title: snapshot.title,
    lastPromptAt: Number.isFinite(snapshot.lastPromptAt)
      ? snapshot.lastPromptAt
      : Number.isFinite(snapshot.createdAt)
        ? snapshot.createdAt
        : snapshot.updatedAt,
    createdAt: Number.isFinite(snapshot.createdAt)
      ? snapshot.createdAt
      : snapshot.updatedAt,
    updatedAt: snapshot.updatedAt,
    runId: snapshot.runId,
    status: snapshot.status,
  }));
}

function getLocalThreadSnapshot(
  userId: string | null | undefined,
  id: string,
): LocalThreadSnapshot | null {
  return (
    readLocalThreadSnapshots(userId).find((snapshot) => snapshot.id === id) ??
    null
  );
}

function upsertLocalThreadSnapshot(
  userId: string | null | undefined,
  snapshot: LocalThreadSnapshot,
): void {
  const snapshots = readLocalThreadSnapshots(userId).filter(
    (existing) => existing.id !== snapshot.id,
  );
  writeLocalThreadSnapshots(
    userId,
    [snapshot, ...snapshots].sort(compareThreadsByLastPromptDesc),
  );
  const lastThreadKey = askCacheKey(userId, LAST_THREAD_ID_KEY);
  if (!lastThreadKey) return;
  try {
    localStorage.setItem(lastThreadKey, snapshot.id);
  } catch {
    // Best-effort browser cache only.
  }
}

function removeLocalThreadSnapshot(
  userId: string | null | undefined,
  id: string,
): void {
  writeLocalThreadSnapshots(
    userId,
    readLocalThreadSnapshots(userId).filter((snapshot) => snapshot.id !== id),
  );
  const lastThreadKey = askCacheKey(userId, LAST_THREAD_ID_KEY);
  if (!lastThreadKey) return;
  try {
    if (localStorage.getItem(lastThreadKey) === id) {
      localStorage.removeItem(lastThreadKey);
    }
  } catch {
    // Best-effort browser cache only.
  }
}

function deserializeLocalMessages(raw: unknown[]): Message[] {
  return raw.map((m, i): Message => {
    const row =
      m && typeof m === "object" ? (m as Record<string, unknown>) : {};
    const role = row.role === "user" ? "user" : "assistant";
    return {
      id: typeof row.id === "number" ? row.id : i,
      role,
      text: typeof row.text === "string" ? row.text : "",
      tools: Array.isArray(row.tools) ? (row.tools as ToolStep[]) : [],
      progress: Array.isArray(row.progress)
        ? (row.progress as ProgressStep[])
        : [],
      phase:
        row.phase === "starting" ||
        row.phase === "sandbox" ||
        row.phase === "searching" ||
        row.phase === "reading" ||
        row.phase === "thinking" ||
        row.phase === "answering" ||
        row.phase === "done" ||
        row.phase === "stopped" ||
        row.phase === "error"
          ? row.phase
          : "done",
      startedAt: typeof row.startedAt === "number" ? row.startedAt : undefined,
      elapsedMs: typeof row.elapsedMs === "number" ? row.elapsedMs : undefined,
      eventCursor:
        typeof row.eventCursor === "number" ? row.eventCursor : undefined,
      cost:
        row.cost && typeof row.cost === "object"
          ? (row.cost as { usd: number; tokens: number })
          : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
    };
  });
}

export function AskAgent({
  initialContext,
  initialThreadId,
}: AskAgentProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const [sessionWaitExpired, setSessionWaitExpired] = useState(false);
  const authBlocking = sessionPending && !sessionWaitExpired;
  const sessionUserId = session?.user?.id;
  const isSignedIn = Boolean(sessionUserId);
  const query = searchParams.toString();
  const currentPath = `${pathname || "/"}${query ? `?${query}` : ""}`;
  const next = encodeURIComponent(currentPath);
  const signInHref = `/sign-in?next=${next}`;
  const signUpHref = `/sign-up?next=${next}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [questionHistory, setQuestionHistory] = useState<
    AskQuestionHistoryEntry[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState(
    () => initialThreadId ?? crypto.randomUUID(),
  );
  const [threadListVersion, setThreadListVersion] = useState(0);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const [optimisticThreads, setOptimisticThreads] = useState<ThreadListItem[]>(
    [],
  );
  const {
    setHideFooter,
    askSidebarOpen: sidebarOpen,
    setAskSidebarOpen: setSidebarOpen,
    setAskSidebarAvailable,
    setAskSidebarUnread,
  } = useChrome();
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [pinnedContext, setPinnedContext] = useState(initialContext);
  const [now, setNow] = useState(() => Date.now());
  const hasScrollableMessages = messages.length > 0;

  useEffect(() => {
    if (!sessionPending) {
      setSessionWaitExpired(false);
      return;
    }
    const timeout = window.setTimeout(() => setSessionWaitExpired(true), 5000);
    return () => window.clearTimeout(timeout);
  }, [sessionPending]);

  useEffect(() => {
    setAskSidebarAvailable(isSignedIn);
    if (!isSignedIn) {
      setSidebarOpen(false);
      setAskSidebarUnread(false);
    }
    return () => {
      setAskSidebarAvailable(false);
      setSidebarOpen(false);
    };
  }, [isSignedIn, setAskSidebarAvailable, setAskSidebarUnread, setSidebarOpen]);
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const queueingOpenRef = useRef(false);
  const queuedPromptRef = useRef<string | null>(null);
  const pendingSendAfterCleanupRef = useRef<string | null>(null);
  const sendRef = useRef<
    | ((
        text: string,
        resumeRunId?: string,
        resumeFrom?: number,
        resumeStartedAt?: number,
        internalReconnect?: boolean,
        silentReplay?: boolean,
      ) => Promise<boolean>)
    | null
  >(null);
  const historyIndexRef = useRef(-1);
  const draftBeforeHistoryRef = useRef("");
  const msgId = useRef(0);
  const toolId = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  const optimisticThreadSnapshotsRef = useRef<
    Map<string, OptimisticThreadSnapshot>
  >(new Map());
  const deletedThreadIdsRef = useRef<Set<string>>(new Set());
  const loadThreadSeqRef = useRef(0);
  const loadThreadRef = useRef<
    | ((threadId: string, scrollIntent?: ThreadScrollIntent) => Promise<void>)
    | null
  >(null);
  const threadIdRef = useRef<string>("");
  const runIdRef = useRef<string | null>(null);
  const creatingNewChatRef = useRef(false);
  if (!threadIdRef.current) threadIdRef.current = activeThreadId;

  const cacheThreadSnapshot = useCallback(
    (
      snapshot = messagesRef.current,
      options: {
        threadId?: string;
        runId?: string | null;
        context?: ChatContext;
        status?: "running" | "stopped" | "done";
      } = {},
    ) => {
      if (snapshot.length === 0 || !snapshot.some((m) => m.role === "user")) {
        return;
      }
      const threadId = options.threadId ?? threadIdRef.current;
      if (deletedThreadIdsRef.current.has(threadId)) return;
      const latestAssistant = latestAssistantMessage(snapshot);
      const status =
        options.status ??
        (latestAssistant && isLiveAssistant(latestAssistant)
          ? "running"
          : latestAssistant?.phase === "stopped"
            ? "stopped"
            : "done");
      const title = shortTitle(
        snapshot.find((m) => m.role === "user")?.text ?? "",
      );
      const existingSnapshot = getLocalThreadSnapshot(sessionUserId, threadId);
      const updatedAt = Date.now();
      const fallbackCreatedAt = existingSnapshot?.createdAt ?? updatedAt;
      const lastPromptAt = latestPromptTimestamp(
        snapshot,
        existingSnapshot?.lastPromptAt ?? fallbackCreatedAt,
      );
      upsertLocalThreadSnapshot(sessionUserId, {
        id: threadId,
        title,
        lastPromptAt,
        createdAt: fallbackCreatedAt,
        updatedAt,
        messages: serializeMessages(snapshot),
        runId: options.runId ?? runIdRef.current,
        status,
        context: options.context ?? pinnedContext,
      });
      setOptimisticThreads((threads) => {
        const existingThread = threads.find((thread) => thread.id === threadId);
        const createdAt = existingThread?.createdAt ?? fallbackCreatedAt;
        const next = {
          id: threadId,
          title,
          lastPromptAt,
          createdAt,
          updatedAt,
          status,
        };
        const rest = threads.filter((thread) => thread.id !== threadId);
        return [next, ...rest].sort(compareThreadsByLastPromptDesc);
      });
    },
    [pinnedContext, sessionUserId],
  );
  messagesRef.current = messages;
  useEffect(() => {
    setHideFooter(messages.length > 0);
    return () => setHideFooter(false);
  }, [messages.length, setHideFooter]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pendingHistoryFocusRef = useRef<string | null>(null);
  const pendingNewChatFocusRef = useRef(false);
  const restoreComposerFocusOnMountRef = useRef(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const lastScrollYRef = useRef(0);
  const pendingThreadScrollRef = useRef<PendingThreadScroll | null>(null);
  const handledHashRef = useRef<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    number | null
  >(null);
  const draftKey = askCacheKey(
    sessionUserId,
    `draft:${pinnedContext?.kind ?? "none"}:${pinnedContext?.citation ?? "none"}`,
  );
  const activeRunKey = askCacheKey(sessionUserId, "activeRun");

  useEffect(() => {
    setPinnedContext(initialContext);
  }, [initialContext]);

  useEffect(() => {
    try {
      setInput(draftKey ? (sessionStorage.getItem(draftKey) ?? "") : "");
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (!draftKey) return;
      if (input) sessionStorage.setItem(draftKey, input);
      else sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey, input]);

  const clearDraft = useCallback(() => {
    try {
      if (draftKey) sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey]);

  const resetHistoryNavigation = useCallback(() => {
    historyIndexRef.current = -1;
    draftBeforeHistoryRef.current = "";
  }, []);

  const refreshThreadList = useCallback(() => {
    setThreadListVersion((version) => version + 1);
  }, []);

  const upsertOptimisticThread = useCallback((thread: ThreadListItem) => {
    setOptimisticThreads((threads) => {
      const existing = threads.find((item) => item.id === thread.id);
      const next = {
        ...thread,
        createdAt: existing?.createdAt ?? thread.createdAt,
        lastPromptAt: Math.max(
          existing?.lastPromptAt ?? 0,
          thread.lastPromptAt,
        ),
      };
      return [next, ...threads.filter((item) => item.id !== thread.id)].sort(
        compareThreadsByLastPromptDesc,
      );
    });
  }, []);

  useEffect(() => {
    if (!isSignedIn) {
      setQuestionHistory([]);
      resetHistoryNavigation();
      return;
    }

    let ignore = false;

    async function loadQuestionHistory() {
      try {
        const res = await fetch("/api/ask/questions", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as {
          questions?: AskQuestionHistoryEntry[];
        };
        if (!ignore) setQuestionHistory(data.questions ?? []);
      } catch {
        // History recall is an enhancement; keep Ask usable if loading fails.
      }
    }

    void loadQuestionHistory();

    return () => {
      ignore = true;
    };
  }, [isSignedIn, resetHistoryNavigation]);

  const removePinnedContext = useCallback(() => {
    setPinnedContext(undefined);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("cite");
    nextParams.delete("kind");

    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  /** Keep the textarea tall enough for its content (up to a cap). */
  const autosize = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  // The composer moves between the empty and loaded layouts. Carry focus to
  // its replacement only when the detached textarea was still focused.
  const bindComposerInput = useCallback(
    (composer: HTMLTextAreaElement | null) => {
      const previousComposer = inputRef.current;
      if (!composer) {
        restoreComposerFocusOnMountRef.current = Boolean(
          pendingHistoryFocusRef.current &&
            previousComposer &&
            document.activeElement === previousComposer,
        );
        inputRef.current = null;
        return;
      }

      inputRef.current = composer;
      if (
        pendingHistoryFocusRef.current &&
        restoreComposerFocusOnMountRef.current
      ) {
        restoreComposerFocusOnMountRef.current = false;
        composer.focus({ preventScroll: true });
      }
    },
    [],
  );

  const focusComposerAfterHistorySelection = useCallback(
    (threadId: string, loadComplete = false) => {
      window.requestAnimationFrame(() => {
        if (pendingHistoryFocusRef.current !== threadId) return;

        const composer = inputRef.current;
        const focused = document.activeElement;
        const selectionStillOwnsFocus =
          focused === composer ||
          (!loadComplete && focused === document.body) ||
          (focused instanceof HTMLElement &&
            focused.dataset.askHistoryThread === threadId);

        if (selectionStillOwnsFocus) {
          composer?.focus({ preventScroll: true });
        }
        if (loadComplete || !selectionStillOwnsFocus) {
          pendingHistoryFocusRef.current = null;
          restoreComposerFocusOnMountRef.current = false;
        }
      });
    },
    [],
  );

  // Focus the existing composer inside the click gesture so touch keyboards
  // can open, then focus its replacement after the new empty chat commits.
  useLayoutEffect(() => {
    if (!pendingNewChatFocusRef.current) return;
    pendingNewChatFocusRef.current = false;
    inputRef.current?.focus({ preventScroll: true });
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: input changes the textarea's rendered text, so re-measure
  useEffect(() => {
    autosize();
  }, [input, autosize]);

  /** Ordinary thread entry is a one-shot jump to the latest message. */
  useLayoutEffect(() => {
    const request = pendingThreadScrollRef.current;
    if (
      request?.intent !== "bottom" ||
      request.threadId !== activeThreadId ||
      (loadingThreadId !== null && loadingThreadId !== request.threadId) ||
      messages.length === 0
    ) {
      return;
    }

    const scroller = chatScrollRef.current;
    if (!scroller) return;

    scroller.scrollTop = scroller.scrollHeight;
    lastScrollYRef.current = scroller.scrollTop;
    stickToBottomRef.current = true;
    pendingThreadScrollRef.current = null;
  }, [activeThreadId, loadingThreadId, messages]);

  useEffect(() => {
    if (!hasScrollableMessages) return;

    const distanceFromBottom = () => {
      const scroller = chatScrollRef.current;
      if (!scroller) return 0;
      return Math.max(
        0,
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
      );
    };

    const updateStickiness = () => {
      const scroller = chatScrollRef.current;
      if (!scroller) return;
      const y = Math.max(0, scroller.scrollTop);

      if (y < lastScrollYRef.current) {
        stickToBottomRef.current = false;
      } else if (distanceFromBottom() <= STICKY_BOTTOM_RESUME_PX) {
        stickToBottomRef.current = true;
      }

      lastScrollYRef.current = y;
    };

    const scroller = chatScrollRef.current;
    if (!scroller) return;
    lastScrollYRef.current = Math.max(0, scroller.scrollTop);
    stickToBottomRef.current = distanceFromBottom() <= STICKY_BOTTOM_RESUME_PX;
    scroller.addEventListener("scroll", updateStickiness, { passive: true });

    return () => {
      scroller.removeEventListener("scroll", updateStickiness);
    };
  }, [hasScrollableMessages]);

  /** Saved Answers alone may target an earlier answer instead of the bottom. */
  useEffect(() => {
    const request = pendingThreadScrollRef.current;
    if (
      request?.intent !== "saved-answer" ||
      request.threadId !== activeThreadId ||
      messages.length === 0
    ) {
      return;
    }

    const hash = window.location.hash.replace(/^#/, "");
    const id = messageIdFromChatHash(hash);
    if (id === null || handledHashRef.current === hash) return;

    const target =
      document.getElementById(`answer-${id}`) ??
      document.getElementById(`ask-message-${id}`);
    if (!target) {
      // A browser snapshot may be older than the server transcript. Keep the
      // targeted intent until that refresh finishes, then fall back safely.
      if (loadingThreadId === request.threadId) return;
      const scroller = chatScrollRef.current;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        lastScrollYRef.current = scroller.scrollTop;
      }
      pendingThreadScrollRef.current = null;
      stickToBottomRef.current = true;
      return;
    }

    handledHashRef.current = hash;
    pendingThreadScrollRef.current = null;
    stickToBottomRef.current = false;
    target.scrollIntoView({ block: "start" });
    setHighlightedMessageId(id);

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === id ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [activeThreadId, loadingThreadId, messages]);

  /** Follow streaming output only while the user is already near the bottom. */
  useEffect(() => {
    if (messages.length === 0 || !stickToBottomRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      if (!stickToBottomRef.current) return;
      const scroller = chatScrollRef.current;
      scroller?.scrollTo({ top: scroller.scrollHeight });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages]);

  const queuePrompt = useCallback((prompt: string) => {
    queuedPromptRef.current = prompt;
    setQueuedPrompt(prompt);
    setInput("");
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const clearQueuedPrompt = useCallback(() => {
    queuedPromptRef.current = null;
    setQueuedPrompt(null);
  }, []);

  const navigateQuestionHistory = useCallback(
    (direction: "older" | "newer", el: HTMLTextAreaElement) => {
      if (!isSignedIn || questionHistory.length === 0) return false;
      if (direction === "older" && !isCursorOnFirstLine(el)) return false;
      if (direction === "newer" && !isCursorOnLastLine(el)) return false;

      const currentIndex = historyIndexRef.current;
      if (direction === "newer" && currentIndex === -1) return false;

      let nextIndex = currentIndex;
      if (direction === "older") {
        if (currentIndex === -1) {
          draftBeforeHistoryRef.current = input;
          nextIndex = 0;
        } else {
          nextIndex = Math.min(currentIndex + 1, questionHistory.length - 1);
        }
      } else {
        nextIndex = currentIndex - 1;
      }

      historyIndexRef.current = nextIndex;
      const nextInput =
        nextIndex === -1
          ? draftBeforeHistoryRef.current
          : questionHistory[nextIndex]?.question;

      if (nextInput === undefined) return false;

      setInput(nextInput);
      window.requestAnimationFrame(() => {
        const target = inputRef.current;
        if (!target) return;
        const cursor = target.value.length;
        target.setSelectionRange(cursor, cursor);
      });

      return true;
    },
    [input, isSignedIn, questionHistory],
  );

  const stop = useCallback(() => {
    const stoppedRunId = runIdRef.current;
    queueingOpenRef.current = false;
    stopBackendRun(stoppedRunId, threadIdRef.current);
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    runIdRef.current = null;
    try {
      if (activeRunKey) sessionStorage.removeItem(activeRunKey);
    } catch {
      /* ignore */
    }
    setMessages((ms) =>
      ms.map((m) =>
        m.role === "assistant" &&
        !["done", "error", "stopped"].includes(m.phase)
          ? {
              ...m,
              phase: "stopped",
              progress: [
                ...m.progress,
                {
                  id: toolId.current++,
                  message: "Research exited by request.",
                  elapsedMs: m.startedAt ? Date.now() - m.startedAt : undefined,
                },
              ],
            }
          : m,
      ),
    );
  }, [activeRunKey]);

  const steerQueuedPrompt = useCallback(() => {
    if (!queuedPromptRef.current) return;
    stop();
  }, [stop]);

  const send = useCallback(
    async (
      text: string,
      resumeRunId?: string,
      resumeFrom = 0,
      resumeStartedAt?: number,
      internalReconnect = false,
      silentReplay = false,
    ) => {
      const q = text.trim();
      if (!q) return false;

      if (authBlocking || (loadingThreadId && !internalReconnect)) return false;

      if (!isSignedIn) {
        const saved = savePendingAsk({
          v: 1,
          question: q,
          context: {
            kind: pinnedContext?.kind,
            citation: pinnedContext?.citation,
          },
          createdAt: Date.now(),
        });
        const userMsg: Message = {
          id: msgId.current++,
          role: "user",
          text: q,
          tools: [],
          progress: [],
          phase: "done",
        };
        const authMsg: Message = {
          id: msgId.current++,
          role: "assistant",
          text: "",
          tools: [],
          progress: [],
          phase: "error",
          error: "Please sign in to use Ask Lawplain.",
        };

        resetHistoryNavigation();
        stickToBottomRef.current = true;
        setMessages((m) => [...m, userMsg, authMsg]);
        if (saved) {
          clearDraft();
          setInput("");
        }
        return true;
      }

      if (activeRef.current) {
        if (queueingOpenRef.current) {
          queuePrompt(q);
        } else {
          pendingSendAfterCleanupRef.current = q;
          setInput("");
        }
        return true;
      }

      const sendGeneration = sendGenerationRef.current + 1;
      sendGenerationRef.current = sendGeneration;
      const runThreadId = threadIdRef.current;
      const runId = resumeRunId ?? crypto.randomUUID();
      const runContext = pinnedContext;
      activeRef.current = true;
      queueingOpenRef.current = true;
      resetHistoryNavigation();
      if (isSignedIn) {
        setQuestionHistory((history) => mergeQuestionHistory(history, q));
      }

      const existing = resumeRunId ? messagesRef.current : [];
      const existingAssistant = existing[existing.length - 1];
      const existingUser = existing[existing.length - 2];
      const reuseRunningAssistant = Boolean(
        resumeRunId &&
          existingAssistant &&
          existingUser &&
          isLiveAssistant(existingAssistant) &&
          existingUser.role === "user" &&
          existingUser.text.trim() === q,
      );
      const promptAt = reuseRunningAssistant
        ? ((existingUser as Message).startedAt ?? resumeStartedAt ?? Date.now())
        : Date.now();

      const userMsg: Message = reuseRunningAssistant
        ? (existingUser as Message)
        : {
            id: msgId.current++,
            role: "user",
            text: q,
            tools: [],
            progress: [],
            phase: "done",
            startedAt: promptAt,
          };
      const aId = reuseRunningAssistant
        ? (existingAssistant as Message).id
        : msgId.current++;
      const startedAt = reuseRunningAssistant
        ? ((existingAssistant as Message).startedAt ??
          resumeStartedAt ??
          Date.now())
        : (resumeStartedAt ?? Date.now());
      const assistantMsg: Message = reuseRunningAssistant
        ? (existingAssistant as Message)
        : {
            id: aId,
            role: "assistant",
            text: "",
            tools: [],
            progress: [
              {
                id: toolId.current++,
                message: resumeRunId
                  ? "Reconnecting to the research agent…"
                  : "Connecting to the research agent…",
                elapsedMs: resumeRunId
                  ? Math.max(0, Date.now() - startedAt)
                  : 0,
              },
            ],
            startedAt,
            eventCursor: 0,
            phase: "starting",
          };
      if (!reuseRunningAssistant) {
        const existingSnapshot = getLocalThreadSnapshot(
          sessionUserId,
          runThreadId,
        );
        upsertOptimisticThread({
          id: runThreadId,
          title: shortTitle(
            messagesRef.current.find((m) => m.role === "user")?.text ?? q,
          ),
          lastPromptAt: promptAt,
          createdAt: existingSnapshot?.createdAt ?? promptAt,
          updatedAt: promptAt,
          runId,
          status: "running",
        });
        stickToBottomRef.current = true;
        setMessages((m) => [...m, userMsg, assistantMsg]);
      }
      if (
        !reuseRunningAssistant &&
        messagesRef.current.length === 0 &&
        typeof window !== "undefined" &&
        window.location.pathname === "/ask"
      ) {
        window.history.replaceState(null, "", `/ask/${runThreadId}`);
      }
      clearDraft();
      setInput("");
      setBusy(!silentReplay);

      const ac = new AbortController();
      abortRef.current = ac;
      let runSnapshot = reuseRunningAssistant
        ? [...existing]
        : [...messagesRef.current, userMsg, assistantMsg];

      const patch = (fn: (m: Message) => Message) => {
        runSnapshot = runSnapshot.map((m) => (m.id === aId ? fn(m) : m));
        const currentRunId = runIdRef.current;
        if (currentRunId) {
          optimisticThreadSnapshotsRef.current.set(runThreadId, {
            messages: runSnapshot,
            runId: currentRunId,
            status: "running",
          });
        }
        if (sendGenerationRef.current !== sendGeneration || silentReplay)
          return;
        setMessages((ms) => ms.map((m) => (m.id === aId ? fn(m) : m)));
      };

      try {
        const history = messagesRef.current
          .filter((m) => m.text.trim().length > 0)
          .slice(-12)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 6000) }));
        runIdRef.current = runId;
        optimisticThreadSnapshotsRef.current.set(runThreadId, {
          messages: runSnapshot,
          runId,
          status: "running",
        });
        cacheThreadSnapshot(runSnapshot, {
          threadId: runThreadId,
          runId,
          context: runContext,
          status: "running",
        });
        try {
          if (activeRunKey) {
            sessionStorage.setItem(
              activeRunKey,
              JSON.stringify({
                runId,
                question: q,
                startedAt,
                threadId: runThreadId,
              }),
            );
          }
        } catch {
          // sessionStorage may be unavailable
        }
        const saveThreadId = runThreadId;
        const runningTranscript = serializeMessages([
          ...messagesRef.current,
          userMsg,
          assistantMsg,
        ]);
        const startTitle = shortTitle(
          messagesRef.current.find((m) => m.role === "user")?.text ?? q,
        );
        // Persist the thread at run-start so the owner's OTHER tabs can see it
        // (and reconnect to the live run) while it's still researching — not
        // only once it settles. Fresh runs only; reconnects already exist.
        if (isSignedIn && !resumeRunId) {
          if (!deletedThreadIdsRef.current.has(saveThreadId)) {
            void fetch("/api/ask-threads", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                id: saveThreadId,
                title: startTitle,
                messages: runningTranscript,
                cite: runContext?.citation,
                kind: runContext?.kind,
                sourceHref: runContext?.href,
                runId,
                status: "running",
              }),
            })
              .then((res) => {
                if (res.ok && !deletedThreadIdsRef.current.has(saveThreadId)) {
                  refreshThreadList();
                }
              })
              .catch(() => {});
          }
        }
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: q,
            cite: runContext?.citation,
            kind: runContext?.kind,
            history,
            runId,
            threadId: runThreadId,
            title: startTitle,
            sourceHref: runContext?.href,
            initialMessages: runningTranscript,
            from: resumeFrom,
          }),
          signal: ac.signal,
        });
        if (res.status === 401) {
          throw new Error("Please sign in to use Ask Lawplain.");
        }
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => res.statusText);
          throw new Error(msg || `request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = reuseRunningAssistant ? assistantMsg.text : "";
        let eventCursor = resumeFrom;

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let ev: ChatEvent;
            try {
              ev = JSON.parse(line.slice(6)) as ChatEvent;
            } catch {
              continue;
            }
            eventCursor += 1;
            patch((m) => ({ ...m, eventCursor }));
            switch (ev.type) {
              case "delta":
                if (acc === "") patch((m) => ({ ...m, phase: "answering" }));
                acc += ev.text;
                patch((m) => ({ ...m, text: acc }));
                break;
              case "progress":
                patch((m) => {
                  const serverStartedAt =
                    typeof ev.elapsedMs === "number"
                      ? Date.now() - ev.elapsedMs
                      : undefined;
                  return {
                    ...m,
                    phase: mapProgressPhase(ev.phase),
                    startedAt:
                      m.startedAt && serverStartedAt
                        ? Math.min(m.startedAt, serverStartedAt)
                        : (serverStartedAt ?? m.startedAt),
                    elapsedMs: ev.elapsedMs,
                    progress: [
                      ...m.progress,
                      {
                        id: toolId.current++,
                        message: ev.message,
                        elapsedMs: ev.elapsedMs,
                      },
                    ].slice(-6),
                  };
                });
                break;
              case "tool": {
                const step = describeTool(ev);
                patch((m) => {
                  const existing = m.tools.find((t) => t.key === step.key);
                  if (existing) {
                    return {
                      ...m,
                      tools: m.tools.map((t) =>
                        t.key === step.key
                          ? { ...t, count: ev.count ?? t.count + 1 }
                          : t,
                      ),
                    };
                  }
                  return {
                    ...m,
                    tools: [...m.tools, { ...step, id: toolId.current++ }],
                  };
                });
                break;
              }
              case "tool_rejected":
                patch((m) => ({
                  ...m,
                  progress: [
                    ...m.progress,
                    {
                      id: toolId.current++,
                      message: ev.message,
                    },
                  ].slice(-6),
                }));
                break;
              case "done": {
                queueingOpenRef.current = false;
                const finalSnapshot = runSnapshot.map((m) =>
                  m.id === aId
                    ? {
                        ...m,
                        text: ev.text || acc,
                        phase: "done" as const,
                        elapsedMs: m.startedAt
                          ? Date.now() - m.startedAt
                          : m.elapsedMs,
                        cost: { usd: ev.costUsd, tokens: ev.contextTokens },
                      }
                    : m,
                );
                runSnapshot = finalSnapshot;
                if (sendGenerationRef.current === sendGeneration) {
                  messagesRef.current = finalSnapshot;
                  setMessages(finalSnapshot);
                }
                const finalThreadId = runThreadId;
                optimisticThreadSnapshotsRef.current.set(finalThreadId, {
                  messages: finalSnapshot,
                  runId,
                  status: "done",
                });
                cacheThreadSnapshot(finalSnapshot, {
                  threadId: finalThreadId,
                  runId,
                  context: runContext,
                  status: "done",
                });
                const finalTitle = shortTitle(
                  finalSnapshot.find((m) => m.role === "user")?.text ?? q,
                );
                upsertOptimisticThread({
                  id: finalThreadId,
                  title: finalTitle,
                  lastPromptAt: latestPromptTimestamp(
                    finalSnapshot,
                    getLocalThreadSnapshot(sessionUserId, finalThreadId)
                      ?.lastPromptAt ?? 0,
                  ),
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                  runId,
                  status: "done",
                  unread: true,
                });
                if (
                  isSignedIn &&
                  !deletedThreadIdsRef.current.has(finalThreadId)
                ) {
                  void fetch("/api/ask-threads", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      id: finalThreadId,
                      title: finalTitle,
                      messages: serializeMessages(finalSnapshot),
                      cite: runContext?.citation,
                      kind: runContext?.kind,
                      sourceHref: runContext?.href,
                      runId,
                      status: "done",
                      unread: true,
                    }),
                  })
                    .then((res) => {
                      if (res.ok) refreshThreadList();
                    })
                    .catch(() => {});
                }
                try {
                  if (activeRunKey) sessionStorage.removeItem(activeRunKey);
                } catch {
                  /* ignore */
                }
                await reader.cancel().catch(() => {});
                return true;
              }
              case "error":
                queueingOpenRef.current = false;
                patch((m) => ({ ...m, phase: "error", error: ev.message }));
                try {
                  if (activeRunKey) sessionStorage.removeItem(activeRunKey);
                } catch {
                  /* ignore */
                }
                await reader.cancel().catch(() => {});
                return true;
            }
          }
        }
      } catch (err) {
        queueingOpenRef.current = false;
        if ((err as Error).name !== "AbortError") {
          patch((m) => ({
            ...m,
            phase: "error",
            error: "Research could not be completed. Please try again.",
          }));
        }
      } finally {
        if (sendGenerationRef.current === sendGeneration) {
          const nextPrompt = queuedPromptRef.current;
          const pendingPrompt = pendingSendAfterCleanupRef.current;
          queuedPromptRef.current = null;
          pendingSendAfterCleanupRef.current = null;
          queueingOpenRef.current = false;
          setQueuedPrompt(null);
          activeRef.current = false;
          setBusy(false);
          abortRef.current = null;

          const promptToSend = nextPrompt ?? pendingPrompt;
          if (promptToSend) {
            window.setTimeout(() => {
              void sendRef.current?.(promptToSend);
            }, 0);
          }
        }
      }
      return true;
    },
    [
      cacheThreadSnapshot,
      clearDraft,
      activeRunKey,
      isSignedIn,
      pinnedContext,
      queuePrompt,
      refreshThreadList,
      resetHistoryNavigation,
      authBlocking,
      upsertOptimisticThread,
      loadingThreadId,
      sessionUserId,
    ],
  );

  sendRef.current = send;

  useEffect(() => {
    if (
      !isSignedIn ||
      busy ||
      authBlocking ||
      loadingThreadId ||
      messagesRef.current.length > 0
    ) {
      return;
    }

    const pending = peekPendingAsk();
    if (!pending) return;

    window.setTimeout(() => {
      void sendRef.current?.(pending.question).then((accepted) => {
        if (accepted) clearPendingAsk();
      });
    }, 0);
  }, [authBlocking, busy, isSignedIn, loadingThreadId]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  // ── Saved threads: autosave each turn + resume from History ───────────
  const persistThreadSnapshot = useCallback(
    async (
      snapshot = messagesRef.current,
      options: {
        keepalive?: boolean;
        threadId?: string;
        runId?: string | null;
        context?: ChatContext;
      } = {},
    ): Promise<boolean> => {
      if (!isSignedIn || snapshot.length === 0) return true;
      if (!snapshot.some((m) => m.role === "user")) return true;

      const threadId = options.threadId ?? threadIdRef.current;
      if (deletedThreadIdsRef.current.has(threadId)) return true;

      const latestAssistant = latestAssistantMessage(snapshot);
      const running = latestAssistant
        ? isLiveAssistant(latestAssistant)
        : false;
      const status = running
        ? "running"
        : latestAssistant?.phase === "stopped"
          ? "stopped"
          : "done";

      cacheThreadSnapshot(snapshot, {
        threadId,
        runId: options.runId ?? runIdRef.current,
        context: options.context ?? pinnedContext,
        status,
      });

      try {
        const res = await fetch("/api/ask-threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          keepalive: options.keepalive,
          body: JSON.stringify({
            id: threadId,
            title: shortTitle(
              snapshot.find((m) => m.role === "user")?.text ?? "",
            ),
            messages: serializeMessages(snapshot),
            cite: (options.context ?? pinnedContext)?.citation,
            kind: (options.context ?? pinnedContext)?.kind,
            sourceHref: (options.context ?? pinnedContext)?.href,
            runId: options.runId ?? runIdRef.current ?? undefined,
            status,
          }),
        });
        if (res.ok) refreshThreadList();
        return res.ok;
      } catch {
        return false;
      }
    },
    [cacheThreadSnapshot, isSignedIn, pinnedContext, refreshThreadList],
  );

  const persistThreadSnapshotRef = useRef(persistThreadSnapshot);
  useEffect(() => {
    persistThreadSnapshotRef.current = persistThreadSnapshot;
  }, [persistThreadSnapshot]);

  const flushThread = useCallback(() => {
    void persistThreadSnapshotRef.current(messagesRef.current, {
      keepalive: true,
    });
  }, []);

  useEffect(() => {
    return () => flushThread();
  }, [flushThread]);

  // Reconnect to a DO-hosted run still going after the user navigated away.
  const reconnectedRef = useRef(false);
  useEffect(() => {
    if (reconnectedRef.current || !isSignedIn || initialThreadId) return;
    reconnectedRef.current = true;
    if (messagesRef.current.length > 0) return;
    try {
      if (!activeRunKey) return;
      const raw = sessionStorage.getItem(activeRunKey);
      if (!raw) return;
      const ar = JSON.parse(raw) as {
        runId?: string;
        question?: string;
        startedAt?: number;
        threadId?: string;
      };
      if (!ar.runId || !ar.question) return;
      if (Date.now() - (ar.startedAt ?? 0) > 6 * 60 * 1000) {
        sessionStorage.removeItem(activeRunKey);
        return;
      }
      if (ar.threadId) {
        threadIdRef.current = ar.threadId;
        setActiveThreadId(ar.threadId);
        if (window.location.pathname === "/ask") {
          window.history.replaceState(null, "", `/ask/${ar.threadId}`);
        }
        void loadThreadRef.current?.(ar.threadId);
        return;
      }
      const cachedRunThread = readLocalThreadSnapshots(sessionUserId).find(
        (snapshot) => snapshot.runId === ar.runId,
      );
      if (cachedRunThread) {
        threadIdRef.current = cachedRunThread.id;
        setActiveThreadId(cachedRunThread.id);
        if (window.location.pathname === "/ask") {
          window.history.replaceState(null, "", `/ask/${cachedRunThread.id}`);
        }
        void loadThreadRef.current?.(cachedRunThread.id);
        return;
      }
      sessionStorage.removeItem(activeRunKey);
    } catch {
      // ignore reconnect failures
    }
  }, [activeRunKey, isSignedIn, initialThreadId, sessionUserId]);

  // Autosave both settled and in-flight transcripts so navigating away or
  // starting another chat can later reopen the same running research with its
  // latest visible progress instead of a blank "0s" state.
  useEffect(() => {
    if (!isSignedIn || messages.length === 0) return;
    if (!messages.some((m) => m.role === "user")) return;

    const title = shortTitle(
      messages.find((m) => m.role === "user")?.text ?? "",
    );
    const persisted = serializeMessages(messages);
    const latestAssistant = latestAssistantMessage(messages);
    const running = latestAssistant ? isLiveAssistant(latestAssistant) : false;
    const status = running
      ? "running"
      : latestAssistant?.phase === "stopped"
        ? "stopped"
        : "done";
    const id = threadIdRef.current;
    if (deletedThreadIdsRef.current.has(id)) return;
    const runId = runIdRef.current ?? undefined;
    cacheThreadSnapshot(messages, {
      threadId: id,
      runId,
      context: pinnedContext,
      status,
    });
    setOptimisticThreads((threads) =>
      threads.map((thread) =>
        thread.id === id && (thread.title !== title || thread.status !== status)
          ? { ...thread, title, status, updatedAt: Date.now() }
          : thread,
      ),
    );
    const timer = window.setTimeout(
      () => {
        void fetch("/api/ask-threads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            title,
            messages: persisted,
            cite: pinnedContext?.citation,
            kind: pinnedContext?.kind,
            sourceHref: pinnedContext?.href,
            runId,
            status,
          }),
        })
          .then((res) => {
            if (res.ok && !running) refreshThreadList();
          })
          .catch(() => {
            // best-effort autosave
          });
      },
      running ? 1200 : 300,
    );
    return () => window.clearTimeout(timer);
  }, [
    messages,
    isSignedIn,
    pinnedContext,
    refreshThreadList,
    cacheThreadSnapshot,
  ]);

  const resetChatState = useCallback(
    (options: { createPlaceholder?: boolean; abortCurrent?: boolean } = {}) => {
      const { createPlaceholder = false, abortCurrent = true } = options;
      sendGenerationRef.current += 1;
      queuedPromptRef.current = null;
      pendingSendAfterCleanupRef.current = null;
      queueingOpenRef.current = false;
      activeRef.current = false;
      if (abortCurrent) abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
      messagesRef.current = [];
      setMessages([]);
      clearDraft();
      setInput("");
      clearQueuedPrompt();
      const nextThreadId = crypto.randomUUID();
      threadIdRef.current = nextThreadId;
      setActiveThreadId(nextThreadId);
      if (createPlaceholder) {
        optimisticThreadSnapshotsRef.current.set(nextThreadId, {
          messages: [],
          runId: null,
          status: "done",
        });
        upsertOptimisticThread({
          id: nextThreadId,
          title: "New Chat",
          lastPromptAt: Date.now(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          status: null,
        });
      }
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/ask"
      ) {
        window.history.replaceState(null, "", "/ask");
      }
      runIdRef.current = null;
      try {
        const lastThreadKey = askCacheKey(sessionUserId, LAST_THREAD_ID_KEY);
        if (lastThreadKey) localStorage.removeItem(lastThreadKey);
      } catch {
        /* ignore */
      }
      try {
        if (activeRunKey) sessionStorage.removeItem(activeRunKey);
      } catch {
        /* ignore */
      }
    },
    [
      clearDraft,
      clearQueuedPrompt,
      activeRunKey,
      sessionUserId,
      upsertOptimisticThread,
    ],
  );

  const newChat = useCallback(() => {
    if (creatingNewChatRef.current) return;
    creatingNewChatRef.current = true;

    pendingNewChatFocusRef.current = true;
    inputRef.current?.focus({ preventScroll: true });

    // Kick off a best-effort save of the current transcript, but do not await
    // it: a failed or stalled persistence request must never make the New chat
    // button unusable. The visible snapshot is captured before resetChatState
    // swaps to a fresh thread; running threads are also saved at run start.
    const snapshot = [...messagesRef.current];
    const currentThreadId = threadIdRef.current;
    const currentRunId = runIdRef.current;
    const currentContext = pinnedContext;
    if (snapshot.some((m) => m.role === "user")) {
      const latestAssistant = latestAssistantMessage(snapshot);
      const running = latestAssistant
        ? isLiveAssistant(latestAssistant)
        : false;
      const status = running
        ? "running"
        : latestAssistant?.phase === "stopped"
          ? "stopped"
          : "done";
      optimisticThreadSnapshotsRef.current.set(currentThreadId, {
        messages: snapshot,
        runId: currentRunId,
        status,
      });
      const localSnapshot = getLocalThreadSnapshot(
        sessionUserId,
        currentThreadId,
      );
      upsertOptimisticThread({
        id: currentThreadId,
        title: shortTitle(snapshot.find((m) => m.role === "user")?.text ?? ""),
        lastPromptAt: latestPromptTimestamp(
          snapshot,
          localSnapshot?.lastPromptAt ?? localSnapshot?.createdAt ?? 0,
        ),
        createdAt: localSnapshot?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        runId: currentRunId,
        status,
      });
    }
    void persistThreadSnapshot(snapshot, {
      threadId: currentThreadId,
      runId: currentRunId,
      context: currentContext,
    })
      .then((saved) => {
        if (!saved) {
          console.warn("Failed to persist current ask thread before New chat");
        }
      })
      .finally(() => {
        creatingNewChatRef.current = false;
      });

    // Detach this UI stream only. Durable Object-backed research keeps running
    // in the background; explicit Stop is the only path that cancels backend work.
    // Same UI reset as resetChatState({ createPlaceholder: true }), without aborting the local tail.
    resetChatState({ createPlaceholder: true, abortCurrent: false });
    setSidebarOpen(!window.matchMedia("(max-width: 1023px)").matches);
  }, [
    persistThreadSnapshot,
    resetChatState,
    upsertOptimisticThread,
    pinnedContext,
    sessionUserId,
    setSidebarOpen,
  ]);

  const deleteActiveChat = useCallback(
    (id: string, wasActive = false) => {
      const isRouteThread =
        typeof window !== "undefined" &&
        window.location.pathname === `/ask/${id}`;
      if (
        !wasActive &&
        !isRouteThread &&
        id !== activeThreadId &&
        id !== threadIdRef.current
      ) {
        return;
      }
      deletedThreadIdsRef.current.add(id);
      removeLocalThreadSnapshot(sessionUserId, id);
      optimisticThreadSnapshotsRef.current.delete(id);
      setOptimisticThreads((threads) =>
        threads.filter((thread) => thread.id !== id),
      );
      stopBackendRun(runIdRef.current, id);
      resetChatState({ createPlaceholder: false });
      setSidebarOpen(true);
    },
    [activeThreadId, resetChatState, sessionUserId, setSidebarOpen],
  );

  const loadThread = useCallback(
    async (threadId: string, scrollIntent: ThreadScrollIntent = "bottom") => {
      const loadSeq = ++loadThreadSeqRef.current;
      pendingThreadScrollRef.current = {
        threadId,
        intent: scrollIntent,
      };
      handledHashRef.current = null;
      if (scrollIntent === "bottom") {
        stickToBottomRef.current = true;
        setHighlightedMessageId(null);
      }
      setLoadingThreadId(threadId);
      const restoreOptimisticSnapshot = (reconnect = true) => {
        const memorySnapshot =
          optimisticThreadSnapshotsRef.current.get(threadId);
        const localSnapshot = getLocalThreadSnapshot(sessionUserId, threadId);
        const loaded = memorySnapshot
          ? memorySnapshot.messages
          : localSnapshot
            ? deserializeLocalMessages(localSnapshot.messages)
            : null;
        const runId = memorySnapshot?.runId ?? localSnapshot?.runId ?? null;
        if (!loaded || loadSeq !== loadThreadSeqRef.current) return false;
        sendGenerationRef.current += 1;
        activeRef.current = false;
        queueingOpenRef.current = false;
        abortRef.current?.abort();
        abortRef.current = null;
        msgId.current = loaded.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
        threadIdRef.current = threadId;
        setActiveThreadId(threadId);
        runIdRef.current = runId;
        const latestAssistant = latestAssistantMessage(loaded);
        const running = latestAssistant
          ? isLiveAssistant(latestAssistant)
          : false;
        setBusy(running);
        messagesRef.current = loaded;
        setMessages(loaded);
        if (reconnect && running && runId) {
          const user = [...loaded]
            .reverse()
            .find((m) => m.role === "user" && m.text.trim());
          if (user) {
            window.setTimeout(() => {
              void sendRef.current?.(
                user.text,
                runId ?? undefined,
                latestAssistant?.eventCursor ?? 0,
                latestAssistant?.startedAt,
                true,
              );
            }, 0);
          }
        }
        return true;
      };

      // Preserve the currently visible thread before switching refs, then paint
      // the target's browser snapshot immediately. The request below remains the
      // source of truth, but it should refresh an already-visible conversation
      // instead of leaving the empty Ask landing page on screen while it loads.
      flushThread();
      restoreOptimisticSnapshot(false);
      const ac = new AbortController();
      const timeout = window.setTimeout(() => ac.abort(), 10000);
      try {
        const res = await fetch(
          `/api/ask-threads?id=${encodeURIComponent(threadId)}`,
          { signal: ac.signal },
        );
        if (!res.ok || loadSeq !== loadThreadSeqRef.current) {
          restoreOptimisticSnapshot();
          return;
        }
        const data = (await res.json()) as {
          thread?: {
            runId?: string | null;
            status?: string | null;
            messages?: Array<{
              id?: number;
              role?: string;
              text?: string;
              tools?: ToolStep[];
              progress?: ProgressStep[];
              phase?: Phase;
              startedAt?: number;
              elapsedMs?: number;
              eventCursor?: number;
              cost?: { usd: number; tokens: number };
              error?: string;
            }>;
          };
        };
        if (loadSeq !== loadThreadSeqRef.current) return;
        const raw = data.thread?.messages ?? [];
        const threadStatus = data.thread?.status;
        let loaded = collapseDuplicateRunningTurns(
          raw.map((m, i): Message => {
            const role = m.role === "user" ? "user" : "assistant";
            const rawPhase = m.phase ?? "done";
            const phase =
              role === "assistant" &&
              threadStatus !== "running" &&
              !["done", "error", "stopped"].includes(rawPhase)
                ? threadStatus === "stopped"
                  ? "stopped"
                  : "done"
                : rawPhase;
            return {
              id: typeof m.id === "number" ? m.id : i,
              role,
              text: typeof m.text === "string" ? m.text : "",
              tools: Array.isArray(m.tools) ? m.tools : [],
              progress: Array.isArray(m.progress) ? m.progress : [],
              phase,
              startedAt:
                typeof m.startedAt === "number" ? m.startedAt : undefined,
              elapsedMs:
                typeof m.elapsedMs === "number" ? m.elapsedMs : undefined,
              eventCursor:
                typeof m.eventCursor === "number" ? m.eventCursor : undefined,
              cost: m.cost,
              error: m.error,
            };
          }),
        );
        const localSnapshot =
          optimisticThreadSnapshotsRef.current.get(threadId);
        const browserSnapshot = getLocalThreadSnapshot(sessionUserId, threadId);
        const browserMessages = browserSnapshot
          ? deserializeLocalMessages(browserSnapshot.messages)
          : null;
        const bestLocalMessages =
          localSnapshot &&
          (!browserMessages ||
            transcriptScore(localSnapshot.messages) >=
              transcriptScore(browserMessages))
            ? localSnapshot.messages
            : browserMessages;
        if (
          bestLocalMessages &&
          transcriptScore(bestLocalMessages) > transcriptScore(loaded)
        ) {
          loaded = bestLocalMessages;
        }
        sendGenerationRef.current += 1;
        activeRef.current = false;
        queueingOpenRef.current = false;
        abortRef.current?.abort();
        abortRef.current = null;
        msgId.current = loaded.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
        threadIdRef.current = threadId;
        setActiveThreadId(threadId);
        setOptimisticThreads((threads) =>
          threads.filter((thread) => thread.id !== threadId),
        );

        // Still researching? Show the persisted in-flight transcript immediately,
        // then reconnect to the same run. Newer rows include the assistant
        // placeholder/progress; legacy rows only have the trailing user, so keep
        // that fallback for older saved running threads.
        const last = loaded[loaded.length - 1];
        const runId =
          localSnapshot?.runId ?? browserSnapshot?.runId ?? data.thread?.runId;
        const shouldReconnectRun = Boolean(
          runId &&
            (data.thread?.status === "running" ||
              (last && isLiveAssistant(last))),
        );
        if (shouldReconnectRun && runId) {
          activeRef.current = false;
          runIdRef.current = runId;
          if (last && isLiveAssistant(last)) {
            const user = [...loaded]
              .reverse()
              .find((m) => m.role === "user" && m.text.trim());
            messagesRef.current = loaded;
            setMessages(loaded);
            if (user) {
              window.setTimeout(() => {
                void sendRef.current?.(
                  user.text,
                  runId,
                  last.eventCursor ?? 0,
                  undefined,
                  true,
                  data.thread?.status !== "running",
                );
              }, 0);
            }
            return;
          }
          if (last?.role === "user") {
            const visibleMessages = loaded.slice(0, -1);
            setBusy(true);
            messagesRef.current = visibleMessages;
            setMessages(visibleMessages);
            void sendRef.current?.(last.text, runId, 0, undefined, true);
            return;
          }
        }

        setBusy(false);
        messagesRef.current = loaded;
        setMessages(loaded);
      } catch {
        restoreOptimisticSnapshot();
      } finally {
        window.clearTimeout(timeout);
        if (loadSeq === loadThreadSeqRef.current) setLoadingThreadId(null);
      }
    },
    [flushThread, sessionUserId],
  );
  loadThreadRef.current = loadThread;

  // Opened at /ask/[id]: restore that saved conversation on mount.
  const loadedThreadRef = useRef(false);
  useLayoutEffect(() => {
    if (loadedThreadRef.current || !initialThreadId) return;
    loadedThreadRef.current = true;
    threadIdRef.current = initialThreadId;
    setActiveThreadId(initialThreadId);
    const scrollIntent =
      messageIdFromChatHash(window.location.hash) === null
        ? "bottom"
        : "saved-answer";
    void loadThread(initialThreadId, scrollIntent);
  }, [initialThreadId, loadThread]);

  // Returning via the top nav lands on /ask, not /ask/[id]. Restore the last
  // local thread so a route remount through Saved/Recents does not look erased.
  const restoredLastThreadRef = useRef(false);
  useLayoutEffect(() => {
    if (restoredLastThreadRef.current || initialThreadId) return;
    if (messagesRef.current.length > 0 || hasPendingAsk()) return;
    restoredLastThreadRef.current = true;
    try {
      const lastThreadKey = askCacheKey(sessionUserId, LAST_THREAD_ID_KEY);
      if (!lastThreadKey) return;
      const lastThreadId = localStorage.getItem(lastThreadKey);
      if (!lastThreadId || !getLocalThreadSnapshot(sessionUserId, lastThreadId))
        return;
      threadIdRef.current = lastThreadId;
      setActiveThreadId(lastThreadId);
      if (window.location.pathname === "/ask") {
        window.history.replaceState(null, "", `/ask/${lastThreadId}`);
      }
      void loadThread(lastThreadId);
    } catch {
      // Best-effort local restore only.
    }
  }, [initialThreadId, loadThread, sessionUserId]);
  const pinnedChip = pinnedContext ? (
    <div className="relative mb-4 rounded-xl border border-border bg-surface-2/60 pr-11 transition-colors hover:border-border-strong hover:bg-surface-2">
      <Link
        href={pinnedContext.href}
        className="flex min-w-0 items-center gap-2.5 px-3 py-2 text-left"
      >
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted">
          <BookIcon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-2">
            {pinnedContext.kind === "judgment" ? "Judgment" : "Statute"} ·
            pinned
          </span>
          <span className="block truncate text-[13px] font-medium text-foreground">
            {pinnedContext.title}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10px] text-muted-2">
          {pinnedContext.citation}
        </span>
      </Link>
      <button
        type="button"
        onClick={removePinnedContext}
        className="absolute right-3 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-2 transition-colors hover:bg-border hover:text-foreground"
        aria-label={`Remove pinned ${pinnedContext.kind}`}
        title="Remove pinned source"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : null;

  const composer = (
    <>
      {queuedPrompt && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-xs text-muted">
          <span className="min-w-0 flex-1 truncate">
            Queued next prompt: {queuedPrompt}
          </span>
          <button
            type="button"
            onClick={steerQueuedPrompt}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-accent hover:bg-border hover:text-foreground"
          >
            Steer
          </button>
          <button
            type="button"
            onClick={clearQueuedPrompt}
            className="shrink-0 rounded-md px-2 py-1 font-medium text-muted-2 hover:bg-border hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <textarea
          ref={bindComposerInput}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            resetHistoryNavigation();
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              if (navigateQuestionHistory("older", e.currentTarget)) {
                e.preventDefault();
              }
              return;
            }

            if (e.key === "ArrowDown") {
              if (navigateQuestionHistory("newer", e.currentTarget)) {
                e.preventDefault();
              }
              return;
            }

            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder={
            loadingThreadId
              ? "Loading thread…"
              : messages.length === 0
                ? "Ask a question about Singapore law…"
                : busy
                  ? "Ask for follow-up changes…"
                  : "Ask a follow-up…"
          }
          className="thin-scroll max-h-40 flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-2 focus:border-accent focus:outline-none"
        />
        {busy ? (
          <>
            <button
              type="submit"
              disabled={
                authBlocking || Boolean(loadingThreadId) || !input.trim()
              }
              className="inline-flex h-[42px] items-center gap-1.5 rounded-xl bg-foreground px-3 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Queue prompt"
            >
              Queue
            </button>
            <button
              type="button"
              onClick={stop}
              className="inline-flex h-[42px] items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium text-muted hover:bg-surface-2"
            >
              <StopIcon className="h-4 w-4" /> Stop
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={authBlocking || Boolean(loadingThreadId) || !input.trim()}
            className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-foreground text-primary-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Send"
          >
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        )}
      </form>
    </>
  );

  const latestAssistantForBusy = latestAssistantMessage(messages);
  const activeThreadStatus = latestAssistantForBusy
    ? isLiveAssistant(latestAssistantForBusy)
      ? "running"
      : latestAssistantForBusy.phase === "stopped"
        ? "stopped"
        : "done"
    : null;
  const liveAssistantThreadId =
    activeThreadStatus === "running" ? activeThreadId : null;

  // A sign-out can happen while this client component is still mounted. Clear
  // private transcript state, but keep the public Ask landing surface available
  // so guests can enter a question and receive the inline authentication gate.
  useEffect(() => {
    if (sessionPending || sessionUserId) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setMessages([]);
    messagesRef.current = [];
    setInput("");
    setQuestionHistory([]);
    setOptimisticThreads([]);
    setSidebarOpen(false);
    setAskSidebarUnread(false);
  }, [sessionPending, sessionUserId, setAskSidebarUnread, setSidebarOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {isSignedIn && (
        <ThreadSidebar
          userId={sessionUserId ?? ""}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeId={activeThreadId}
          activeStatus={activeThreadStatus}
          busyId={liveAssistantThreadId}
          onResume={(id) => {
            // loadThread() first flushes the currently-visible thread. Do not
            // point threadIdRef at the target before that flush, or the current
            // transcript can overwrite the selected history item.
            pendingHistoryFocusRef.current = id;
            restoreComposerFocusOnMountRef.current = false;
            inputRef.current?.focus({ preventScroll: true });
            if (window.matchMedia("(max-width: 1023px)").matches) {
              setSidebarOpen(false);
            }
            const threadLoad = loadThread(id, "bottom");
            focusComposerAfterHistorySelection(id);
            const settleHistoryFocus = () =>
              focusComposerAfterHistorySelection(id, true);
            void threadLoad.then(settleHistoryFocus, settleHistoryFocus);
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", `/ask/${id}`);
            }
          }}
          onNewChat={newChat}
          onDeleteActive={deleteActiveChat}
          refreshKey={threadListVersion}
          optimisticThreads={optimisticThreads}
          onUnreadDoneChange={setAskSidebarUnread}
        />
      )}
      <div
        className={`min-h-0 flex-1 ${
          messages.length === 0 ? "thin-scroll overflow-y-auto pb-6" : ""
        }`}
      >
        {messages.length === 0 ? (
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-5 pt-28 text-center sm:px-8 sm:pt-32">
            <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <SparkleIcon className="h-6 w-6" />
            </span>
            <h1 className="font-serif text-4xl font-medium tracking-tight text-foreground sm:text-5xl">
              Ask Lawplain
            </h1>
            <p className="mt-3 max-w-md text-balance text-sm text-muted">
              {pinnedContext
                ? `Grounded in ${pinnedContext.kind === "judgment" ? "judgment" : "statute"}: ${pinnedContext.title}`
                : "Ask a question about Singapore law in plain English — the agent searches judgments, statutes & Hansard, then writes a cited answer."}
            </p>
            {pinnedChip && (
              <div className="mt-5 w-full text-left">{pinnedChip}</div>
            )}
            <div className="mt-7 w-full">{composer}</div>
            <div className="mt-3 grid w-full gap-1.5 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  disabled={authBlocking || Boolean(loadingThreadId)}
                  className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-[13px] text-foreground transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {pinnedChip && (
              <div className="mx-auto w-full max-w-[850px] px-5 sm:px-8">
                {pinnedChip}
              </div>
            )}
            <div
              ref={chatScrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              className="thin-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            >
              <div className="mx-auto w-full max-w-[850px] space-y-6 px-5 py-4 sm:px-8">
                {messages.map((m, i) => {
                  const liveAssistant = isLiveAssistant(m);

                  return (
                    <div
                      key={`${activeThreadId}:${m.id}`}
                      id={`ask-message-${m.id}`}
                      className={`motion-fade-up scroll-mt-24 rounded-2xl transition-colors duration-700 ${
                        highlightedMessageId === m.id ? "bg-accent-soft/60" : ""
                      }`}
                    >
                      {m.role === "user" ? (
                        <MessageRow align="end">
                          <MessageAvatar>
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-muted-2">
                              <UserIcon className="h-4 w-4" />
                            </span>
                          </MessageAvatar>
                          <MessageContent>
                            <Bubble
                              variant="user"
                              className="px-3.5 py-2 text-sm"
                            >
                              {m.text}
                            </Bubble>
                          </MessageContent>
                        </MessageRow>
                      ) : (
                        <AssistantMessage
                          m={m}
                          now={liveAssistant ? now : (m.elapsedMs ?? 0)}
                          signInHref={signInHref}
                          signUpHref={signUpHref}
                          question={
                            messages[i - 1]?.role === "user"
                              ? messages[i - 1].text
                              : ""
                          }
                          cite={pinnedContext?.citation}
                          kind={pinnedContext?.kind}
                          sourceHref={pinnedContext?.href}
                          threadId={activeThreadId}
                          messageId={m.id}
                          isSignedIn={isSignedIn}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="shrink-0 bg-background/90 py-3 backdrop-blur">
              <div className="mx-auto w-full max-w-[850px] px-5 sm:px-8">
                {composer}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadSidebar({
  userId,
  open,
  onClose,
  activeId,
  activeStatus,
  busyId,
  onResume,
  onNewChat,
  onDeleteActive,
  refreshKey,
  optimisticThreads,
  onUnreadDoneChange,
}: {
  userId: string;
  open: boolean;
  onClose: () => void;
  activeId: string;
  activeStatus: "running" | "stopped" | "done" | null;
  busyId: string | null;
  onResume: (id: string) => void;
  onNewChat: () => void;
  onDeleteActive: (id: string, wasActive?: boolean) => void;
  refreshKey: number;
  optimisticThreads: ThreadListItem[];
  onUnreadDoneChange: (hasUnreadDoneThread: boolean) => void;
}) {
  const [items, setItems] = useState<ThreadListItem[]>(() => {
    if (typeof window === "undefined") return [];
    const listCacheKey = askCacheKey(userId, THREAD_LIST_CACHE_KEY);
    if (!listCacheKey) return [];
    try {
      const cached = JSON.parse(localStorage.getItem(listCacheKey) ?? "[]");
      const cachedItems = Array.isArray(cached)
        ? (cached as ThreadListItem[])
        : [];
      const byId = new Map<string, ThreadListItem>();
      for (const item of [...localThreadSummaries(userId), ...cachedItems]) {
        byId.set(item.id, { ...byId.get(item.id), ...item });
      }
      return [...byId.values()].sort(compareThreadsByLastPromptDesc);
    } catch {
      return localThreadSummaries(userId);
    }
  });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const fetchSeqRef = useRef(0);
  const q = query.trim().toLowerCase();
  const optimisticIdSet = new Set(optimisticThreads.map((thread) => thread.id));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const allItems = [
    ...optimisticThreads.map((thread) => {
      const fetched = itemsById.get(thread.id);
      const fetchedLastPromptAt = fetched
        ? Number.isFinite(fetched.lastPromptAt)
          ? fetched.lastPromptAt
          : fetched.createdAt
        : 0;
      const fetchedMatchesOptimisticRun =
        Boolean(fetched?.runId) && fetched?.runId === thread.runId;
      if (
        fetched?.status &&
        fetched.status !== thread.status &&
        (fetchedMatchesOptimisticRun ||
          fetchedLastPromptAt >= thread.lastPromptAt)
      ) {
        // The server should reconcile a stale optimistic status for the same
        // or a newer run in either direction. This covers both a background
        // completion and an older completion racing a newer running follow-up.
        // A brand-new prompt remains protected because its optimistic
        // lastPromptAt is newer until the run-start save reaches the server.
        return {
          ...thread,
          ...fetched,
        };
      }
      return {
        ...fetched,
        ...thread,
      };
    }),
    ...items.filter((item) => !optimisticIdSet.has(item.id)),
  ].sort(compareThreadsByLastPromptDesc);
  const filtered = q
    ? allItems.filter(
        (t) =>
          optimisticIdSet.has(t.id) ||
          (t.title || "").toLowerCase().includes(q),
      )
    : allItems;
  const hasRunningThreads = allItems.some(
    (thread) => thread.status === "running",
  );
  const hasUnreadDoneThread = allItems.some(
    (thread) => thread.status === "done" && thread.unread,
  );

  useEffect(() => {
    onUnreadDoneChange(hasUnreadDoneThread);
  }, [hasUnreadDoneThread, onUnreadDoneChange]);

  useEffect(() => {
    if (optimisticThreads.length > 0) setQuery("");
  }, [optimisticThreads.length]);

  const loadThreads = useCallback(
    (showLoading: boolean, isCancelled: () => boolean) => {
      const seq = fetchSeqRef.current + 1;
      fetchSeqRef.current = seq;
      if (showLoading) setLoading(true);
      fetch("/api/ask-threads", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`Thread list failed (${r.status})`);
          return r.json();
        })
        .then((d) => {
          if (isCancelled() || fetchSeqRef.current !== seq) return;
          const serverThreads =
            (d as { threads?: ThreadListItem[] }).threads ?? [];
          const byId = new Map<string, ThreadListItem>();
          for (const item of [
            ...localThreadSummaries(userId),
            ...serverThreads,
          ]) {
            byId.set(item.id, { ...byId.get(item.id), ...item });
          }
          const threads = [...byId.values()].sort(
            compareThreadsByLastPromptDesc,
          );
          setItems(threads);
          try {
            const listCacheKey = askCacheKey(userId, THREAD_LIST_CACHE_KEY);
            if (listCacheKey) {
              localStorage.setItem(listCacheKey, JSON.stringify(threads));
            }
          } catch {
            // Cache is best-effort only.
          }
        })
        .catch(() => {
          // Keep the last successful/cached list visible. A transient auth,
          // network, or D1 error should not make history look erased.
        })
        .finally(() => {
          if (!isCancelled() && fetchSeqRef.current === seq) setLoading(false);
        });
    },
    [userId],
  );

  useEffect(() => {
    // refreshKey is intentionally read so parent saves can refetch an already-open sidebar.
    void refreshKey;

    let cancelled = false;
    // The header indicator must discover server-side completions even before
    // the history drawer has ever been opened.
    loadThreads(open, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadThreads, open, refreshKey]);

  useEffect(() => {
    if (!hasRunningThreads) return;

    let cancelled = false;
    const pollRunningThreads = () => loadThreads(false, () => cancelled);
    const pollWhenVisible = () => {
      if (document.visibilityState === "visible") pollRunningThreads();
    };

    pollRunningThreads();
    const id = window.setInterval(pollRunningThreads, 2_000);
    window.addEventListener("focus", pollWhenVisible);
    document.addEventListener("visibilitychange", pollWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", pollWhenVisible);
      document.removeEventListener("visibilitychange", pollWhenVisible);
    };
  }, [hasRunningThreads, loadThreads]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function remove(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    setItems((xs) => xs.filter((x) => x.id !== id));
    removeLocalThreadSnapshot(userId, id);
    onDeleteActive(id, id === activeId);
    await fetch(`/api/ask-threads?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => {});
  }

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className={`fixed inset-0 z-30 cursor-default bg-transparent transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Conversation history"
        aria-hidden={!open}
        data-open={open}
        className={`fixed bottom-0 left-0 top-14 z-40 flex w-72 max-w-[85vw] flex-col overflow-hidden border-r border-border/70 bg-surface-2/30 transition-[transform,width,border-color] duration-300 ease-[var(--ease-smooth-out)] motion-reduce:transition-none lg:z-20 lg:max-w-none lg:translate-x-0 lg:border-r-0 ${
          open
            ? "translate-x-0 lg:w-[19rem]"
            : "pointer-events-none -translate-x-full lg:w-0 lg:border-transparent"
        }`}
      >
        <div
          className={`flex h-full min-w-72 flex-col transition-[transform,opacity] duration-200 ease-[var(--ease-smooth-out)] motion-reduce:transition-none ${
            open
              ? "translate-x-0 opacity-100 delay-75"
              : "-translate-x-2 opacity-0 delay-0"
          }`}
        >
          <div className="px-2 pt-2">
            <div className="flex h-10 items-center px-3">
              <span className="text-[13px] font-semibold leading-none uppercase tracking-wide text-muted-2">
                History
              </span>
            </div>
          </div>
          <div className="px-2">
            <button
              type="button"
              onClick={onNewChat}
              className="flex h-10 w-full items-center gap-2 rounded-lg px-3 text-sm font-medium leading-none text-foreground transition-colors hover:bg-background/70"
            >
              <span className="text-base leading-none text-muted-2">+</span>
              New chat
            </button>
          </div>
          {allItems.length > 0 && (
            <div className="px-2 pt-2">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search threads…"
                className="w-full rounded-lg bg-background/70 px-3 py-1.5 text-[13px] text-foreground outline-none ring-1 ring-transparent transition-colors placeholder:text-muted-2 focus:bg-background focus:ring-border-strong"
              />
            </div>
          )}
          <div className="thin-scroll mt-2 flex-1 overflow-y-auto px-2 pb-3">
            {loading && allItems.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-2">Loading…</p>
            ) : allItems.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-2">
                No saved threads yet.
              </p>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-2">
                No threads match “{query.trim()}”.
              </p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filtered.map((t) => {
                  const status =
                    t.id === activeId &&
                    !(
                      activeStatus === "running" &&
                      t.status &&
                      t.status !== "running"
                    )
                      ? activeStatus
                      : t.status;
                  const researching =
                    status === "running" ||
                    (t.id === busyId &&
                      t.status !== "done" &&
                      t.status !== "stopped");
                  const unreadDone =
                    !researching && status === "done" && t.unread;
                  return (
                    <div
                      key={t.id}
                      className={`group flex items-center gap-1 rounded-lg ${
                        t.id === activeId
                          ? "bg-accent-soft"
                          : "hover:bg-surface-2"
                      }`}
                    >
                      <button
                        type="button"
                        data-ask-history-thread={t.id}
                        onClick={() => {
                          setItems((xs) =>
                            xs.map((x) =>
                              x.id === t.id ? { ...x, unread: false } : x,
                            ),
                          );
                          onResume(t.id);
                        }}
                        title={t.title}
                        className={`flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left ${
                          t.id === activeId
                            ? "font-medium text-accent"
                            : "text-muted"
                        }`}
                      >
                        <span className="truncate text-[13px]">
                          {t.title || "Untitled"}
                        </span>
                        {researching && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-accent">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                            researching…
                          </span>
                        )}
                        {!researching && status === "stopped" && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                            exited
                          </span>
                        )}
                        {unreadDone && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-accent">
                            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                            done
                          </span>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void remove(e, t.id)}
                        aria-label="Delete thread"
                        className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-2 opacity-0 transition hover:bg-border hover:text-foreground group-hover:opacity-100"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
function AnswerActions({
  text,
  question,
  cite,
  kind,
  sourceHref,
  threadId,
  messageId,
  tools,
  isSignedIn,
  signInHref,
}: {
  text: string;
  question: string;
  cite?: string;
  kind?: string;
  sourceHref?: string;
  threadId: string;
  messageId: number;
  tools: string[];
  isSignedIn: boolean;
  signInHref: string;
}) {
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "unsaving" | "error"
  >("idle");
  const [savedAnswerId, setSavedAnswerId] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable
    }
  }

  function exportMarkdown() {
    const header = question ? `# ${question}\n\n` : "";
    const blob = new Blob([header + text], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lawplain-answer-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function save() {
    if (saveState === "saving" || saveState === "unsaving") return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/saved-answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          answer: text,
          cite,
          kind,
          sourceHref,
          threadId,
          messageId,
          tools,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        saved?: { id?: string };
      } | null;

      if (res.ok && data?.saved?.id) {
        setSavedAnswerId(data.saved.id);
        setSaveState("saved");
      } else {
        setSaveState("error");
      }
    } catch {
      setSaveState("error");
    }
  }

  async function unsave() {
    if (saveState === "saving" || saveState === "unsaving" || !savedAnswerId)
      return;

    setSaveState("unsaving");
    try {
      const res = await fetch(
        `/api/saved-answers?id=${encodeURIComponent(savedAnswerId)}`,
        { method: "DELETE" },
      );

      if (res.ok) {
        setSavedAnswerId(null);
        setSaveState("idle");
      } else {
        setSaveState("saved");
      }
    } catch {
      setSaveState("saved");
    }
  }

  function toggleSaved() {
    if (saveState === "saved") void unsave();
    else void save();
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-2">
      {isSignedIn ? (
        <button
          type="button"
          onClick={toggleSaved}
          className={btn}
          aria-label={saveState === "saved" ? "Unsave answer" : "Save answer"}
          disabled={saveState === "saving" || saveState === "unsaving"}
        >
          <BookIcon className="h-3.5 w-3.5" />
          {saveState === "saved"
            ? "Saved"
            : saveState === "saving"
              ? "Saving…"
              : saveState === "unsaving"
                ? "Unsaving…"
                : saveState === "error"
                  ? "Retry save"
                  : "Save"}
        </button>
      ) : (
        <Link href={signInHref} className={btn}>
          <BookIcon className="h-3.5 w-3.5" />
          Sign in to save
        </Link>
      )}
      <button
        type="button"
        onClick={copy}
        className={btn}
        aria-label="Copy answer"
      >
        {copied ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <CopyIcon className="h-3.5 w-3.5" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        onClick={exportMarkdown}
        className={btn}
        aria-label="Export answer as Markdown"
      >
        <svg
          viewBox="0 0 16 16"
          aria-hidden="true"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2v8" />
          <path d="m5 7 3 3 3-3" />
          <path d="M3 13h10" />
        </svg>
        Export .md
      </button>
    </div>
  );
}

const AssistantMessage = memo(function AssistantMessage({
  m,
  now,
  signInHref,
  signUpHref,
  question,
  cite,
  kind,
  sourceHref,
  threadId,
  messageId,
  isSignedIn,
}: {
  m: Message;
  now: number;
  signInHref: string;
  signUpHref: string;
  question: string;
  cite?: string;
  kind?: string;
  sourceHref?: string;
  threadId: string;
  messageId: number;
  isSignedIn: boolean;
}) {
  const live = !["done", "error", "stopped"].includes(m.phase);
  const elapsed = m.startedAt
    ? live
      ? Math.max(now - m.startedAt, m.elapsedMs ?? 0)
      : (m.elapsedMs ?? now - m.startedAt)
    : m.elapsedMs;
  return (
    <MessageRow align="start">
      <MessageAvatar>
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <SparkleIcon className="h-4 w-4" />
        </span>
      </MessageAvatar>
      <MessageContent className="gap-2">
        <MessageHeader>Lawplain</MessageHeader>

        {/* Tool steps — live while searching, settled once answered */}
        {m.tools.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {m.tools.map((t) => (
              <span
                key={t.id}
                className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] ${
                  live
                    ? "bg-surface-2 text-muted"
                    : "bg-background text-muted-2"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${TOOL_DOT[t.kind]}`}
                />
                {t.label}
                {t.count > 1 && (
                  <span className="rounded-full bg-background px-1.5 text-[10px] text-muted-2">
                    ×{t.count}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {/* Live status */}
        {live && (
          <output
            aria-live="polite"
            className="w-full rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-[13px] text-muted"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              <span className="font-medium text-foreground">
                {PHASE_LABEL[m.phase]}…
              </span>
              {elapsed !== undefined && (
                <span className="text-muted-2">{formatElapsed(elapsed)}</span>
              )}
            </div>
            {m.progress.length > 0 && (
              <ol className="mt-2 space-y-1 border-l border-border pl-3 font-mono text-[11px] text-muted-2">
                {m.progress.slice(-4).map((p, index, rows) => {
                  const rowElapsed =
                    live && index === rows.length - 1 && elapsed !== undefined
                      ? elapsed
                      : p.elapsedMs;

                  return (
                    <li key={p.id}>
                      {rowElapsed !== undefined && (
                        <span className="mr-2 tabular-nums">
                          {formatElapsed(rowElapsed)}
                        </span>
                      )}
                      {p.message}
                    </li>
                  );
                })}
              </ol>
            )}
          </output>
        )}

        {/* Answer body */}
        {m.text && (
          <Bubble
            id={`answer-${messageId}`}
            variant="assistant"
            className="scroll-mt-24 space-y-3 px-4 py-3 font-serif text-[15px] leading-relaxed"
          >
            <AnswerMarkdown text={m.text} />
            {live && (
              <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-full bg-accent align-middle" />
            )}
          </Bubble>
        )}

        {/* Stopped / error */}
        {m.phase === "stopped" && (
          <p className="w-fit rounded-2xl rounded-bl-md bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            Research exited. Any partial answer above may be incomplete.
          </p>
        )}
        {m.phase === "error" && m.error && (
          <p className="w-fit rounded-2xl rounded-bl-md bg-red-50 px-3 py-2 text-[13px] text-red-700">
            {m.error === "Please sign in to use Ask Lawplain." ? (
              <>
                Please{" "}
                <Link
                  href={signInHref}
                  className="font-medium underline decoration-red-700/40 underline-offset-2 hover:decoration-red-700"
                >
                  sign in
                </Link>{" "}
                or{" "}
                <Link
                  href={signUpHref}
                  className="font-medium underline decoration-red-700/40 underline-offset-2 hover:decoration-red-700"
                >
                  sign up
                </Link>{" "}
                to use Ask Lawplain.
              </>
            ) : (
              m.error
            )}
          </p>
        )}

        {/* Answer actions — copy / export / save, once complete (#22) */}
        {m.text && !live && m.phase !== "error" && (
          <AnswerActions
            text={m.text}
            question={question}
            cite={cite}
            kind={kind}
            sourceHref={sourceHref}
            threadId={threadId}
            messageId={messageId}
            tools={m.tools.map((t) => t.label)}
            isSignedIn={isSignedIn}
            signInHref={signInHref}
          />
        )}

        {/* Footer meta */}
        {!live && (m.cost || m.phase === "done") && (
          <MessageFooter className="px-1 text-[11px] text-muted-2">
            {m.cost
              ? `${m.cost.tokens.toLocaleString()} tokens · $${m.cost.usd.toFixed(4)} · `
              : ""}
            not legal advice
          </MessageFooter>
        )}
      </MessageContent>
    </MessageRow>
  );
});
