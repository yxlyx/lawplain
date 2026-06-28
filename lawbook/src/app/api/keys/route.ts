import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ keys: await listApiKeys(session.user.id) });
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
  return Response.json(result, { status: 201 });
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
