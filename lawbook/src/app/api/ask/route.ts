/**
 * POST /api/ask — streams an agent turn as Server-Sent Events.
 *
 * Body: { question, cite?, kind?, history?, runId?, from? }
 * Response: text/event-stream of `data: {json}\n\n` lines, each an AgentEvent.
 *
 * When a `runId` is supplied and CubeSandbox is configured, the run is hosted in
 * the AskRunDO Durable Object: the route composes the prompt server-side, starts
 * the DO (idempotent), and proxies the DO's replay+live stream — so the run
 * survives the client navigating away, and reconnecting with the same runId
 * (and a `from` index) resumes it. Without a runId it falls back to the
 * request-scoped generator.
 *
 * Security: the client may NOT supply document text directly. Context is
 * re-resolved server-side from `cite`+`kind` via the sgjudge API.
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  AGENT_MODEL,
  type AgentEvent,
  askLegalAgent,
  askLegalAgentSandboxed,
  type ChatContext,
  type ChatTurn,
  composePrompt,
  legalResearchPrompt,
  researchToolCallBudget,
} from "@/lib/agent";
import { loadChatContext } from "@/lib/ask-context";
import { recordAskQuestion } from "@/lib/ask-history";
import { saveThread } from "@/lib/ask-threads";
import { getSession } from "@/lib/auth";
import {
  hasMemoryAskRun,
  startMemoryAskRun,
  streamMemoryAskRun,
} from "@/server/ask-run-memory";
import {
  askAgentEnabled,
  safeAgentError,
  userRunName,
} from "@/server/ask-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-content-type-options": "nosniff",
} as const;

function sse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function errorStream(message: string): Response {
  return new Response(sse({ type: "error", message }), {
    headers: SSE_HEADERS,
  });
}

export async function POST(req: Request): Promise<Response> {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession(req.headers);
  } catch (err) {
    console.error("Ask auth check failed", err);
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  let runtimeEnv: Record<string, unknown> = { ...process.env };
  let askRuns: DurableObjectNamespace | undefined;
  try {
    const { env } = await getCloudflareContext({ async: true });
    runtimeEnv = { ...runtimeEnv, ...(env as Record<string, unknown>) };
    askRuns = (env as { ASK_RUN_DO?: DurableObjectNamespace }).ASK_RUN_DO;
  } catch {
    // next dev/start has no Cloudflare context and intentionally uses process.env.
  }
  if (!askAgentEnabled(runtimeEnv))
    return errorStream("Ask is not currently available.");
  const production = runtimeEnv.NODE_ENV === "production";
  const useSandbox = !!(
    runtimeEnv.CUBESANDBOX_GATEWAY_URL && runtimeEnv.CUBESANDBOX_TENANT_KEY
  );

  let question = "";
  let cite: string | undefined;
  let kind: string | undefined;
  let history: ChatTurn[] | undefined;
  let runId: string | undefined;
  let threadId: string | undefined;
  let threadTitle: string | undefined;
  let sourceHref: string | undefined;
  let initialMessages: unknown[] | undefined;
  let from = 0;
  try {
    const body = (await req.json()) as {
      question?: unknown;
      cite?: unknown;
      kind?: unknown;
      history?: unknown;
      runId?: unknown;
      threadId?: unknown;
      title?: unknown;
      sourceHref?: unknown;
      initialMessages?: unknown;
      from?: unknown;
    };
    question = typeof body.question === "string" ? body.question.trim() : "";
    cite = typeof body.cite === "string" ? body.cite : undefined;
    kind = typeof body.kind === "string" ? body.kind : undefined;
    runId =
      typeof body.runId === "string" && body.runId ? body.runId : undefined;
    threadId =
      typeof body.threadId === "string" && body.threadId.trim()
        ? body.threadId.trim().slice(0, 100)
        : undefined;
    threadTitle =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 200)
        : undefined;
    sourceHref =
      typeof body.sourceHref === "string" && body.sourceHref.startsWith("/")
        ? body.sourceHref.slice(0, 800)
        : undefined;
    initialMessages = Array.isArray(body.initialMessages)
      ? body.initialMessages.slice(-200)
      : undefined;
    from = typeof body.from === "number" && body.from > 0 ? body.from : 0;
    history = Array.isArray(body.history)
      ? body.history
          .filter(
            (t): t is { role: unknown; text: string } =>
              !!t &&
              typeof t === "object" &&
              typeof (t as { text?: unknown }).text === "string",
          )
          .slice(-12)
          .map<ChatTurn>((t) => ({
            role: t.role === "user" ? "user" : "assistant",
            text: String(t.text).slice(0, 6000),
          }))
      : undefined;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  if (!question) {
    return new Response(JSON.stringify({ error: "Missing 'question' field" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Record question history only on a fresh run (not on a reconnect).
  if (from === 0) {
    try {
      await recordAskQuestion({
        userId: session.user.id,
        question,
        cite,
        kind,
      });
    } catch (err) {
      console.warn("Failed to record Ask question history", err);
    }
  }

  // Re-resolve context server-side — never trust client-supplied document text.
  let context: ChatContext | undefined;
  if (cite && (kind === "judgment" || kind === "statute")) {
    context =
      (await loadChatContext(new URLSearchParams({ cite, kind }))) ?? undefined;
    if (!context) {
      return errorStream(`Pinned ${kind} could not be loaded: ${cite}`);
    }
  }

  // Persist a running thread from the same request that starts the research.
  // The client also autosaves, but those best-effort requests can be cancelled
  // when users quickly switch to Saved/Recents or start several chats.
  if (from === 0 && runId && threadId && initialMessages?.length) {
    try {
      await saveThread({
        userId: session.user.id,
        id: threadId,
        title: threadTitle || question,
        messages: initialMessages,
        cite,
        kind,
        sourceHref,
        runId,
        status: "running",
      });
    } catch (err) {
      console.warn("Failed to persist Ask thread at run start", err);
    }
  }

  if (production && (!useSandbox || !askRuns || !runId)) {
    console.error("Production Ask requires CubeSandbox, ASK_RUN_DO, and runId");
    return errorStream(safeAgentError());
  }

  // DO mode — host the run in AskRunDO so it survives navigation.
  if (useSandbox && askRuns && runId) {
    try {
      const stub = askRuns.get(
        askRuns.idFromName(userRunName(session.user.id, runId)),
      );
      const prompt = composePrompt(question, context, history);
      const toolCallBudget = researchToolCallBudget(question, context, history);
      const ownerHeaders = {
        "content-type": "application/json",
        "x-lawplain-user-id": session.user.id,
      };
      const started = await stub.fetch("https://ask-run-do/start", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          runId,
          prompt,
          systemPrompt: legalResearchPrompt(),
          toolCallBudget,
          model: AGENT_MODEL,
          userId: session.user.id,
          threadId,
          title: threadTitle,
          question,
          cite,
          kind,
          sourceHref,
        }),
      });
      if (!started.ok) {
        console.error("Ask durable start rejected", started.status);
        return errorStream(safeAgentError());
      }
      return stub.fetch(`https://ask-run-do/stream?from=${from}`, {
        headers: { "x-lawplain-user-id": session.user.id },
      });
    } catch (err) {
      console.error("Ask durable run failed", err);
      return errorStream(safeAgentError());
    }
  }

  // Node/local fallback with runId — host the run in this server process so
  // client disconnect/navigation only detaches the SSE reader. This is not as
  // durable as the Cloudflare DO path (it won't survive process restarts or
  // multi-instance routing), but it fixes background runs for next dev/start.
  if (runId) {
    if (from > 0 && !hasMemoryAskRun(session.user.id, runId)) {
      return errorStream(
        "This research run is no longer available on the server; please start it again.",
      );
    }

    startMemoryAskRun({
      userId: session.user.id,
      runId,
      question,
      threadId,
      context,
      history,
      kind,
      useSandbox,
    });
    const response = streamMemoryAskRun(session.user.id, runId, from);
    if (response) return response;
  }

  // Last-resort fallback — request-scoped generator (no runId to reconnect).
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(sse(e)));
        } catch {
          /* controller already closed */
        }
      };
      try {
        if (context) {
          safeEnqueue({
            type: "progress",
            phase: "context",
            message: `Using pinned ${kind} ${context.citation}.`,
            elapsedMs: 0,
          });
        }
        const agent = useSandbox ? askLegalAgentSandboxed : askLegalAgent;
        for await (const ev of agent(question, req.signal, context, history)) {
          safeEnqueue(ev);
          if (ev.type === "error") break;
        }
      } catch (err) {
        safeEnqueue({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
