import { DurableObject } from "cloudflare:workers";
import { CondensationSandbox } from "../lib/condensation-sandbox";
import { AskSession, SessionError, type SessionState } from "./ask-session";

interface SessionEnv {
  CONDENSATION_API_KEY?: string;
}

/** One owner per conversation, shared by all of that conversation's run DOs. */
export class AskSessionDO extends DurableObject<SessionEnv> {
  private queue: Promise<unknown> = Promise.resolve();
  private session: AskSession;

  constructor(ctx: DurableObjectState, env: SessionEnv) {
    super(ctx, env);
    this.session = new AskSession(
      {
        get: () => ctx.storage.get<SessionState>("session"),
        put: (state) => ctx.storage.put("session", state),
        alarm: (at) => ctx.storage.setAlarm(at),
      },
      {
        create: (requestId) =>
          new CondensationSandbox(
            env.CONDENSATION_API_KEY ?? "",
            requestId,
          ).createSandbox(),
        get: (id) =>
          new CondensationSandbox(env.CONDENSATION_API_KEY ?? "").getSandbox(
            id,
          ),
        delete: (id) =>
          new CondensationSandbox(env.CONDENSATION_API_KEY ?? "").deleteSandbox(
            id,
          ),
      },
    );
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    // Set the queue before awaiting anything. In-flight provider operations
    // stay serialized without blockConcurrencyWhile's 30-second timeout.
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async fetch(req: Request): Promise<Response> {
    const userId = req.headers.get("x-lawplain-user-id");
    if (!userId || req.method !== "POST")
      return new Response("Not found", { status: 404 });
    const body = (await req.json().catch(() => null)) as {
      threadId?: string;
      runId?: string;
      sandboxId?: string;
      runtimeReady?: boolean;
      existingSandboxId?: string;
    } | null;
    if (
      !body ||
      typeof body.threadId !== "string" ||
      !body.threadId ||
      body.threadId.length > 100
    )
      return new Response("Invalid session", { status: 400 });
    const threadId = body.threadId;
    return this.serial(async () => {
      try {
        const path = new URL(req.url).pathname;
        if (path === "/dispose") {
          await this.session.dispose(userId, threadId);
          return Response.json({ ok: true });
        }
        if (
          typeof body.runId !== "string" ||
          !body.runId ||
          body.runId.length > 100
        )
          return new Response("Invalid run", { status: 400 });
        if (path === "/acquire")
          return Response.json(
            await this.session.acquire(
              userId,
              threadId,
              body.runId,
              typeof body.existingSandboxId === "string"
                ? body.existingSandboxId
                : undefined,
            ),
          );
        if (path === "/retire" && typeof body.sandboxId === "string") {
          await this.session.retireRun(
            userId,
            threadId,
            body.runId,
            body.sandboxId,
          );
          return Response.json({ ok: true });
        }
        if (path === "/release" && typeof body.sandboxId === "string") {
          await this.session.release(
            userId,
            threadId,
            body.runId,
            body.sandboxId,
            body.runtimeReady === true,
          );
          return Response.json({ ok: true });
        }
        return new Response("Not found", { status: 404 });
      } catch (error) {
        const status =
          error instanceof SessionError
            ? error.status
            : (error as { status?: number }).status === 429
              ? 429
              : 503;
        return Response.json(
          { error: "Research session unavailable" },
          { status },
        );
      }
    });
  }

  async alarm(): Promise<void> {
    await this.serial(() => this.session.cleanup());
  }
}
