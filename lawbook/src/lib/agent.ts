/**
 * Lawplain legal-research agent — drives the `graff` binary (via
 * @codegraff/sdk) to answer natural-language questions about the Singapore
 * legal corpus by searching the read-only sgjudge REST API itself.
 *
 * The agent has a `bash` tool; with `yolo: true` it runs `curl` against
 * https://backend.lawplain.com, parses the JSON, iterates, and writes a
 * cited answer. It runs in an isolated temp cwd so it cannot touch the
 * project source.
 *
 * Requires the `graff` binary on PATH and a model key configured
 * (`graff key set <provider> <key>` or the matching `<PROVIDER>_API_KEY`
 * env var). See README §"Agent setup".
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Event, runAgent } from "@codegraff/sdk";
import {
  createSandbox,
  deleteSandbox,
  GRAFF_BIN_PATH,
  installGraff,
  readSandboxFile,
  runProcess,
} from "@/lib/cubesandbox";
import { BASE } from "@/lib/sgjudge";

export const AGENT_MODEL = process.env.LAWPLAIN_AGENT_MODEL ?? "glm-5.2";

/** Override the `graff` binary path (defaults to `graff` on PATH). */
export const AGENT_BINARY = process.env.LAWGRAFF_BINARY ?? "graff";

/**
 * System prompt that turns graff into a focused Singapore-law research
 * assistant. The endpoint list mirrors `src/lib/sgjudge.ts` so the agent
 * knows the exact shapes it can query.
 */
export function legalResearchPrompt(): string {
  return `You are Lawplain Research, an assistant for the Singapore legal
corpus. You answer questions about case law, statutes, subsidiary
legislation, parliamentary Hansard, bills and practice directions by
querying a read-only REST API yourself and synthesizing a cited answer.

# The API
Base URL: ${BASE}  (public, GET-only, CORS *, returns JSON).
All search endpoints take \`?q=\` (required) and \`?limit=\` (default 10, max 50).
Search results are ranked by SQLite FTS5 bm25 — the \`score\` field is NEGATIVE;
more negative = more relevant. Each hit has a \`snippet\` with <b> highlights.

Endpoints (curl them with \`-s\` and pipe through \`jq\` to keep output small):
- GET /v1/judgments/search?q=&court=&year_range=&since=&judge=&limit=
    hits: citation, neutral_cite?, court?, year?, title?, decision_date?
- GET /v1/judgments/{citation}?include_body=true&body_offset=0&body_length=8000
    detail incl. body_text (paginated via body_offset/body_length)
- GET /v1/statutes/search?q=&kind=&limit=
    hits: act_id, kind?, short_title?, year_enacted?
- GET /v1/statutes/{reference}?kind=&include_body=true
    detail incl. sections[] (section_no, heading?, text?)
- GET /v1/statutes/{actId}/sections/{sectionNo}
- GET /v1/subsidiary-legislation/search?q=&parent_act_id=&limit=
- GET /v1/hansard/search?q=&speaker=&since=&limit=
    hits: speaker?, party?, constituency?, topic?, date?
- GET /v1/bills/search?q=&session=&status=&limit=
    hits: session?, status?, title?
- GET /v1/practice-directions/search?q=&court=&limit=
- GET /v1/stats   (corpus counts, for orientation)

Always URL-encode the query (use \`--data-urlencode\` with \`-G\`).
Keep each curl's output small: select only the columns you need with jq, e.g.
  curl -sG "${BASE}/v1/judgments/search" --data-urlencode "q=defamation" | jq '.results[] | {citation,title,court,year,score}'

# How to work — STRICT BUDGET (this is enforced)
You have a HARD LIMIT of 6 tool calls total for the whole turn. Count them.
For broad doctrine questions like "what are the elements of X", use FAST PATH:
- Run exactly ONE targeted search with limit=5.
- Fetch exactly ONE best detail result if needed.
- Then STOP searching and answer. Do not inspect multiple cases unless the user asks for comparison.
For harder questions:
- NEVER repeat a search or detail fetch you have already run (same endpoint + query/citation).
- Do at most 2 searches, then at most 2 detail fetches for the most promising hits.
- Prefer limit=5 on searches to keep context small.
- Prefer Court of Appeal and High Court authorities over District Court results.
  If the top result is SGDC but a relevant SGHC/SGCA result appears, use SGHC/SGCA.
- Once you have any usable authoritative result, STOP searching and write the answer.
  Do not "double-check" or re-search the same term. Do not call /v1/stats.
- If the first search already answers the question, answer immediately with 1 tool call total.
- Do not call the same URL/citation twice. Duplicate tool calls waste the user's time.
- For defamation-elements questions, good search terms are:
  "defamation defamatory reference publication" or "defamation elements plaintiff".
- Do not narrate your internal process in the final answer.
- Do not call attempt_completion; just write the final answer normally.

# Answering
- Write in clear prose (markdown). Lead with the direct answer, then support.
- Keep the answer concise: direct answer, 2-4 bullets/numbered points, citations.
- When asked what a claimant/plaintiff "must prove", list only the legal elements.
  Keep defences, burden shifts, damages, or remedies in a short separate note only if needed.
- Cite every non-trivial claim: judgments by neutral citation or [citation]
  and year; statutes by short title + section number.
- Link to the app where useful: judgments at /judgment/{citation} and
  statutes at /statute/{act_id}. Use app-relative markdown links, not backend URLs.
- Be factual and neutral. This is legal information, NOT legal advice — say so
  briefly when a user asks for a recommendation or prediction.
- If the corpus has nothing relevant, say so plainly; do not invent cases,
  citations, or section numbers.
- Quote sparingly (a phrase), never paste whole bodies.
`;
}

