"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUpIcon,
  BookIcon,
  SparkleIcon,
  StopIcon,
} from "@/components/icons";
import type { ChatContext } from "@/lib/agent";

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
  error?: string;
  cost?: { usd: number; tokens: number };
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
      label = `Reading judgment ${summary.split('"')[0].slice("/v1/judgments/".length)}`;
    } else if (summary.startsWith("/v1/statutes/")) {
      const ref = summary
        .split('"')[0]
        .slice("/v1/statutes/".length)
        .replace(/%20/g, " ");
      kind = "fetch";
      label = `Reading statute ${ref}`;
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
    key: `${kind}:${label.toLowerCase()}`,
    kind,
    label,
    count: ev.count ?? 1,
  };
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

/* ── minimal inline markdown: links + bold ─────────────────────────────── */

function renderInline(text: string): React.ReactNode[] {
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last)
      nodes.push(<span key={`t${key++}`}>{text.slice(last, idx)}</span>);
    if (m[1] !== undefined) {
      const href = m[2];
      const isInternal = href.startsWith("/");
      nodes.push(
        isInternal ? (
          <a
            key={`l${key++}`}
            href={href}
            className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {m[1]}
          </a>
        ) : (
          <a
            key={`l${key++}`}
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
          >
            {m[1]}
          </a>
        ),
      );
    } else {
      nodes.push(
        <strong key={`b${key++}`} className="font-semibold">
          {m[3]}
        </strong>,
      );
    }
    last = idx + m[0].length;
  }
  if (last < text.length)
    nodes.push(<span key={`t${key++}`}>{text.slice(last)}</span>);
  return nodes;
}

