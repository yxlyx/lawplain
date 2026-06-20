/**
 * POST /api/ask  — streams an agent turn as Server-Sent Events.
 *
 * Body: { "question": string, "cite"?: string, "kind"?: "judgment"|"statute" }
 * Response: text/event-stream of `data: {json}\n\n` lines, each an AgentEvent:
 *   {type:"delta",text} | {type:"tool",name,summary} | {type:"done",...} | {type:"error",message}
 *
 * Runs the `graff` binary (Node runtime only — it spawns a subprocess).
 *
 * Security: the client may NOT supply document text directly (that would let a
 * caller inject arbitrary prompt content into a yolo-bash agent). Context is
 * re-resolved server-side from `cite`+`kind` via the sgjudge API, so only real
 * corpus documents can ground the turn.
 */
import {
  type AgentEvent,
  askLegalAgent,
  askLegalAgentSandboxed,
  type ChatContext,
} from "@/lib/agent";
import { loadChatContext } from "@/lib/ask-context";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Agent turns can take a while (multiple LLM round trips + curl).
export const maxDuration = 300;

/** Use CubeSandbox when configured; fall back to local graff subprocess. */
const useSandbox = !!(
  process.env.CUBESANDBOX_GATEWAY_URL && process.env.CUBESANDBOX_TENANT_KEY
);

function sse(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
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
  try {
    const body = (await req.json()) as {
      question?: unknown;
      cite?: unknown;
      kind?: unknown;
    };
    question = typeof body.question === "string" ? body.question.trim() : "";
    cite = typeof body.cite === "string" ? body.cite : undefined;
    kind = typeof body.kind === "string" ? body.kind : undefined;
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
        const startedAt = Date.now();
        safeEnqueue({
          type: "progress",
          phase: "context",
          message:
            cite && (kind === "judgment" || kind === "statute")
              ? "Loading pinned document…"
              : "Starting research agent…",
          elapsedMs: 0,
        });

        // Re-resolve context server-side — never trust client-supplied document text.
        let context: ChatContext | undefined;
        if (cite && (kind === "judgment" || kind === "statute")) {
          const params = new URLSearchParams({ cite, kind });
          context = (await loadChatContext(params)) ?? undefined;
          safeEnqueue({
            type: "progress",
            phase: "context",
            message: context
              ? "Pinned document loaded."
              : "Pinned document unavailable; continuing without it.",
            elapsedMs: Date.now() - startedAt,
          });
        }

        const agent = useSandbox ? askLegalAgentSandboxed : askLegalAgent;
        for await (const ev of agent(question, req.signal, context)) {
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

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    },
  });
}
