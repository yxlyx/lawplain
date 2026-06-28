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
} from "@/lib/agent";
import { loadChatContext } from "@/lib/ask-context";
import { recordAskQuestion } from "@/lib/ask-history";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Use CubeSandbox when configured; fall back to local graff subprocess. */
const useSandbox = !!(
  process.env.CUBESANDBOX_GATEWAY_URL && process.env.CUBESANDBOX_TENANT_KEY
);

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
  const session = await getSession(req.headers);
  if (!session) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let question = "";
  let cite: string | undefined;
  let kind: string | undefined;
  let history: ChatTurn[] | undefined;
  let runId: string | undefined;
  let from = 0;
  try {
    const body = (await req.json()) as {
      question?: unknown;
      cite?: unknown;
      kind?: unknown;
      history?: unknown;
      runId?: unknown;
      from?: unknown;
    };
    question = typeof body.question === "string" ? body.question.trim() : "";
    cite = typeof body.cite === "string" ? body.cite : undefined;
    kind = typeof body.kind === "string" ? body.kind : undefined;
    runId =
      typeof body.runId === "string" && body.runId ? body.runId : undefined;
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

  // DO mode — host the run in AskRunDO so it survives navigation.
  if (useSandbox && runId) {
    try {
      const { env } = await getCloudflareContext({ async: true });
      const ns = (env as { ASK_RUN_DO?: DurableObjectNamespace }).ASK_RUN_DO;
      if (ns) {
        const stub = ns.get(ns.idFromName(runId));
        const prompt = composePrompt(question, context, history);
        await stub.fetch("https://ask-run-do/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt,
            systemPrompt: legalResearchPrompt(),
            model: AGENT_MODEL,
          }),
        });
        return stub.fetch(`https://ask-run-do/stream?from=${from}`);
      }
    } catch (err) {
      return errorStream(err instanceof Error ? err.message : String(err));
    }
  }

  // Fallback — request-scoped generator (no Durable Object).
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
