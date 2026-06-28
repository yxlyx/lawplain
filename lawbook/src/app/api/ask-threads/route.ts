import {
  deleteThread,
  getThread,
  listThreads,
  saveThread,
} from "@/lib/ask-threads";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const thread = await getThread(session.user.id, id);
    if (!thread) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ thread });
  }
  return Response.json({ threads: await listThreads(session.user.id) });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const id = clean(body.id, 100);
  if (!id)
    return Response.json({ error: "Missing thread id" }, { status: 400 });
  const messages = Array.isArray(body.messages)
    ? body.messages.slice(0, 200)
    : [];
  if (messages.length === 0)
    return Response.json({ error: "No messages" }, { status: 400 });

  const title = clean(body.title, 200) || "Untitled";
  const cite = clean(body.cite, 300) || undefined;
  const kind = clean(body.kind, 40) || undefined;
  const rawHref = clean(body.sourceHref, 800);
  const sourceHref = rawHref.startsWith("/") ? rawHref : undefined;
  const runId = clean(body.runId, 100) || undefined;
  // Only 'running' is meaningful from the client; everything else settles to done.
  const status = body.status === "running" ? "running" : "done";

  // Ownership is always the session user — never a client-supplied id.
  const saved = await saveThread({
    userId: session.user.id,
    id,
    title,
    messages,
    cite,
    kind,
    sourceHref,
    runId,
    status,
  });
  return Response.json({ saved }, { status: 200 });
}

export async function DELETE(req: Request): Promise<Response> {
  const session = await getSession(req.headers);
  if (!session)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  await deleteThread(session.user.id, id);
  return Response.json({ ok: true });
}
