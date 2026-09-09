import { createMcpHandler } from "@modelcontextprotocol/server";
import type { McpIdentity, McpStore } from "./mcp-store";
import {
  createLawplainMcpServer,
  MCP_TOOL_GROUPS,
  readBoundedText,
} from "./mcp-tools";

interface Dependencies {
  authenticate: (key: string) => Promise<McpIdentity | null>;
  store: McpStore;
  fetcher?: typeof fetch;
}

function response(
  body: unknown,
  status: number,
  extra: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...extra },
  });
}

function operation(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "invalid_request";
  const message = body as { method?: unknown; params?: { name?: unknown } };
  if (message.method === "tools/call") {
    const name = message.params?.name;
    return typeof name === "string" && Object.hasOwn(MCP_TOOL_GROUPS, name)
      ? name
      : "unknown_tool";
  }
  return typeof message.method === "string" &&
    [
      "initialize",
      "notifications/initialized",
      "tools/list",
      "ping",
      "server/discover",
    ].includes(message.method)
    ? message.method
    : "unknown_method";
}

export async function handleLawplainMcp(
  req: Request,
  deps: Dependencies,
): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    return response({ error: "Origin not allowed" }, 403);
  if (req.method !== "POST")
    return response(
      { error: "Use Streamable HTTP POST at this endpoint." },
      405,
      { allow: "POST" },
    );
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer (lp_live_[a-f0-9]{48})$/i.exec(auth)?.[1];
  if (!key)
    return response(
      {
        error:
          "A Lawplain Bearer API key is required. Create one at /developers.",
      },
      401,
      { "www-authenticate": 'Bearer realm="Lawplain MCP"' },
    );

  try {
    const identity = await deps.authenticate(key);
    if (!identity)
      return response({ error: "Invalid or revoked API key" }, 401, {
        "www-authenticate": 'Bearer realm="Lawplain MCP"',
      });
    const policy = await deps.store.policy(identity);
    if (!policy.allowed) {
      await deps.store.record(identity, "access", "blocked");
      return response({ error: policy.reason }, 403);
    }
    if (
      !(await deps.store.consume(
        identity.userId,
        policy.access.requestsPerMinute,
      ))
    ) {
      await deps.store.record(identity, "access", "rate_limited");
      return response(
        { error: "Account request limit reached. Retry next minute." },
        429,
        { "retry-after": String(60 - (Math.floor(Date.now() / 1000) % 60)) },
      );
    }
    if (
      !(req.headers.get("content-type") ?? "")
        .toLowerCase()
        .startsWith("application/json")
    ) {
      await deps.store.record(identity, "invalid_request", "invalid_request");
      return response({ error: "Content-Type must be application/json" }, 415);
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBoundedText(new Response(req.body), 32_768));
    } catch {
      await deps.store.record(identity, "invalid_request", "invalid_request");
      return response(
        { error: "Expected one JSON-RPC message, at most 32 KB" },
        400,
      );
    }
    // Legacy SDK transports accept JSON-RPC batches. Disallow them here so a
    // single metered HTTP request cannot execute many tools or bypass quotas.
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      await deps.store.record(identity, "invalid_request", "invalid_request");
      return response({ error: "Send one JSON-RPC message per request" }, 400);
    }
    const op = operation(body);
    const startedAt = Date.now();
    const activityId = await deps.store.record(identity, op, "started");
    const handler = createMcpHandler(
      () =>
        createLawplainMcpServer(policy.access, deps.fetcher, (input) =>
          deps.store.feedback(identity.userId, input),
        ),
      { maxSubscriptions: 0, onerror: () => {} },
    );
    try {
      const result = await handler.fetch(req, { parsedBody: body });
      // The legacy SDK emits SSE. These bounded read-only tools finish in one
      // response; consume it to persist the final audit outcome before delivery.
      let text = await readBoundedText(result, 4_000_000);
      const messages = result.headers
        .get("content-type")
        ?.includes("text/event-stream")
        ? text
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => JSON.parse(line.slice(6)))
        : text
          ? [JSON.parse(text)]
          : [];
      const outcome =
        result.status >= 400 || messages.some((message) => message.error)
          ? "invalid_request"
          : messages.some((message) => message.result?.isError)
            ? "tool_error"
            : "success";
      if (
        (MCP_TOOL_GROUPS[op] === "search" || MCP_TOOL_GROUPS[op] === "read") &&
        outcome !== "invalid_request"
      ) {
        const params = (
          body as { params?: { arguments?: Record<string, unknown> } }
        ).params;
        // Capture only known corpus inputs; never headers or arbitrary JSON-RPC fields.
        const names = [
          "query",
          "court",
          "year_range",
          "limit",
          "citation",
          "offset",
          "length",
          "reference",
          "act_id",
          "section",
          "kind",
          "id",
        ];
        const args = Object.fromEntries(
          Object.entries(params?.arguments ?? {}).filter(([name]) =>
            names.includes(name),
          ),
        );
        await deps.store.capture(
          activityId,
          args,
          messages.map((message) => message.result),
        );
        for (const message of messages) {
          if (message.result?.content) {
            message.result._meta = {
              ...message.result._meta,
              "lawplain/activityId": activityId,
            };
            message.result.content.push({
              type: "text",
              text: `Lawplain request ID: ${activityId}. You can review this reply and leave feedback at https://lawplain.com/developers or use submit_feedback.`,
            });
          }
        }
        if (result.headers.get("content-type")?.includes("text/event-stream")) {
          let index = 0;
          text = text
            .split("\n")
            .map((line) =>
              line.startsWith("data: ")
                ? `data: ${JSON.stringify(messages[index++])}`
                : line,
            )
            .join("\n");
        } else if (messages.length) text = JSON.stringify(messages[0]);
      }
      await deps.store.finish(
        activityId,
        outcome,
        Date.now() - startedAt,
        new TextEncoder().encode(text).byteLength,
      );
      const headers = new Headers(result.headers);
      headers.set("cache-control", "private, no-store");
      headers.delete("content-length");
      headers.set("x-lawplain-activity-id", activityId);
      return new Response(
        result.status === 202 || result.status === 204 ? null : text,
        { status: result.status, headers },
      );
    } catch {
      await deps.store.finish(activityId, "error", Date.now() - startedAt, 0);
      return response({ error: "MCP request could not be completed" }, 503);
    } finally {
      await handler.close();
    }
  } catch {
    return response({ error: "MCP is temporarily unavailable" }, 503);
  }
}
