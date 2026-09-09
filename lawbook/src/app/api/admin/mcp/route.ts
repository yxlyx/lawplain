import { z } from "zod";
import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isMcpAdmin, mcpStore, sameOriginMutation } from "@/server/mcp-auth";

export const dynamic = "force-dynamic";

const change = z.discriminatedUnion("action", [
  z.object({ action: z.literal("service"), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("access"),
      userId: z.string().min(1).max(100),
      status: z.enum(["pending", "approved", "suspended"]),
      canSearch: z.boolean(),
      canRead: z.boolean(),
      requestsPerMinute: z.number().int().min(1).max(600),
    })
    .strict(),
]);

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    if (!(await isMcpAdmin(session.user.id)))
      return privateJson({ error: "Not found" }, { status: 404 });
    const url = new URL(req.url);
    const offset = Math.max(
      0,
      Math.min(100_000, Number(url.searchParams.get("offset")) || 0),
    );
    const userId = url.searchParams.get("userId") || undefined;
    const rating = url.searchParams.get("rating");
    if (rating && rating !== "helpful" && rating !== "not_helpful")
      return privateJson({ error: "Invalid rating" }, { status: 400 });
    if (userId && userId.length > 100)
      return privateJson({ error: "Invalid user" }, { status: 400 });
    const store = await mcpStore();
    const [page, enabled, activity, summary, audit] = await Promise.all([
      store.users(Math.floor(offset)),
      store.enabled(),
      store.activity(
        userId,
        rating === "helpful" || rating === "not_helpful" ? rating : undefined,
      ),
      store.summary(userId),
      store.audit(),
    ]);
    return privateJson({ ...page, enabled, activity, summary, audit });
  });
}

export async function PATCH(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    if (!(await isMcpAdmin(session.user.id)))
      return privateJson({ error: "Not found" }, { status: 404 });
    if (!sameOriginMutation(req))
      return privateJson({ error: "Invalid origin" }, { status: 403 });
    const parsed = change.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return privateJson({ error: "Invalid MCP settings" }, { status: 400 });
    const store = await mcpStore();
    if (parsed.data.action === "service")
      await store.setEnabled(session.user.id, parsed.data.enabled);
    else {
      const { userId, action: _action, ...settings } = parsed.data;
      if (!(await store.setAccess(session.user.id, userId, settings)))
        return privateJson(
          { error: "Access request not found" },
          { status: 404 },
        );
    }
    return privateJson({ ok: true });
  });
}
