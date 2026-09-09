import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  setApiKeyMcp,
} from "@/lib/api-keys";
import { getSession } from "@/lib/auth";
import { privateJson, privateRoute } from "@/lib/private-response";
import { sameOriginMutation } from "@/server/mcp-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  return privateJson({ keys: await listApiKeys(session.user.id) });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name : "API key";
  const result = await createApiKey(session.user.id, name);
  if ("error" in result)
    return Response.json({ error: result.error }, { status: 400 });
  // The raw key is returned exactly once — it is never stored in plaintext.
  return privateJson(result, { status: 201 });
}

export async function PATCH(req: Request): Promise<Response> {
  return privateRoute(async () => {
    const session = await getSession(req.headers);
    if (!session)
      return privateJson({ error: "Authentication required" }, { status: 401 });
    if (!sameOriginMutation(req))
      return privateJson({ error: "Invalid origin" }, { status: 403 });
    const body = (await req.json().catch(() => null)) as {
      id?: unknown;
      mcpEnabled?: unknown;
    } | null;
    if (
      !body ||
      typeof body.id !== "string" ||
      body.id.length > 100 ||
      typeof body.mcpEnabled !== "boolean"
    )
      return privateJson({ error: "Invalid key settings" }, { status: 400 });
    if (!(await setApiKeyMcp(session.user.id, body.id, body.mcpEnabled)))
      return privateJson({ error: "Key not found" }, { status: 404 });
    return privateJson({ ok: true });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  await revokeApiKey(session.user.id, id);
  return Response.json({ ok: true });
}