export interface AgentTurnEvent {
  /** Streamed assistant text delta. */
  type: "delta";
  text: string;
}
export interface AgentProgressEvent {
  type: "progress";
  phase:
    | "context"
    | "sandbox_start"
    | "agent_install"
    | "agent_start"
    | "thinking"
    | "searching"
    | "reading"
    | "answering"
    | "cleanup";
  message: string;
  elapsedMs?: number;
}
export interface AgentToolEvent {
  /** The agent invoked a tool (e.g. a curl search). Shown as a status chip. */
  type: "tool";
  name: string;
  /** Stable machine key for dedupe; separate from the human display summary. */
  key: string;
  summary: string;
  kind?: "search" | "detail" | "setup" | "other";
  duplicate?: boolean;
  count?: number;
}
export interface AgentDoneEvent {
  /** Turn finished. */
  type: "done";
  text: string;
  costUsd: number;
  contextTokens: number;
}
export interface AgentErrorEvent {
  type: "error";
  message: string;
}

export type AgentEvent =
  | AgentTurnEvent
  | AgentProgressEvent
  | AgentToolEvent
  | AgentDoneEvent
  | AgentErrorEvent;

/**
 * A document the user is viewing, passed from a detail page to ground the
 * chat. `excerpt` is a trimmed body/sections slice so the agent can answer
 * about THAT document without a re-fetch (it still can via the API).
 */
export interface ChatContext {
  kind: "judgment" | "statute";
  /** Citation (judgment) or act_id/reference (statute). */
  citation: string;
  /** Display title (judgment title or statute short_title). */
  title: string;
  /** In-app path back to the full document. */
  href: string;
  /** Trimmed document text — body excerpt (judgment) or joined sections (statute). */
  excerpt: string;
}

/** Compose the user-turn prompt, optionally grounded in an open document. */
/** A prior turn in the same conversation, for multi-turn context. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Compose the user-turn prompt, optionally grounded in an open document and
 * carrying earlier turns of the same conversation so follow-ups have context.
 */
