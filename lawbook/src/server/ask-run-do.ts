import { DurableObject } from "cloudflare:workers";
import type { AgentEvent } from "../lib/agent";
import { CubeSandbox } from "../lib/cubesandbox";
import {
  askAgentEnabled,
  MAX_ASK_EVENT_BYTES,
  providerCredential,
  redactSecrets,
  safeAgentError,
} from "./ask-security";
import { GraffRun } from "./graff-run";
import {
  finishTrajectory,
  recordTrajectoryEvents,
  startTrajectory,
} from "./trajectory-store";

/**
 * AskRunDO — hosts one Ask Lawplain agent run so it survives the client
 * navigating away. The run is driven by a single `alarm()` invocation that
 * loops until graff finishes, appending normalized AgentEvents to a SQLite
 * log; clients connect to `/stream?from=N` to replay buffered events and tail
 * live ones. Because the run lives in the DO (not the request), closing the tab
 * doesn't stop it — reopening reconnects to the same buffered + live stream.
 */

interface AskRunEnv {
  AUTH_DB?: D1Database;
  TRAJECTORY_DB?: D1Database;
  CUBESANDBOX_GATEWAY_URL?: string;
  CUBESANDBOX_TENANT_KEY?: string;
  [key: string]: unknown;
}

type RunStatus = "idle" | "running" | "done" | "error" | "stopped";

