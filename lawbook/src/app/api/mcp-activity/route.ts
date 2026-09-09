import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import { isMcpAdmin, mcpStore, sameOriginMutation } from "@/server/mcp-auth";
import { mcpFeedbackSchema } from "@/server/mcp-feedback";
import { readBoundedText } from "@/server/mcp-tools";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    const id = new URL(req.url).searchParams.get("id");
    if (!id || !/^[\da-f-]{36}$/i.test(id))
      return privateJson({ error: "Invalid request ID" }, { status: 400 });
    const admin = await isMcpAdmin(session.user.id);
    const research = await (await mcpStore()).research(
      id,
      admin ? undefined : session.user.id,
    );
    return research
      ? privateJson({ research })
      : privateJson({ error: "Research request not found" }, { status: 404 });
  });
}

export async function POST(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    if (!sameOriginMutation(req))
      return privateJson({ error: "Invalid origin" }, { status: 403 });
    const body = await readBoundedText(new Response(req.body), 64000)
      .then(JSON.parse)
      .catch(() => null);
    const parsed = mcpFeedbackSchema.safeParse(body);
    if (!parsed.success)
      return privateJson({ error: "Invalid feedback" }, { status: 400 });
    const saved = await (await mcpStore()).feedback(
      session.user.id,
      parsed.data,
    );
    return saved
      ? privateJson({ ok: true })
      : privateJson({ error: "Research request not found" }, { status: 404 });
  });
}
