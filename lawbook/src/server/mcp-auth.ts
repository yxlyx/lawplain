import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getAuthDb } from "@/lib/d1";
import { McpStore } from "./mcp-store";

/** Admins are immutable account IDs configured on the server, never user roles or email input. */
export async function isMcpAdmin(userId: string): Promise<boolean> {
  const { env } = await getCloudflareContext({ async: true });
  const ids =
    (env as { LAWPLAIN_ADMIN_USER_IDS?: string }).LAWPLAIN_ADMIN_USER_IDS ?? "";
  return ids
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(userId);
}

export function sameOriginMutation(req: Request): boolean {
  return req.headers.get("origin") === new URL(req.url).origin;
}

export async function mcpStore(): Promise<McpStore> {
  return new McpStore(await getAuthDb());
}
