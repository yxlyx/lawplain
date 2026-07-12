import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  deleteThread,
  getThread,
  listThreads,
  markThreadSeen,
  saveThread,
  type ThreadSummary,
  updateThreadRunStatus,
} from "@/lib/ask-threads";
import { getSession } from "@/lib/auth";
import { getMemoryAskRunStatus } from "@/server/ask-run-memory";
import { userRunName } from "@/server/ask-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const useSandbox = !!(
  process.env.CUBESANDBOX_GATEWAY_URL && process.env.CUBESANDBOX_TENANT_KEY
);

type RunStatus = "running" | "done" | "error" | "stopped";

async function getDurableRunStatus(
  runId: string,
  userId: string,
): Promise<RunStatus | null> {
  if (!useSandbox) return null;
  try {
    const { env } = await getCloudflareContext({ async: true });
    const ns = (env as { ASK_RUN_DO?: DurableObjectNamespace }).ASK_RUN_DO;
    if (!ns) return null;
    const stub = ns.get(ns.idFromName(userRunName(userId, runId)));
    const res = await stub.fetch("https://ask-run-do/status", {
      headers: { "x-lawplain-user-id": userId },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: unknown };
    return data.status === "running" ||
      data.status === "done" ||
      data.status === "error" ||
      data.status === "stopped"
      ? data.status
      : null;
  } catch {
    return null;
  }
}

async function reconcileRunningThreads(
  userId: string,
  threads: ThreadSummary[],
): Promise<ThreadSummary[]> {
  return Promise.all(
    threads.map(async (thread) => {
      // Recheck unread "done" rows as well as running rows so deployments can
      // repair failures that older run hosts incorrectly persisted as done.
      const shouldReconcile =
        thread.status === "running" ||
        (thread.status === "done" && thread.unread);
      if (!shouldReconcile || !thread.runId) return thread;
      const runStatus =
        (await getDurableRunStatus(thread.runId, userId)) ??
        getMemoryAskRunStatus(userId, thread.runId);
      if (!runStatus || runStatus === "running") return thread;

      const completedFromRunning =
        thread.status === "running" && runStatus === "done";
      await updateThreadRunStatus({
        userId,
        id: thread.id,
        status: runStatus,
        unread: completedFromRunning,
        clearUnread: runStatus !== "done",
        unreadOnlyIfRunning: true,
      }).catch(() => {});
      return {
        ...thread,
        status: runStatus,
        unread:
          runStatus === "done" ? completedFromRunning || thread.unread : false,
        updatedAt: Date.now(),
      };
    }),
  );
}

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
    const [reconciled] = await reconcileRunningThreads(session.user.id, [
      thread,
    ]);
    await markThreadSeen(session.user.id, id).catch(() => {});
    return Response.json({ thread: { ...reconciled, unread: false } });
  }
  const threads = await reconcileRunningThreads(
    session.user.id,
    await listThreads(session.user.id),
  );
  return Response.json({ threads });
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
    ? body.messages.slice(-200)
    : [];
  if (messages.length === 0)
    return Response.json({ error: "No messages" }, { status: 400 });

  const title = clean(body.title, 200) || "Untitled";
  const cite = clean(body.cite, 300) || undefined;
  const kind = clean(body.kind, 40) || undefined;
  const rawHref = clean(body.sourceHref, 800);
  const sourceHref = rawHref.startsWith("/") ? rawHref : undefined;
  const runId = clean(body.runId, 100) || undefined;
  const status =
    body.status === "running" ||
    body.status === "stopped" ||
    body.status === "error"
      ? body.status
      : "done";
  const unread = body.unread === true;

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
  if (unread && status === "done") {
    await updateThreadRunStatus({
      userId: session.user.id,
      id,
      status,
      unread: true,
    }).catch(() => {});
  }
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
