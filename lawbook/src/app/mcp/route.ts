import { validateApiKey } from "@/lib/api-keys";
import { mcpStore } from "@/server/mcp-auth";
import { handleLawplainMcp } from "@/server/mcp-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  try {
    return await handleLawplainMcp(req, {
      authenticate: validateApiKey,
      store: await mcpStore(),
    });
  } catch {
    return Response.json(
      { error: "MCP is temporarily unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export function GET(): Response {
  return Response.json(
    { error: "Use Streamable HTTP POST at /mcp" },
    { status: 405, headers: { allow: "POST", "cache-control": "no-store" } },
  );
}

export const DELETE = GET;
