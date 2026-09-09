import { MCP_GUIDE } from "@/lib/mcp-guide";

export function GET() {
  return new Response(MCP_GUIDE, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