export function composePrompt(
  question: string,
  ctx?: ChatContext,
  history?: ChatTurn[],
): string {
  const priorTurns = (history ?? []).filter((t) => t.text.trim().length > 0);
  const historyBlock =
    priorTurns.length > 0
      ? `# Conversation so far
These are earlier turns in THIS same conversation. Use them as context: when the
user says "it", "that", "this", "the case above", or asks a follow-up, they refer
to what was discussed below. Do not claim you lack the earlier conversation.

${priorTurns
  .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
  .join("\n\n")}

`
      : "";

  if (!ctx) {
    return historyBlock
      ? `${historyBlock}# Current question
${question}`
      : question;
  }
  const kindLabel = ctx.kind === "judgment" ? "Judgment" : "Statute";
  const encodedCitation = encodeURIComponent(ctx.citation);
  const fetchHint =
    ctx.kind === "judgment"
      ? `/v1/judgments/${encodedCitation}?include_body=true&body_length=8000`
      : `/v1/statutes/${encodedCitation}?include_body=true`;
  return `# Context — pinned source
The user is asking about this exact ${kindLabel.toLowerCase()}.
Pinned ${kindLabel}: ${ctx.title}
Canonical ID: ${ctx.citation}
Full document in the app: ${ctx.href}

When the question says "this case", "this judgment", "this statute", or similar,
answer about the pinned source above. Do not substitute another source with a
similar title, party name, issue, year, or citation.

If you need more text, fetch exactly:
${fetchHint}

After fetching, verify that the returned citation/reference matches:
${ctx.citation}

Only discuss other judgments/statutes if the user asks for comparison or broader
research, and clearly distinguish them from the pinned source.

# Excerpt
${ctx.excerpt}

${historyBlock}# Question
${question}`;
}

/**
 * Minimal env for the `graff` subprocess: only what it needs to find its
 * binary, stored keys, and temp dir — NOT the whole process env, so no
 * host secrets (DB URLs, other API keys) are exposed to the yolo-bash agent.
 */
function agentEnv(): NodeJS.ProcessEnv {
  const allow = new Set([
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "TZ",
    "LANG",
    "LC_ALL",
    "SHELL",
    "TERM",
  ]);
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && allow.has(k)) env[k] = v;
  }
  env.GRAFF_NO_TELEMETRY = "1";
  return env as NodeJS.ProcessEnv;
}

