import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESPONSE_INIT = {
  headers: {
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  },
} as const;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { ...RESPONSE_INIT, status });
}

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) return json({ error: "Authentication required" }, 401);

  try {
    return json({ keys: await listApiKeys(session.user.id) });
  } catch {
    return json({ error: "API keys are temporarily unavailable" }, 503);
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) return json({ error: "Authentication required" }, 401);

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
  } | null;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    (body.name !== undefined && typeof body.name !== "string")
  ) {
    return json({ error: "A valid JSON body and key name are required" }, 400);
  }

  try {
    const result = await createApiKey(session.user.id, body.name ?? "API key");
    if ("error" in result) return json({ error: result.error }, 409);
    // The raw key is returned exactly once — it is never stored in plaintext.
    return json(result, 201);
  } catch {
    return json({ error: "Could not create the API key" }, 503);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session) return json({ error: "Authentication required" }, 401);

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return json({ error: "Missing id" }, 400);

  try {
    const revoked = await revokeApiKey(session.user.id, id);
    if (!revoked) return json({ error: "API key not found" }, 404);
    return json({ ok: true });
  } catch {
    return json({ error: "Could not revoke the API key" }, 503);
  }
}