const MAX_RUN_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AskRunDO extends DurableObject<AskRunEnv> {
  private looping = false;

  constructor(ctx: DurableObjectState, env: AskRunEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (idx INTEGER PRIMARY KEY, json TEXT NOT NULL)`,
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const caller = req.headers.get("x-lawplain-user-id");
    const owner = await this.ctx.storage.get<string>("userId");
    if (!caller || (owner && owner !== caller)) {
      return Response.json({ error: "Run not found" }, { status: 404 });
    }
    if (req.method === "POST" && url.pathname.endsWith("/start")) {
      return this.handleStart(req);
    }
    if (url.pathname.endsWith("/stream")) {
      await this.ensureRunningAlarm();
      const from =
        Number.parseInt(url.searchParams.get("from") ?? "0", 10) || 0;
      return this.handleStream(from);
    }
    if (req.method === "POST" && url.pathname.endsWith("/stop")) {
      return this.handleStop();
    }
    if (url.pathname.endsWith("/status")) {
      await this.ensureRunningAlarm();
      return Response.json({
        status: await this.status(),
        count: this.eventCount(),
      });
    }
    return new Response("not found", { status: 404 });
  }

  private async status(): Promise<RunStatus> {
    return (await this.ctx.storage.get<RunStatus>("status")) ?? "idle";
  }

  private eventCount(): number {
    const row = this.ctx.storage.sql
      .exec("SELECT COUNT(*) AS c FROM events")
      .one();
    return Number(row.c);
  }

  /** Reconnecting to an interrupted run re-arms its alarm after an isolate restart. */
  private async ensureRunningAlarm(): Promise<void> {
    if (this.looping || (await this.status()) !== "running") return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  private async appendEvents(events: AgentEvent[]): Promise<void> {
    const secrets = Object.values(providerCredential(this.env) ?? {});
    const redact = (value: unknown): unknown => {
      if (typeof value === "string") return redactSecrets(value, secrets);
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, redact(item)]),
        );
      return value;
    };
    let nextIndex = this.eventCount();
    const trajectoryEvents: { seq: number; event: AgentEvent }[] = [];
    const insert = (event: AgentEvent) => {
      const safeEvent = redact(event) as AgentEvent;
      const localEvent =
        safeEvent.type === "done" ? { ...safeEvent, text: "" } : safeEvent;
      const json = JSON.stringify(localEvent);
      if (new TextEncoder().encode(json).length > MAX_ASK_EVENT_BYTES) {
        // Only non-terminal metadata can reach this after delta chunking and
        // terminal compaction; replace it visibly rather than silently dropping it.
        return insert({ type: "error", message: safeAgentError() });
      }
      this.ctx.storage.sql.exec(
        "INSERT INTO events (idx, json) VALUES (?, ?)",
        nextIndex,
        json,
      );
      trajectoryEvents.push({ seq: nextIndex, event: safeEvent });
      nextIndex += 1;
    };
    for (const ev of events) {
      if (ev.type === "delta") {
        let text = ev.text;
        while (text) {
          // 8KB of UTF-8 remains below the 64KB event cap even when every byte
          // needs JSON's longest six-byte escape representation.
          const bytes = new TextEncoder().encode(text);
          const part = new TextDecoder().decode(bytes.slice(0, 8_000), {
            stream: bytes.length > 8_000,
          });
          insert({ type: "delta", text: part });
          text = new TextDecoder().decode(
            bytes.slice(new TextEncoder().encode(part).length),
          );
        }
      } else {
        insert(ev);
      }
    }
    const runId = await this.ctx.storage.get<string>("runId");
    if (runId && trajectoryEvents.length) {
      await recordTrajectoryEvents(
        this.env.TRAJECTORY_DB,
        runId,
        trajectoryEvents,
      ).catch((error) => console.warn("Failed to persist Ask events", error));
    }
  }

  /** Idempotent: starts the run on first call; later calls are no-ops. */
  private async handleStart(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as {
      prompt?: string;
      systemPrompt?: string;
      toolCallBudget?: number;
      model?: string;
      runId?: string;
      userId?: string;
      threadId?: string;
      title?: string;
      question?: string;
      cite?: string;
      kind?: string;
      sourceHref?: string;
    } | null;
    const status = await this.status();
    if (status === "idle") {
      if (
        !body?.prompt ||
        !body.systemPrompt ||
        !body.model ||
        !body.runId ||
        !body.question ||
        body.userId !== req.headers.get("x-lawplain-user-id")
      ) {
        return Response.json({ error: "missing run params" }, { status: 400 });
      }
      const startedAt = Date.now();
      await this.ctx.storage.put({
        status: "running" satisfies RunStatus,
        prompt: body.prompt,
        systemPrompt: body.systemPrompt,
        toolCallBudget:
          typeof body.toolCallBudget === "number"
            ? Math.min(6, Math.max(1, Math.trunc(body.toolCallBudget)))
            : 4,
        model: body.model,
        runId: body.runId,
        userId: body.userId,
        threadId: body.threadId,
        startedAt,
        runAttempts: 0,
      });
      await startTrajectory(this.env.TRAJECTORY_DB, {
        runId: body.runId,
        threadId: body.threadId,
        userId: body.userId,
        title: body.title,
        question: body.question,
        prompt: body.prompt,
        model: body.model,
        cite: body.cite,
        kind: body.kind,
        sourceHref: body.sourceHref,
        startedAt,
      }).catch((error) =>
        console.warn("Failed to start Ask trajectory", error),
      );
      await this.ctx.storage.setAlarm(Date.now());
    }
    return Response.json({ ok: true, status: await this.status() });
  }

  /** Idempotent: marks the run stopped and tears down its sandbox if known. */
  private async handleStop(): Promise<Response> {
    const status = await this.status();
    if (status !== "done" && status !== "error" && status !== "stopped") {
      await this.appendEvents([
        {
          type: "progress",
          phase: "stopped",
          message: "Research exited by request.",
          elapsedMs: await this.elapsedMs(),
        },
      ]);
      await this.ctx.storage.put("status", "stopped" satisfies RunStatus);
      await this.updateThreadStatus("stopped");
      await this.updateTrajectoryStatus("stopped");
    }

    const sid = await this.ctx.storage.get<string>("sandboxId");
    const gw = this.env.CUBESANDBOX_GATEWAY_URL;
    const key = this.env.CUBESANDBOX_TENANT_KEY;
    if (sid && gw && key) {
      await new CubeSandbox({ gatewayUrl: gw, tenantKey: key }).deleteSandbox(
        sid,
      );
      await this.ctx.storage.delete("sandboxId");
    }

    return Response.json({ ok: true, status: await this.status() });
  }

  private async elapsedMs(): Promise<number> {
    const startedAt =
      (await this.ctx.storage.get<number>("startedAt")) ?? Date.now();
    return Math.max(0, Date.now() - startedAt);
  }

  private async isStopped(): Promise<boolean> {
    return (await this.status()) === "stopped";
  }

  /** Runs the whole graff loop once; survives client disconnect. */
  async alarm(): Promise<void> {
    // This guard must be isolate-local. A persisted boolean survives a Worker
    // deployment and used to strand a retried alarm in `running` forever.
    if (this.looping) return;
    this.looping = true;

    let sandbox: CubeSandbox | null = null;
    let run: GraffRun | null = null;
    let providerSecrets: string[] = [];
    try {
      // Remove the legacy persisted guard from Durable Objects created by an
      // older deployment. Retry attempts are bounded separately below.
      await this.ctx.storage.delete("looping");
      if ((await this.status()) !== "running") return;

      const attempt =
        ((await this.ctx.storage.get<number>("runAttempts")) ?? 0) + 1;
      await this.ctx.storage.put("runAttempts", attempt);
      if (attempt > MAX_RUN_ATTEMPTS) {
        await this.fail(safeAgentError());
        return;
      }

      const prompt = await this.ctx.storage.get<string>("prompt");
      const systemPrompt = await this.ctx.storage.get<string>("systemPrompt");
      const toolCallBudget =
        (await this.ctx.storage.get<number>("toolCallBudget")) ?? 4;
      const model = await this.ctx.storage.get<string>("model");
      const startedAt =
        (await this.ctx.storage.get<number>("startedAt")) ?? Date.now();
      const hasPriorEvents = this.eventCount() > 0;
      const gw = this.env.CUBESANDBOX_GATEWAY_URL;
      const key = this.env.CUBESANDBOX_TENANT_KEY;

      if (!gw || !key) {
        await this.fail("CubeSandbox gateway not configured");
        return;
      }
      if (!prompt || !systemPrompt || !model) {
        await this.fail("missing run params");
        return;
      }
      if (!askAgentEnabled(this.env)) {
        await this.fail(safeAgentError());
        return;
      }
      const providerEnv = providerCredential(this.env);
      if (!providerEnv) {
        await this.fail(safeAgentError());
        return;
      }
      providerSecrets = Object.values(providerEnv);
      const activeSandbox = new CubeSandbox({ gatewayUrl: gw, tenantKey: key });
      sandbox = activeSandbox;

      const orphanedSandboxId = await this.ctx.storage.get<string>("sandboxId");
      if (orphanedSandboxId) {
        await activeSandbox
          .deleteSandbox(orphanedSandboxId)
          .catch((error) =>
            console.warn("Failed to remove interrupted Ask sandbox", error),
          );
        await this.ctx.storage.delete("sandboxId");
      }
      const recovering = attempt > 1 || hasPriorEvents || !!orphanedSandboxId;
      if (recovering) {
        await this.appendEvents([
          {
            type: "progress",
            phase: "thinking",
            message: "Previous research was interrupted; retrying safely…",
            elapsedMs: Math.max(0, Date.now() - startedAt),
          },
        ]);
      }

      run = new GraffRun(recovering ? Date.now() : startedAt);
      if (await this.isStopped()) return;
      const launchEvents = await run.launch(
        activeSandbox,
        { model, providerEnv, prompt, systemPrompt, toolCallBudget },
        async (sid) => {
          await this.ctx.storage.put("sandboxId", sid);
          if (await this.isStopped()) {
            await activeSandbox.deleteSandbox(sid);
            throw new Error("stopped");
          }
        },
      );
      if (await this.isStopped()) return;
      await this.appendEvents(launchEvents);
      let sawError = launchEvents.some((ev) => ev.type === "error");
      while (!run.done) {
        if (await this.isStopped()) break;
        const events = await run.poll(activeSandbox);
        if (events.some((ev) => ev.type === "error")) sawError = true;
        if (events.length) await this.appendEvents(events);
        if (run.done || (await this.isStopped())) break;
        await sleep(750);
      }
      if (!(await this.isStopped())) {
        const status = (sawError ? "error" : "done") satisfies RunStatus;
        await this.ctx.storage.put("status", status);
        await this.updateThreadStatus(status);
        await this.updateTrajectoryStatus(status);
      }
    } catch (e) {
      if (await this.isStopped()) return;
      console.error("Ask run failed", redactSecrets(e, providerSecrets));
      await this.appendEvents([{ type: "error", message: safeAgentError() }]);
      await this.ctx.storage.put("status", "error" satisfies RunStatus);
      await this.updateThreadStatus("error");
      await this.updateTrajectoryStatus("error");
    } finally {
      try {
        if (run?.sandboxId && sandbox) {
          await sandbox.deleteSandbox(run.sandboxId);
        }
      } catch (error) {
        console.warn("Failed to remove Ask sandbox", error);
      } finally {
        await this.ctx.storage.delete("sandboxId");
        this.looping = false;
      }
    }
  }

  private async fail(message: string): Promise<void> {
    await this.appendEvents([{ type: "error", message }]);
    await this.ctx.storage.put("status", "error" satisfies RunStatus);
    await this.updateThreadStatus("error");
    await this.updateTrajectoryStatus("error");
  }

  private async updateTrajectoryStatus(status: RunStatus): Promise<void> {
    if (status !== "done" && status !== "error" && status !== "stopped") return;
    const runId = await this.ctx.storage.get<string>("runId");
    if (!runId) return;
    await finishTrajectory(this.env.TRAJECTORY_DB, runId, status).catch(
      (error) => console.warn("Failed to finish Ask trajectory", error),
    );
  }

  private async updateThreadStatus(status: RunStatus): Promise<void> {
    if (status !== "done" && status !== "error" && status !== "stopped") return;
    const db = this.env.AUTH_DB;
    if (!db) return;
    const userId = await this.ctx.storage.get<string>("userId");
    const threadId = await this.ctx.storage.get<string>("threadId");
    if (!userId || !threadId) return;

    await db
      .prepare(
        `UPDATE ask_threads
         SET status = ?,
             unread = CASE
               WHEN ? = 1 THEN 0
               WHEN ? = 1 AND status = 'running' THEN 1
               ELSE unread
             END,
             updatedAt = ?
         WHERE userId = ? AND id = ?`,
      )
      .bind(
        status,
        status !== "done" ? 1 : 0,
        status === "done" ? 1 : 0,
        Date.now(),
        userId,
        threadId,
      )
      .run()
      .catch(() => {});
  }

  /** SSE: replay events from `from`, then tail live ones until terminal. */
  private handleStream(from: number): Response {
    const encoder = new TextEncoder();
    const ctx = this.ctx;
    const status = () => this.status();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursor = from;
        let lastEventAt = Date.now();
        try {
          while (true) {
            const rows = ctx.storage.sql
              .exec(
                "SELECT idx, json FROM events WHERE idx >= ? ORDER BY idx",
                cursor,
              )
              .toArray();
            for (const r of rows) {
              controller.enqueue(encoder.encode(`data: ${r.json}\n\n`));
              cursor = Number(r.idx) + 1;
              lastEventAt = Date.now();
            }
            const s = await status();
            if (s === "done" || s === "error" || s === "stopped") {
              const more = ctx.storage.sql
                .exec("SELECT COUNT(*) AS c FROM events WHERE idx >= ?", cursor)
                .one();
              if (Number(more.c) === 0) break;
              continue;
            }
            if (Date.now() - lastEventAt > 330_000) {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "error", message: safeAgentError() })}\n\n`,
                ),
              );
              break;
            }
            await sleep(400);
          }
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-content-type-options": "nosniff",
      },
    });
  }
}
