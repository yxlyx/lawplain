import { DurableObject } from "cloudflare:workers";
import type { AgentEvent } from "../lib/agent";
import { RESEARCH_BUSY } from "../lib/ask-errors";
import { CondensationError } from "../lib/condensation-sandbox";
import type { CubeSandbox } from "../lib/cubesandbox";
import {
  createResearchSandbox,
  sandboxConfigured,
} from "../lib/research-sandbox";
import {
  askAgentEnabled,
  MAX_ASK_EVENT_BYTES,
  providerCredential,
  redactSecrets,
  safeAgentError,
  userRunName,
} from "./ask-security";
import { GraffRun, type GraffRunState } from "./graff-run";
import type { SessionLease } from "./ask-session";
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
  ASK_SESSION_DO?: DurableObjectNamespace;
  CUBESANDBOX_GATEWAY_URL?: string;
  CUBESANDBOX_TENANT_KEY?: string;
  CONDENSATION_API_KEY?: string;
  LAWPLAIN_SANDBOX_PROVIDER?: string;
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
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS run_checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)`,
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

  private async appendEvents(
    events: AgentEvent[],
    checkpoint?: GraffRunState,
  ): Promise<void> {
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
    this.ctx.storage.transactionSync(() => {
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
      if (checkpoint)
        this.ctx.storage.sql.exec(
          "INSERT OR REPLACE INTO run_checkpoint (id, json) VALUES (1, ?)",
          JSON.stringify(checkpoint),
        );
    });
    const runId = await this.ctx.storage.get<string>("runId");
    if (runId && trajectoryEvents.length) {
      await recordTrajectoryEvents(
        this.env.TRAJECTORY_DB,
        runId,
        trajectoryEvents,
      ).catch((error) => console.warn("Failed to persist Ask events", error));
    }
  }

  private checkpoint(): GraffRunState | null {
    const rows = this.ctx.storage.sql
      .exec("SELECT json FROM run_checkpoint WHERE id = 1")
      .toArray();
    return rows.length
      ? (JSON.parse(String(rows[0].json)) as GraffRunState)
      : null;
  }

  private async sessionRequest(
    path: string,
    extra: Record<string, unknown> = {},
  ): Promise<Response> {
    const userId = await this.ctx.storage.get<string>("userId");
    const runId = await this.ctx.storage.get<string>("runId");
    const threadId = (await this.ctx.storage.get<string>("threadId")) ?? runId;
    if (!userId || !threadId || !this.env.ASK_SESSION_DO)
      throw new Error("Research session unavailable");
    const stub = this.env.ASK_SESSION_DO.get(
      this.env.ASK_SESSION_DO.idFromName(userRunName(userId, threadId)),
    );
    return stub.fetch(`https://ask-session${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lawplain-user-id": userId,
      },
      body: JSON.stringify({ threadId, runId, ...extra }),
    });
  }

  private async releaseSession(run: GraffRun): Promise<void> {
    const response = await this.sessionRequest("/release", {
      sandboxId: run.sandboxId,
      runtimeReady: run.runtimeReady,
    });
    if (!response.ok) throw new Error("Research session release failed");
  }

  private async parkSession(
    run: GraffRun,
    sandbox: CubeSandbox,
  ): Promise<void> {
    // Old deployments did not record a process group. Keep completed legacy
    // VMs, but retire an interrupted legacy process that cannot be safely stopped.
    if (
      run.workDir === "/tmp" &&
      run.sandboxId &&
      (await sandbox.readSandboxFile(run.sandboxId, "/tmp/graff.exit")) === null
    ) {
      const response = await this.sessionRequest("/retire", {
        sandboxId: run.sandboxId,
      });
      if (!response.ok)
        throw new Error("Could not retire interrupted legacy session");
      return;
    }
    await run.stop(sandbox);
    await this.releaseSession(run);
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
    if (sid) {
      const sandbox = createResearchSandbox(this.env, {
        existingSandboxId: sid,
      });
      const state = this.checkpoint();
      if (await this.ctx.storage.get<boolean>("sharedSession")) {
        if (state) {
          const run = GraffRun.restore(state);
          await this.parkSession(run, sandbox);
        }
      } else {
        await sandbox.deleteSandbox(sid);
      }
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
    let sharedSession = false;
    let terminalStatus: "done" | "error" | undefined;
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
      if (!sandboxConfigured(this.env)) {
        await this.fail("Research sandbox not configured");
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
      providerSecrets = [
        ...Object.values(providerEnv),
        this.env.CONDENSATION_API_KEY ?? "",
      ];
      const saved = this.checkpoint();
      // Terminal output and its cursor were committed together. If the isolate
      // restarted during release, finish that release without acquiring again.
      if (saved?.done && saved.sandboxId) {
        run = GraffRun.restore(saved);
        sandbox = createResearchSandbox(this.env, {
          existingSandboxId: saved.sandboxId,
        });
        sharedSession =
          (await this.ctx.storage.get<boolean>("sharedSession")) === true;
        terminalStatus = saved.failed ? "error" : "done";
        return;
      }
      const orphanedSandboxId = await this.ctx.storage.get<string>("sandboxId");
      sharedSession =
        !!this.env.ASK_SESSION_DO &&
        (this.env.LAWPLAIN_SANDBOX_PROVIDER === "condensation" ||
          (await this.ctx.storage.get<boolean>("sharedSession")) === true);
      let lease: SessionLease | undefined;
      let sandboxRequestId =
        await this.ctx.storage.get<string>("sandboxRequestId");
      if (!sandboxRequestId) {
        sandboxRequestId = crypto.randomUUID();
        await this.ctx.storage.put("sandboxRequestId", sandboxRequestId);
      }
      if (sharedSession) {
        const response = await this.sessionRequest("/acquire", {
          existingSandboxId: !saved ? orphanedSandboxId : undefined,
        });
        if (!response.ok) {
          await this.fail(
            response.status === 409
              ? "Research is already running in this conversation. Wait for it to finish before sending another question."
              : response.status === 429
                ? RESEARCH_BUSY
                : safeAgentError(),
          );
          return;
        }
        lease = (await response.json()) as SessionLease;
        await this.ctx.storage.put("sharedSession", true);
        console.info("Ask sandbox lease", {
          runId: await this.ctx.storage.get<string>("runId"),
          sandboxId: lease.sandboxId,
          reused: lease.reused,
          expiresAt: lease.expiresAt,
        });
      }
      const activeSandbox = createResearchSandbox(this.env, {
        requestId: sandboxRequestId,
        existingSandboxId: lease?.sandboxId ?? orphanedSandboxId,
      });
      sandbox = activeSandbox;
      // Resume the same guest process and parser cursor after an isolate restart.
      // A new VM is needed only when the prior provider lease is actually gone.
      const canResume =
        saved && (!lease || lease.sandboxId === saved.sandboxId);
      const recovering = attempt > 1 || hasPriorEvents || !!orphanedSandboxId;
      run = canResume
        ? GraffRun.restore(saved)
        : new GraffRun(
            recovering && !orphanedSandboxId ? Date.now() : startedAt,
            orphanedSandboxId && !saved ? "/tmp" : undefined,
          );
      if (!saved && orphanedSandboxId) {
        run.launched = true;
        run.runtimeReady = true;
      }
      if (lease) run.sandboxId = lease.sandboxId;
      else if (orphanedSandboxId) run.sandboxId = orphanedSandboxId;
      if (recovering) {
        await this.appendEvents([
          {
            type: "progress",
            phase: "thinking",
            message: canResume
              ? "Reconnecting to your existing research…"
              : "Resuming research after an interruption…",
            elapsedMs: Math.max(0, Date.now() - startedAt),
          },
        ]);
      }
      if (await this.isStopped()) return;
      await this.appendEvents([], run.snapshot());
      let launchEvents: AgentEvent[] = [];
      if (!run.launched) {
        launchEvents = await run.launch(
          activeSandbox,
          { model, providerEnv, prompt, systemPrompt, toolCallBudget },
          async (sid) => {
            await this.ctx.storage.put("sandboxId", sid);
            await this.appendEvents([], run!.snapshot());
            if (await this.isStopped()) throw new Error("stopped");
          },
          {
            sandboxId: run.sandboxId ?? undefined,
            runtimeReady: lease?.runtimeReady,
            checkpoint: () => this.appendEvents([], run!.snapshot()),
          },
        );
      }
      if (await this.isStopped()) return;
      await this.appendEvents(launchEvents, run.snapshot());
      // One-time migration of pre-checkpoint runs: replay their existing log
      // into the parser but do not send already-delivered text/tools twice.
      let replayChars = 0;
      const replayTools = new Map<string, number>();
      let replayDone = false;
      if (run.workDir === "/tmp" && run.snapshot().offset === 0) {
        for (const row of this.ctx.storage.sql
          .exec("SELECT json FROM events ORDER BY idx")
          .toArray()) {
          const event = JSON.parse(String(row.json)) as AgentEvent;
          if (event.type === "delta") replayChars += event.text.length;
          if (event.type === "tool")
            replayTools.set(event.key, event.count ?? 1);
          if (event.type === "done") replayDone = true;
        }
      }
      let sawError =
        run.failed || launchEvents.some((ev) => ev.type === "error");
      while (!run.done) {
        if (await this.isStopped()) break;
        const events = (await run.poll(activeSandbox)).flatMap(
          (event): AgentEvent[] => {
            if (event.type === "delta" && replayChars > 0) {
              const skip = Math.min(replayChars, event.text.length);
              replayChars -= skip;
              return skip === event.text.length
                ? []
                : [{ ...event, text: event.text.slice(skip) }];
            }
            if (
              event.type === "tool" &&
              (event.count ?? 1) <= (replayTools.get(event.key) ?? 0)
            )
              return [];
            if (event.type === "done" && replayDone) return [];
            return [event];
          },
        );
        if (events.some((ev) => ev.type === "error")) sawError = true;
        run.failed = sawError;
        await this.appendEvents(events, run.snapshot());
        if (run.done || (await this.isStopped())) break;
        await sleep(750);
      }
      if (!(await this.isStopped())) {
        terminalStatus = sawError ? "error" : "done";
      }
    } catch (e) {
      if (await this.isStopped()) return;
      console.error("Ask run failed", redactSecrets(e, providerSecrets));
      await this.appendEvents([
        {
          type: "error",
          message:
            e instanceof CondensationError && e.status === 429
              ? RESEARCH_BUSY
              : safeAgentError(),
        },
      ]);
      terminalStatus = "error";
    } finally {
      try {
        if (run?.sandboxId && sandbox) {
          if (sharedSession) {
            // Terminate only this turn's process group; keep the VM and its
            // workspace for follow-ups. The session DO owns idle/lease cleanup.
            await this.parkSession(run, sandbox);
          } else {
            await sandbox.deleteSandbox(run.sandboxId);
          }
        }
        await this.ctx.storage.delete("sandboxId");
      } catch (error) {
        // Retain the persisted identity when cleanup is uncertain. The session
        // watchdog can recover it; never abandon it and create another VM.
        console.warn(
          "Ask sandbox release will be retried by its session",
          redactSecrets(error, providerSecrets),
        );
      } finally {
        try {
          if (terminalStatus && !(await this.isStopped())) {
            await this.ctx.storage.put("status", terminalStatus);
            await this.updateThreadStatus(terminalStatus);
            await this.updateTrajectoryStatus(terminalStatus);
          }
        } finally {
          this.looping = false;
        }
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
    const runId = await this.ctx.storage.get<string>("runId");
    if (!userId || !threadId || !runId) return;

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
         WHERE userId = ? AND id = ? AND runId = ?`,
      )
      .bind(
        status,
        status !== "done" ? 1 : 0,
        status === "done" ? 1 : 0,
        Date.now(),
        userId,
        threadId,
        runId,
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
            const currentStatus = await status();
            for (const r of rows) {
              const event = JSON.parse(String(r.json)) as AgentEvent;
              // Do not invite a follow-up until the preceding turn has released
              // its session. Output deltas can still stream during cleanup.
              if (
                currentStatus === "running" &&
                (event.type === "done" || event.type === "error")
              )
                break;
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