function renderMarkdown(text: string): React.ReactNode {
  const blocks = text.split(/\n\n+/).filter(Boolean);
  let key = 0;
  let liKey = 0;
  return blocks.map((block) => {
    // numbered list
    if (/^\d+\.\s/.test(block)) {
      const items = block.split(/\n(?=\d+\.\s)/);
      return (
        <ol key={`o${key++}`} className="ml-1 space-y-1.5">
          {items.map((item) => {
            const body = item.replace(/^\d+\.\s*/, "");
            const k = liKey++;
            return (
              <li key={`li${k}`} className="flex gap-2.5">
                <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-semibold tabular-nums text-muted">
                  {k + 1}
                </span>
                <span className="flex-1">{renderInline(body)}</span>
              </li>
            );
          })}
        </ol>
      );
    }
    // bullet list
    if (/^\s*[-*]\s/.test(block)) {
      const items = block.split(/\n(?=\s*[-*]\s)/);
      return (
        <ul key={`u${key++}`} className="ml-1 space-y-1.5">
          {items.map((item) => {
            const body = item.replace(/^\s*[-*]\s*/, "");
            const k = liKey++;
            return (
              <li key={`li${k}`} className="flex gap-2.5">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="flex-1">{renderInline(body)}</span>
              </li>
            );
          })}
        </ul>
      );
    }
    return (
      <p key={`p${key++}`} className="leading-relaxed">
        {renderInline(block)}
      </p>
    );
  });
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

export interface AskAgentProps {
  /** A document the user came from — pinned to the transcript and sent with
   *  every question so the agent grounds its answer in that document. */
  initialContext?: ChatContext;
}

export function AskAgent({ initialContext }: AskAgentProps = {}) {
  const pathname = usePathname();
  const signUpHref = `/sign-up?next=${encodeURIComponent(pathname || "/")}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const abortRef = useRef<AbortController | null>(null);
  const msgId = useRef(0);
  const toolId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  /** Stick to the bottom while streaming, unless the user scrolled up. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin to bottom whenever the transcript changes
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
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
                  message: "Research stopped by you.",
                  elapsedMs: m.startedAt ? Date.now() - m.startedAt : undefined,
                },
              ],
            }
          : m,
      ),
    );
  }, []);

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;

      const userMsg: Message = {
        id: msgId.current++,
        role: "user",
        text: q,
        tools: [],
        progress: [],
        phase: "done",
      };
      const aId = msgId.current++;
      const startedAt = Date.now();
      const assistantMsg: Message = {
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
        phase: "starting",
      };
      setMessages((m) => [...m, userMsg, assistantMsg]);
      setInput("");
      setBusy(true);

      const ac = new AbortController();
      abortRef.current = ac;

      const patch = (fn: (m: Message) => Message) =>
        setMessages((ms) => ms.map((m) => (m.id === aId ? fn(m) : m)));

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            question: q,
            cite: initialContext?.citation,
            kind: initialContext?.kind,
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
        let acc = "";

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
                          ? { ...t, count: Math.max(t.count + 1, step.count) }
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
                patch((m) => ({
                  ...m,
                  text: ev.text || acc,
                  phase: "done",
                  cost: { usd: ev.costUsd, tokens: ev.contextTokens },
                }));
                break;
              case "error":
                patch((m) => ({ ...m, phase: "error", error: ev.message }));
                break;
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          patch((m) => ({
            ...m,
            phase: "error",
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, initialContext],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <SparkleIcon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">Ask Lawplain</p>
          <p className="text-[11px] text-muted-2">
            An agent searches judgments, statutes &amp; Hansard for you.
          </p>
        </div>
        {messages.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setInput("");
            }}
            className="rounded-md px-2 py-1 text-xs text-muted-2 hover:bg-surface-2 hover:text-muted"
          >
            New chat
          </button>
        )}
      </div>

      {/* Transcript / empty state */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className="thin-scroll max-h-[60vh] min-h-[180px] overflow-y-auto px-4 py-4"
      >
        {initialContext && (
          <a
            href={initialContext.href}
            className="mb-4 flex items-center gap-2.5 rounded-xl border border-border bg-surface-2/60 px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-2"
          >
            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-background text-muted">
              <BookIcon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-2">
                {initialContext.kind === "judgment" ? "Judgment" : "Statute"} ·
                pinned
              </span>
              <span className="block truncate text-[13px] font-medium text-foreground">
                {initialContext.title}
              </span>
            </span>
            <span className="shrink-0 font-mono text-[10px] text-muted-2">
              {initialContext.citation}
            </span>
          </a>
        )}
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <SparkleIcon className="h-5 w-5" />
            </span>
            <p className="max-w-sm text-sm text-muted">
              Ask a question about Singapore law in plain English. The agent
              will search the corpus, read the most relevant sources, and write
              a cited answer.
            </p>
            <div className="mt-5 flex w-full max-w-md flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-lg border border-border bg-background px-3.5 py-2.5 text-left text-[13px] text-foreground transition-colors hover:border-border-strong hover:bg-surface-2"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-foreground px-3.5 py-2 text-sm text-primary-fg">
                    {m.text}
                  </div>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  m={m}
                  now={now}
                  signUpHref={signUpHref}
                />
              ),
            )}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={onSubmit}
        className="flex items-end gap-2 border-t border-border bg-surface px-3 py-3"
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="Ask a follow-up…"
          className="thin-scroll max-h-40 flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-2 focus:border-accent focus:outline-none disabled:opacity-50"
          disabled={busy}
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="inline-flex h-[42px] items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium text-muted hover:bg-surface-2"
          >
            <StopIcon className="h-4 w-4" /> Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-foreground text-primary-fg transition-opacity disabled:cursor-not-allowed disabled:opacity-30 hover:opacity-90"
            aria-label="Send"
          >
            <ArrowUpIcon className="h-4 w-4" />
          </button>
        )}
      </form>
    </div>
  );
}

function AssistantMessage({
  m,
  now,
  signUpHref,
}: {
  m: Message;
  now: number;
  signUpHref: string;
}) {
  const live = !["done", "error", "stopped"].includes(m.phase);
  const elapsed = m.startedAt ? (m.elapsedMs ?? now - m.startedAt) : undefined;
  return (
    <div className="flex flex-col gap-2.5">
      {/* Tool steps — collapsible once answering, live while searching */}
      {m.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {m.tools.map((t) => (
            <span
              key={t.id}
              className={`inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-mono text-[11px] ${
                live ? "bg-surface-2 text-muted" : "bg-background text-muted-2"
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
          className="rounded-xl border border-border bg-surface-2/70 px-3 py-2 text-[13px] text-muted"
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
              {m.progress.slice(-4).map((p) => (
                <li key={p.id}>
                  {p.elapsedMs !== undefined && (
                    <span className="mr-2 tabular-nums">
                      {formatElapsed(p.elapsedMs)}
                    </span>
                  )}
                  {p.message}
                </li>
              ))}
            </ol>
          )}
        </output>
      )}

      {/* Answer body */}
      {m.text && (
        <div className="space-y-3 font-serif text-[15px] text-foreground">
          {renderMarkdown(m.text)}
          {live && (
            <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-full bg-accent align-middle" />
          )}
        </div>
      )}

      {/* Stopped / error */}
      {m.phase === "stopped" && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          Research stopped. Any partial answer above may be incomplete.
        </p>
      )}
      {m.phase === "error" && m.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {m.error === "Please sign in to use Ask Lawplain." ? (
            <>
              Please sign in or{" "}
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

      {/* Footer meta */}
      {!live && (m.cost || m.phase === "done") && (
        <p className="text-[11px] text-muted-2">
          {m.cost
            ? `${m.cost.tokens.toLocaleString()} tokens · $${m.cost.usd.toFixed(4)} · `
            : ""}
          not legal advice
        </p>
      )}
    </div>
  );
}