function agentProviderEnv(): Record<string, string> {
  const allow = [
    "ANTHROPIC_API_KEY",
    "CODEGRAFF_API_KEY",
    "DEEPSEEK_API_KEY",
    "OPENAI_API_KEY",
    "MINIMAX_API_KEY",
    "XIAOMI_API_KEY",
    "KIMI_API_KEY",
    "MOONSHOT_API_KEY",
    "XAI_API_KEY",
    "ZAI_API_KEY",
  ];
  const env: Record<string, string> = {};
  for (const key of allow) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

interface ToolSummary {
  key: string;
  summary: string;
  kind: "search" | "detail" | "setup" | "other";
}

/** Best-effort one-line summary of a tool call for the UI status line. */
function summarizeToolCall(name: string, input: unknown): ToolSummary {
  const inp =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (name === "bash") {
    const cmd = String(inp.command ?? "").trim();
    const urlRaw = cmd.match(/https?:\/\/[^\s"')]+/)?.[0];
    const url = parseUrlSafe(urlRaw);
    const q = extractSearchQuery(cmd, url);

    if (q) {
      const path = url?.pathname ?? "unknown-search";
      const endpoint = path.replace(BASE, "");
      return {
        key: `bash:${endpoint}?q=${q}`,
        summary: `search: ${decodeURIComponentSafe(q)} (${endpoint})`,
        kind: "search",
      };
    }

    if (url) {
      const path = `${url.pathname}${url.search}`.replace(BASE, "");
      return {
        key: `bash:${path}`,
        summary: url.pathname.replace(BASE, ""),
        kind: url.pathname.startsWith("/v1/") ? "detail" : "other",
      };
    }

    return {
      key: `bash:${cmd.slice(0, 160)}`,
      summary: cmd.slice(0, 80),
      kind: "other",
    };
  }
  if (name === "webfetch") {
    const url = String(inp.url ?? "");
    return { key: `webfetch:${url}`, summary: `fetch ${url}`, kind: "detail" };
  }
  if (name === "read_file") {
    const path = String(inp.path ?? "");
    return { key: `read_file:${path}`, summary: `read ${path}`, kind: "other" };
  }
  return { key: name, summary: name, kind: "other" };
}

function parseUrlSafe(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw.replace(/["')]+$/, ""));
  } catch {
    return null;
  }
}

function extractSearchQuery(cmd: string, url: URL | null): string | null {
  const fromUrl = url?.searchParams.get("q");
  if (fromUrl) return fromUrl;

  const dataUrlencode = cmd.match(/--data-urlencode\s+["']q=([^"']+)["']/);
  if (dataUrlencode) return dataUrlencode[1];

  const queryParam = cmd.match(/[?&]q=([^&"'\s]+)/);
  return queryParam?.[1] ?? null;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Run one agent turn, yielding normalized events. Spawns `graff --json`,
 * streams until the turn ends, then closes. Throws on a fatal error.
 */
export async function* askLegalAgent(
  question: string,
  signal?: AbortSignal,
  context?: ChatContext,
  history?: ChatTurn[],
): AsyncGenerator<AgentEvent> {
  // Isolated cwd so yolo bash can't touch the project tree.
  const cwd = mkdtempSync(join(tmpdir(), "lawplain-agent-"));
  try {
    const stream = runAgent({
      prompt: composePrompt(question, context, history),
      model: AGENT_MODEL,
      yolo: true,
      binary: AGENT_BINARY,
      cwd,
      systemPrompt: legalResearchPrompt(),
      // Minimal env: no host secrets reach the yolo-bash agent.
      env: agentEnv(),
    });

    let finalText = "";
    let costUsd = 0;
    let contextTokens = 0;

    for await (const ev of stream as AsyncGenerator<Event>) {
      if (signal?.aborted) break;
      switch (ev.type) {
        case "text":
          if (ev.text) yield { type: "delta", text: ev.text };
          break;
        case "tool_call": {
          const tool = summarizeToolCall(ev.name, ev.input);
          yield {
            type: "tool",
            name: ev.name,
            key: tool.key,
            summary: tool.summary,
            kind: tool.kind,
          };
          break;
        }
        case "turn":
          finalText = ev.text;
          costUsd = ev.cost_usd;
          contextTokens = ev.context_tokens;
          break;
        case "error":
          yield { type: "error", message: ev.message };
          return;
        default:
          break;
      }
    }

    if (signal?.aborted) return;
    yield {
      type: "done",
      text: finalText,
      costUsd,
      contextTokens,
    };
  } finally {
    // Clean up the isolated cwd so a long-running server doesn't leak dirs.
    rmSync(cwd, { recursive: true, force: true });
  }
}

// ─── sandboxed execution via CubeSandbox microVMs ───────────────────────

/**
 * Run one agent turn inside a disposable CubeSandbox microVM.
 *
 * Instead of spawning `graff` as a local subprocess (which gives the agent's
 * yolo-bash tool access to the host), this creates a firewalled firecracker
 * VM, downloads the graff binary into it, and runs `graff --json -p` inside.
 * The agent's bash tool can only reach the internet (to curl the sgjudge API)
 * — it cannot touch the host filesystem or other processes.
 *
 * Requires:
 *   CUBESANDBOX_GATEWAY_URL  — gateway base URL
 *   CUBESANDBOX_TENANT_KEY   — tenant API key
 *   CODEGRAFF_API_KEY / KIMI_API_KEY / etc — model provider key injected into the VM
 *
 * Yields the same AgentEvent stream as askLegalAgent, so the UI doesn't need
 * to know which backend is in use.
 */
export async function* askLegalAgentSandboxed(
  question: string,
  signal?: AbortSignal,
  context?: ChatContext,
  history?: ChatTurn[],
): AsyncGenerator<AgentEvent> {
  const gw = process.env.CUBESANDBOX_GATEWAY_URL;
  const tenantKey = process.env.CUBESANDBOX_TENANT_KEY;
  const providerEnv = agentProviderEnv();

  if (!gw || !tenantKey) {
    yield {
      type: "error",
      message:
        "CubeSandbox gateway not configured (CUBESANDBOX_GATEWAY_URL / CUBESANDBOX_TENANT_KEY)",
    };
    return;
  }
  if (Object.keys(providerEnv).length === 0) {
    yield {
      type: "error",
      message:
        "No graff provider key set (expected CODEGRAFF_API_KEY, KIMI_API_KEY, OPENAI_API_KEY, etc.)",
    };
    return;
  }

  let sid: string | null = null;
  const startedAt = Date.now();
  let lastHeartbeat = startedAt;
  try {
    // 1. Create microVM
    yield {
      type: "progress",
      phase: "sandbox_start",
      message: "Starting secure sandbox…",
      elapsedMs: Date.now() - startedAt,
    };
    sid = await createSandbox({ cpuCount: 2, memoryMB: 1024 });

    // 2. Download graff into the VM
    yield {
      type: "progress",
      phase: "agent_install",
      message: "Loading research runtime…",
      elapsedMs: Date.now() - startedAt,
    };
    await installGraff(sid);

    // 3. Run graff --json inside the VM, piping the prompt via stdin.
    //    envd doesn't support process stdin, so we use a bash pipe.
    //    All dynamic values are env vars to avoid shell-escaping issues.
    const prompt = composePrompt(question, context, history);
    const systemPrompt = legalResearchPrompt();
    const promptJson = JSON.stringify({ type: "user", text: prompt });

    const envs: Record<string, string> = {
      PROMPT_JSON: promptJson,
      SYSTEM_PROMPT: systemPrompt,
      GRAFF_BIN: GRAFF_BIN_PATH,
      MODEL: AGENT_MODEL,
      ...providerEnv,
      HOME: "/home/user",
      PATH: "/usr/bin:/bin:/usr/local/bin",
      GRAFF_NO_TELEMETRY: "1",
    };

    let finalText = "";
    let streamedText = "";
    let costUsd = 0;
    let contextTokens = 0;
    let lineBuf = "";
    let stderr = "";
    let sawTurn = false;
    let sawText = false;
    let announcedAnswering = false;
    let exitCode: number | undefined;
    const seenTools = new Map<string, number>();
    // Bare non-JSON lines graff writes to stdout (e.g. "api error: ...").
    let rawNonJson = "";

    yield {
      type: "progress",
      phase: "agent_start",
      message: "Starting research agent…",
      elapsedMs: Date.now() - startedAt,
    };

    const start = await runProcess(sid, {
      cmd: "/bin/bash",
      args: [
        "-c",
        `rm -f /tmp/graff.out /tmp/graff.err /tmp/graff.exit /tmp/graff.launch; nohup /bin/bash -lc 'printf %s "$PROMPT_JSON" | "$GRAFF_BIN" --json --yolo --no-telemetry --model "$MODEL" --system-prompt "$SYSTEM_PROMPT" > /tmp/graff.out 2> /tmp/graff.err; echo $? > /tmp/graff.exit' > /tmp/graff.launch 2>&1 < /dev/null & echo $!`,
      ],
      cwd: "/tmp",
      envs,
      timeoutMs: 10_000,
    });
    if (start.exitCode && start.exitCode !== 0) {
      throw new Error(`failed to start graff: ${start.stderr || start.stdout}`);
    }

    yield {
      type: "progress",
      phase: "thinking",
      message: "Planning searches…",
      elapsedMs: Date.now() - startedAt,
    };

    let offset = 0;
    const deadline = Date.now() + 300_000;
    while (!signal?.aborted && Date.now() < deadline) {
      const out = (await readSandboxFile(sid, "/tmp/graff.out")) ?? "";
      if (out.length > offset) {
        lineBuf += out.slice(offset);
        offset = out.length;

        let nl = lineBuf.indexOf("\n");
        while (nl >= 0) {
          const line = lineBuf.slice(0, nl).trim();
          lineBuf = lineBuf.slice(nl + 1);
          if (!line) {
            nl = lineBuf.indexOf("\n");
            continue;
          }

          let ev: Event;
          try {
            ev = JSON.parse(line) as Event;
          } catch {
            // graff prints bare (non-JSON) error lines to stdout before its
            // JSON error event — keep them so failures aren't silent.
            if (rawNonJson.length < 2000) {
              rawNonJson += (rawNonJson ? "\n" : "") + line;
            }
            nl = lineBuf.indexOf("\n");
            continue;
          }

          switch (ev.type) {
            case "text":
              if (ev.text) {
                if (!announcedAnswering) {
                  announcedAnswering = true;
                  yield {
                    type: "progress",
                    phase: "answering",
                    message: "Writing answer…",
                    elapsedMs: Date.now() - startedAt,
                  };
                }
                sawText = true;
                streamedText += ev.text;
                yield { type: "delta", text: ev.text };
              }
              break;
            case "tool_call": {
              const tool = summarizeToolCall(ev.name, ev.input);
              const count = (seenTools.get(tool.key) ?? 0) + 1;
              seenTools.set(tool.key, count);
              yield {
                type: "progress",
                phase: tool.kind === "search" ? "searching" : "reading",
                message:
                  tool.kind === "search"
                    ? `Searching ${tool.summary.slice(8)}…`
                    : `Reading source ${tool.summary}…`,
                elapsedMs: Date.now() - startedAt,
              };
              yield {
                type: "tool",
                name: ev.name,
                key: tool.key,
                summary: tool.summary,
                kind: tool.kind,
                duplicate: count > 1,
                count,
              };
              break;
            }
            case "turn":
              sawTurn = true;
              finalText = ev.text;
              costUsd = ev.cost_usd;
              contextTokens = ev.context_tokens;
              break;
            case "error":
              yield { type: "error", message: ev.message };
              return;
            default:
              break;
          }
          nl = lineBuf.indexOf("\n");
        }
      }

      const exitText = await readSandboxFile(sid, "/tmp/graff.exit");
      if (exitText !== null) {
        exitCode = Number.parseInt(exitText.trim(), 10);
        stderr = (await readSandboxFile(sid, "/tmp/graff.err")) ?? "";
        break;
      }
      if (Date.now() - lastHeartbeat > 8000) {
        lastHeartbeat = Date.now();
        yield {
          type: "progress",
          phase: sawText ? "answering" : "thinking",
          message: sawText ? "Still writing answer…" : "Still researching…",
          elapsedMs: Date.now() - startedAt,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    if (!signal?.aborted && Date.now() >= deadline) {
      yield { type: "error", message: "sandboxed graff timed out" };
      return;
    }

    if (signal?.aborted) return;
    const sboxId = sid;
    // graff writes auth/model errors to STDOUT (graff.out) with exit 0 and an
    // empty stderr, so fall back through stdout for a non-blank message.
    const failureDiag = async () =>
      (
        rawNonJson.trim() ||
        stderr.trim() ||
        ((await readSandboxFile(sboxId, "/tmp/graff.out")) ?? "").trim()
      ).slice(0, 800);

    if (exitCode && exitCode !== 0) {
      const diag = await failureDiag();
      yield {
        type: "error",
        message: diag
          ? `sandboxed graff exited with ${exitCode}: ${diag}`
          : `sandboxed graff exited with ${exitCode}`,
      };
      return;
    }
    if (!sawTurn && streamedText) {
      finalText = streamedText;
    } else if (!sawTurn) {
      const diag = await failureDiag();
      yield {
        type: "error",
        message: diag
          ? `sandboxed graff ended before producing an answer: ${diag}`
          : "sandboxed graff ended before producing an answer (no output)",
      };
      return;
    }
    yield { type: "done", text: finalText, costUsd, contextTokens };
  } catch (err) {
    yield {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Always clean up the microVM — never leak sandboxes.
    if (sid) await deleteSandbox(sid);
  }
}
