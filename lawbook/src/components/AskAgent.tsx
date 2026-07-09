"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
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

function AnswerMarkdown({ text }: { text: string }) {
  return (
    <div className="ask-md space-y-3">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

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

function takePendingAsk(): PendingAsk | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ASK_KEY);
    if (!raw) return null;

    sessionStorage.removeItem(PENDING_ASK_KEY);

    const parsed = JSON.parse(raw) as Partial<PendingAsk>;
    if (
      parsed.v !== 1 ||
      typeof parsed.question !== "string" ||
      !parsed.question.trim() ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > PENDING_ASK_TTL_MS
    ) {
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
    try {
      sessionStorage.removeItem(PENDING_ASK_KEY);
    } catch {
      // Ignore unavailable storage.
    }
    return null;
  }
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

export function AskAgent({
  initialContext,
  initialThreadId,
}: AskAgentProps = {}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const isSignedIn = Boolean(session?.user);
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { setHideFooter } = useChrome();
  const [queuedPrompt, setQueuedPrompt] = useState<string | null>(null);
  const [pinnedContext, setPinnedContext] = useState(initialContext);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef(false);
  const queueingOpenRef = useRef(false);
  const queuedPromptRef = useRef<string | null>(null);
  const pendingSendAfterCleanupRef = useRef<string | null>(null);
  const sendRef = useRef<
    | ((
        text: string,
        resumeRunId?: string,
        resumeFrom?: number,
      ) => Promise<void>)
    | null
  >(null);
  const historyIndexRef = useRef(-1);
  const draftBeforeHistoryRef = useRef("");
  const msgId = useRef(0);
  const toolId = useRef(0);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  useEffect(() => {
    setHideFooter(messages.length > 0);
    return () => setHideFooter(false);
  }, [messages.length, setHideFooter]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    number | null
  >(null);
  const draftKey = `ask:draft:${pinnedContext?.kind ?? "none"}:${pinnedContext?.citation ?? "none"}`;

  useEffect(() => {
    setPinnedContext(initialContext);
  }, [initialContext]);

  useEffect(() => {
    try {
      setInput(sessionStorage.getItem(draftKey) ?? "");
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey]);

  useEffect(() => {
    try {
      if (input) sessionStorage.setItem(draftKey, input);
      else sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey, input]);

  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      // Ignore unavailable storage.
    }
  }, [draftKey]);

  const resetHistoryNavigation = useCallback(() => {
    historyIndexRef.current = -1;
    draftBeforeHistoryRef.current = "";
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: input changes the textarea's rendered text, so re-measure
  useEffect(() => {
    autosize();
  }, [input, autosize]);

  /** Keep the page pinned to the latest message, unless opened to a saved answer. */
  useLayoutEffect(() => {
    if (messages.length === 0) return;

    const hash = window.location.hash.replace(/^#/, "");
    const match = /^(?:answer|message)-(\d+)$/.exec(hash);
    if (match) {
      const id = Number(match[1]);
      const target =
        document.getElementById(`answer-${id}`) ??
        document.getElementById(`ask-message-${id}`);
      if (target) {
        target.scrollIntoView({ block: "start" });
        setHighlightedMessageId(id);
        const timer = window.setTimeout(() => {
          setHighlightedMessageId((current) =>
            current === id ? null : current,
          );
        }, 3000);
        return () => window.clearTimeout(timer);
      }
    }

    window.scrollTo({ top: document.documentElement.scrollHeight });
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
      sessionStorage.removeItem("ask:activeRun");
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
  }, []);

  const steerQueuedPrompt = useCallback(() => {
    if (!queuedPromptRef.current) return;
    stop();
  }, [stop]);

  const send = useCallback(
    async (text: string, resumeRunId?: string, resumeFrom = 0) => {
      const q = text.trim();
      if (!q) return;

      if (sessionPending) return;

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
        setMessages((m) => [...m, userMsg, authMsg]);
        if (saved) {
          clearDraft();
          setInput("");
        }
        return;
      }

      if (activeRef.current) {
        if (queueingOpenRef.current) {
          queuePrompt(q);
        } else {
          pendingSendAfterCleanupRef.current = q;
          setInput("");
        }
        return;
      }

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

      const userMsg: Message = reuseRunningAssistant
        ? (existingUser as Message)
        : {
            id: msgId.current++,
            role: "user",
            text: q,
            tools: [],
            progress: [],
            phase: "done",
          };
      const aId = reuseRunningAssistant
        ? (existingAssistant as Message).id
        : msgId.current++;
      const startedAt = reuseRunningAssistant
        ? ((existingAssistant as Message).startedAt ?? Date.now())
        : Date.now();
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
                message: "Connecting to the research agent…",
                elapsedMs: 0,
              },
            ],
            startedAt,
            eventCursor: 0,
            phase: "starting",
          };
      if (!reuseRunningAssistant) {
        setMessages((m) => [...m, userMsg, assistantMsg]);
      }
      if (
        !reuseRunningAssistant &&
        messagesRef.current.length === 0 &&
        typeof window !== "undefined" &&
        window.location.pathname === "/ask"
      ) {
        window.history.replaceState(null, "", `/ask/${threadIdRef.current}`);
      }
      clearDraft();
      setInput("");
      setBusy(true);

      const ac = new AbortController();
      abortRef.current = ac;

      const patch = (fn: (m: Message) => Message) =>
        setMessages((ms) => ms.map((m) => (m.id === aId ? fn(m) : m)));

      try {
        const history = messagesRef.current
          .filter((m) => m.text.trim().length > 0)
          .slice(-12)
          .map((m) => ({ role: m.role, text: m.text.slice(0, 6000) }));
        const runId = resumeRunId ?? crypto.randomUUID();
        runIdRef.current = runId;
        try {
          sessionStorage.setItem(
            "ask:activeRun",
            JSON.stringify({ runId, question: q, startedAt }),
          );
        } catch {
          // sessionStorage may be unavailable
        }
        // Persist the thread at run-start so the owner's OTHER tabs can see it
        // (and reconnect to the live run) while it's still researching — not
        // only once it settles. Fresh runs only; reconnects already exist.
        if (isSignedIn && !resumeRunId) {
          const runningTranscript = serializeMessages([
            ...messagesRef.current,
            userMsg,
            assistantMsg,
          ]);
          const startTitle = shortTitle(
            messagesRef.current.find((m) => m.role === "user")?.text ?? q,
          );
          await fetch("/api/ask-threads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              id: threadIdRef.current,
              title: startTitle,
              messages: runningTranscript,
              cite: pinnedContext?.citation,
              kind: pinnedContext?.kind,
              sourceHref: pinnedContext?.href,
              runId,
              status: "running",
            }),
          }).catch(() => {});
        }
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: q,
            cite: pinnedContext?.citation,
            kind: pinnedContext?.kind,
            history,
            runId,
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
                patch((m) => ({
                  ...m,
                  phase: mapProgressPhase(ev.phase),
                  elapsedMs: ev.elapsedMs,
                  progress: [
                    ...m.progress,
                    {
                      id: toolId.current++,
                      message: ev.message,
                      elapsedMs: ev.elapsedMs,
                    },
                  ].slice(-6),
                }));
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
              case "done":
                queueingOpenRef.current = false;
                patch((m) => ({
                  ...m,
                  text: ev.text || acc,
                  phase: "done",
                  cost: { usd: ev.costUsd, tokens: ev.contextTokens },
                }));
                try {
                  sessionStorage.removeItem("ask:activeRun");
                } catch {
                  /* ignore */
                }
                await reader.cancel().catch(() => {});
                return;
              case "error":
                queueingOpenRef.current = false;
                patch((m) => ({ ...m, phase: "error", error: ev.message }));
                try {
                  sessionStorage.removeItem("ask:activeRun");
                } catch {
                  /* ignore */
                }
                await reader.cancel().catch(() => {});
                return;
            }
          }
        }
      } catch (err) {
        queueingOpenRef.current = false;
        if ((err as Error).name !== "AbortError") {
          patch((m) => ({
            ...m,
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
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
    },
    [
      clearDraft,
      isSignedIn,
      pinnedContext,
      queuePrompt,
      resetHistoryNavigation,
      sessionPending,
    ],
  );

  sendRef.current = send;

  useEffect(() => {
    if (!isSignedIn || busy || messagesRef.current.length > 0) return;

    const pending = takePendingAsk();
    if (!pending) return;

    window.setTimeout(() => {
      void sendRef.current?.(pending.question);
    }, 0);
  }, [busy, isSignedIn]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  // ── Saved threads: autosave each turn + resume from History ───────────
  const threadIdRef = useRef<string>("");
  const runIdRef = useRef<string | null>(null);
  if (!threadIdRef.current)
    threadIdRef.current = initialThreadId ?? crypto.randomUUID();

  const flushRunningThread = useCallback(() => {
    const snapshot = messagesRef.current;
    if (!isSignedIn || snapshot.length === 0) return;
    if (!snapshot.some((m) => m.role === "user")) return;

    const latestAssistant = latestAssistantMessage(snapshot);
    const running = latestAssistant ? isLiveAssistant(latestAssistant) : false;
    if (!running) return;

    void fetch("/api/ask-threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        id: threadIdRef.current,
        title: shortTitle(snapshot.find((m) => m.role === "user")?.text ?? ""),
        messages: serializeMessages(snapshot),
        cite: pinnedContext?.citation,
        kind: pinnedContext?.kind,
        sourceHref: pinnedContext?.href,
        runId: runIdRef.current ?? undefined,
        status: "running",
      }),
    }).catch(() => {
      // best-effort flush before detaching from a running research stream
    });
  }, [isSignedIn, pinnedContext]);

  useEffect(() => {
    return () => flushRunningThread();
  }, [flushRunningThread]);

  // Reconnect to a DO-hosted run still going after the user navigated away.
  const reconnectedRef = useRef(false);
  useEffect(() => {
    if (reconnectedRef.current || !isSignedIn || initialThreadId) return;
    reconnectedRef.current = true;
    if (messagesRef.current.length > 0) return;
    try {
      const raw = sessionStorage.getItem("ask:activeRun");
      if (!raw) return;
      const ar = JSON.parse(raw) as {
        runId?: string;
        question?: string;
        startedAt?: number;
      };
      if (!ar.runId || !ar.question) return;
      if (Date.now() - (ar.startedAt ?? 0) > 6 * 60 * 1000) {
        sessionStorage.removeItem("ask:activeRun");
        return;
      }
      void sendRef.current?.(ar.question, ar.runId);
    } catch {
      // ignore reconnect failures
    }
  }, [isSignedIn, initialThreadId]);

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
    const runId = running ? (runIdRef.current ?? undefined) : undefined;
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
        }).catch(() => {
          // best-effort autosave
        });
      },
      running ? 1200 : 300,
    );
    return () => window.clearTimeout(timer);
  }, [messages, isSignedIn, pinnedContext]);

  const newChat = useCallback(() => {
    // Detach this UI stream only. Durable Object-backed research keeps running
    // in the background; explicit Stop is the only path that cancels backend work.
    flushRunningThread();
    queuedPromptRef.current = null;
    pendingSendAfterCleanupRef.current = null;
    queueingOpenRef.current = false;
    activeRef.current = false;
    abortRef.current?.abort();
    setBusy(false);
    setMessages([]);
    clearDraft();
    setInput("");
    clearQueuedPrompt();
    threadIdRef.current = crypto.randomUUID();
    if (typeof window !== "undefined" && window.location.pathname !== "/ask") {
      window.history.replaceState(null, "", "/ask");
    }
    runIdRef.current = null;
    try {
      sessionStorage.removeItem("ask:activeRun");
    } catch {
      /* ignore */
    }
  }, [clearDraft, clearQueuedPrompt, flushRunningThread]);

  const loadThread = useCallback(
    async (threadId: string) => {
      flushRunningThread();
      try {
        const res = await fetch(
          `/api/ask-threads?id=${encodeURIComponent(threadId)}`,
        );
        if (!res.ok) return;
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
        const raw = data.thread?.messages ?? [];
        const loaded: Message[] = raw.map((m, i) => ({
          id: typeof m.id === "number" ? m.id : i,
          role: m.role === "user" ? "user" : "assistant",
          text: typeof m.text === "string" ? m.text : "",
          tools: Array.isArray(m.tools) ? m.tools : [],
          progress: Array.isArray(m.progress) ? m.progress : [],
          phase: m.phase ?? "done",
          startedAt: typeof m.startedAt === "number" ? m.startedAt : undefined,
          elapsedMs: typeof m.elapsedMs === "number" ? m.elapsedMs : undefined,
          eventCursor:
            typeof m.eventCursor === "number" ? m.eventCursor : undefined,
          cost: m.cost,
          error: m.error,
        }));
        abortRef.current?.abort();
        msgId.current = loaded.reduce((mx, m) => Math.max(mx, m.id), 0) + 1;
        threadIdRef.current = threadId;

        // Still researching? Show the persisted in-flight transcript immediately,
        // then reconnect to the same run. Newer rows include the assistant
        // placeholder/progress; legacy rows only have the trailing user, so keep
        // that fallback for older saved running threads.
        const last = loaded[loaded.length - 1];
        const runId = data.thread?.runId;
        if (data.thread?.status === "running" && runId) {
          activeRef.current = false;
          runIdRef.current = runId;
          if (last && isLiveAssistant(last)) {
            const user = [...loaded]
              .reverse()
              .find((m) => m.role === "user" && m.text.trim());
            setMessages(loaded);
            if (user) {
              window.setTimeout(() => {
                void sendRef.current?.(user.text, runId, last.eventCursor ?? 0);
              }, 0);
            }
            return;
          }
          if (last?.role === "user") {
            setBusy(true);
            setMessages(loaded.slice(0, -1));
            void sendRef.current?.(last.text, runId);
            return;
          }
        }

        setBusy(false);
        setMessages(loaded);
      } catch {
        // ignore load failures
      }
    },
    [flushRunningThread],
  );

  // Opened at /ask/[id]: restore that saved conversation on mount.
  const loadedThreadRef = useRef(false);
  useEffect(() => {
    if (loadedThreadRef.current || !initialThreadId) return;
    loadedThreadRef.current = true;
    threadIdRef.current = initialThreadId;
    void loadThread(initialThreadId);
  }, [initialThreadId, loadThread]);
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
          ref={inputRef}
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
            messages.length === 0
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
              disabled={sessionPending || !input.trim()}
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
            disabled={sessionPending || !input.trim()}
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
  const liveAssistantThreadId =
    latestAssistantForBusy && isLiveAssistant(latestAssistantForBusy)
      ? threadIdRef.current
      : null;

  return (
    <div className="flex flex-col">
      {isSignedIn && (
        <ThreadSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeId={threadIdRef.current}
          busyId={liveAssistantThreadId}
          onResume={(id) => {
            void loadThread(id);
            if (typeof window !== "undefined") {
              window.history.replaceState(null, "", `/ask/${id}`);
            }
          }}
          onNewChat={newChat}
        />
      )}
      {isSignedIn && (
        <div className="mb-2 flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
            History
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={newChat}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              New chat
            </button>
          )}
        </div>
      )}
      {messages.length === 0 ? (
        <div className="flex flex-col items-center pt-2 text-center sm:pt-4">
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
                disabled={sessionPending}
                className="rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left text-[13px] text-foreground transition-colors hover:border-border-strong hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col">
          {pinnedChip}
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions text"
            className="flex-1 space-y-6 pb-24"
          >
            {messages.map((m, i) => (
              <div
                key={m.id}
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
                      <Bubble variant="user" className="px-3.5 py-2 text-sm">
                        {m.text}
                      </Bubble>
                    </MessageContent>
                  </MessageRow>
                ) : (
                  <AssistantMessage
                    m={m}
                    now={now}
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
                    threadId={threadIdRef.current}
                    messageId={m.id}
                    isSignedIn={isSignedIn}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 -mx-5 border-t border-border bg-background/90 px-5 py-3 backdrop-blur sm:-mx-8 sm:px-8">
            {composer}
          </div>
        </div>
      )}
    </div>
  );
}

interface ThreadListItem {
  id: string;
  title: string;
  updatedAt: number;
  status?: string | null;
}

function ThreadSidebar({
  open,
  onClose,
  activeId,
  busyId,
  onResume,
  onNewChat,
}: {
  open: boolean;
  onClose: () => void;
  activeId: string;
  busyId: string | null;
  onResume: (id: string) => void;
  onNewChat: () => void;
}) {
  const [items, setItems] = useState<ThreadListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((t) => (t.title || "").toLowerCase().includes(q))
    : items;

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/ask-threads")
      .then((r) => (r.ok ? r.json() : { threads: [] }))
      .then((d) =>
        setItems((d as { threads?: ThreadListItem[] }).threads ?? []),
      )
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [open]);

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
        className={`fixed inset-0 z-30 cursor-default bg-foreground/20 transition-opacity duration-300 lg:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Conversation history"
        aria-hidden={!open}
        className={`fixed bottom-0 left-0 top-14 z-40 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background shadow-xl transition-transform duration-500 ease-[var(--ease-emphasized)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-2">
            History
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-2 transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={onNewChat}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            <span className="text-base leading-none text-muted-2">+</span>
            New chat
          </button>
        </div>
        {items.length > 0 && (
          <div className="px-2 pt-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search threads…"
              className="w-full rounded-lg border border-border bg-surface-2/50 px-3 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-2 focus:border-border-strong focus:bg-background"
            />
          </div>
        )}
        <div className="thin-scroll mt-2 flex-1 overflow-y-auto px-2 pb-3">
          {loading ? (
            <p className="px-2 py-3 text-xs text-muted-2">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-2">
              No saved threads yet.
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-2">
              No threads match “{query.trim()}”.
            </p>
          ) : (
            <div className="flex flex-col gap-0.5">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  className={`group flex items-center gap-1 rounded-lg ${
                    t.id === activeId ? "bg-accent-soft" : "hover:bg-surface-2"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onResume(t.id)}
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
                    {t.id === busyId && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-accent">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                        researching…
                      </span>
                    )}
                    {t.id !== busyId && t.status === "stopped" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        exited
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
              ))}
            </div>
          )}
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-2">
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

function AssistantMessage({
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
      ? now - m.startedAt
      : (m.elapsedMs ?? now - m.startedAt)
    : undefined;
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
}
