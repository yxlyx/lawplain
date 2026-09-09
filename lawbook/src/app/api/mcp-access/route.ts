import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isMcpAdmin, mcpStore, sameOriginMutation } from "@/server/mcp-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const store = await mcpStore();
    const [access, enabled, activity, summary, isAdmin] = await Promise.all([
      store.access(session.user.id),
      store.enabled(),
      store.activity(session.user.id),
      store.summary(session.user.id),
      isMcpAdmin(session.user.id),
    ]);
    return privateJson({ access, enabled, activity, summary, isAdmin });
  });
}

export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    if (!sameOriginMutation(req))
      return privateJson({ error: "Invalid origin" }, { status: 403 });
    await (await mcpStore()).requestAccess(session.user.id);
    return privateJson({ ok: true });
  });
}
