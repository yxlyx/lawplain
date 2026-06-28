import { DurableObject } from "cloudflare:workers";
import type { AgentEvent } from "../lib/agent";
import { CubeSandbox } from "../lib/cubesandbox";
import { GraffRun } from "./graff-run";

/**
 * AskRunDO — hosts one Ask Lawplain agent run so it survives the client
 * navigating away. The run is driven by a single `alarm()` invocation that
 * loops until graff finishes, appending normalized AgentEvents to a SQLite
 * log; clients connect to `/stream?from=N` to replay buffered events and tail
 * live ones. Because the run lives in the DO (not the request), closing the tab
 * doesn't stop it — reopening reconnects to the same buffered + live stream.
 */

interface AskRunEnv {
  CUBESANDBOX_GATEWAY_URL?: string;
  CUBESANDBOX_TENANT_KEY?: string;
  [key: string]: unknown;
}

const PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "CODEGRAFF_API_KEY",
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "MINIMAX_API_KEY",
  "XIAOMI_API_KEY",
  "KIMI_API_KEY",
  "MOONSHOT_API_KEY",
  "XAI_API_KEY",
  "ZAI_API_KEY",
];

type RunStatus = "idle" | "running" | "done" | "error";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AskRunDO extends DurableObject<AskRunEnv> {
  constructor(ctx: DurableObjectState, env: AskRunEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS events (idx INTEGER PRIMARY KEY, json TEXT NOT NULL)`,
    );
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname.endsWith("/start")) {
      return this.handleStart(req);
    }
    if (url.pathname.endsWith("/stream")) {
      const from =
        Number.parseInt(url.searchParams.get("from") ?? "0", 10) || 0;
      return this.handleStream(from);
    }
    if (url.pathname.endsWith("/status")) {
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

  private appendEvents(events: AgentEvent[]): void {
    for (const ev of events) {
      this.ctx.storage.sql.exec(
        "INSERT INTO events (idx, json) VALUES ((SELECT COALESCE(MAX(idx), -1) + 1 FROM events), ?)",
        JSON.stringify(ev),
      );
    }
  }

  /** Idempotent: starts the run on first call; later calls are no-ops. */
  private async handleStart(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => null)) as {
      prompt?: string;
      systemPrompt?: string;
      model?: string;
    } | null;
    const status = await this.status();
    if (status === "idle") {
      if (!body?.prompt || !body.systemPrompt || !body.model) {
        return Response.json({ error: "missing run params" }, { status: 400 });
      }
      await this.ctx.storage.put({
        status: "running" satisfies RunStatus,
        prompt: body.prompt,
        systemPrompt: body.systemPrompt,
        model: body.model,
        startedAt: Date.now(),
      });
      await this.ctx.storage.setAlarm(Date.now());
    }
    return Response.json({ ok: true, status: await this.status() });
  }

  /** Runs the whole graff loop once; survives client disconnect. */
  async alarm(): Promise<void> {
    // Guard against a duplicate alarm re-entering the loop.
    if (await this.ctx.storage.get<boolean>("looping")) return;
    await this.ctx.storage.put("looping", true);

    const prompt = await this.ctx.storage.get<string>("prompt");
    const systemPrompt = await this.ctx.storage.get<string>("systemPrompt");
    const model = await this.ctx.storage.get<string>("model");
    const startedAt =
      (await this.ctx.storage.get<number>("startedAt")) ?? Date.now();

    const gw = this.env.CUBESANDBOX_GATEWAY_URL;
    const key = this.env.CUBESANDBOX_TENANT_KEY;
    if (!gw || !key) {
      return this.fail("CubeSandbox gateway not configured");
    }
    if (!prompt || !systemPrompt || !model) {
      return this.fail("missing run params");
    }
    const providerEnv: Record<string, string> = {};
    for (const k of PROVIDER_KEYS) {
      const v = this.env[k];
      if (typeof v === "string" && v) providerEnv[k] = v;
    }
    if (Object.keys(providerEnv).length === 0) {
      return this.fail("No graff provider key set");
    }

    const sandbox = new CubeSandbox({ gatewayUrl: gw, tenantKey: key });
    const run = new GraffRun(startedAt);
    try {
      this.appendEvents(
        await run.launch(sandbox, { model, providerEnv, prompt, systemPrompt }),
      );
      while (!run.done) {
        const events = await run.poll(sandbox);
        if (events.length) this.appendEvents(events);
        if (run.done) break;
        await sleep(750);
      }
      await this.ctx.storage.put("status", "done" satisfies RunStatus);
    } catch (e) {
      this.appendEvents([
        { type: "error", message: e instanceof Error ? e.message : String(e) },
      ]);
      await this.ctx.storage.put("status", "error" satisfies RunStatus);
    } finally {
      if (run.sandboxId) await sandbox.deleteSandbox(run.sandboxId);
    }
  }

  private async fail(message: string): Promise<void> {
    this.appendEvents([{ type: "error", message }]);
    await this.ctx.storage.put("status", "error" satisfies RunStatus);
  }

  /** SSE: replay events from `from`, then tail live ones until terminal. */
  private handleStream(from: number): Response {
    const encoder = new TextEncoder();
    const ctx = this.ctx;
    const status = () => this.status();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let cursor = from;
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
            }
            const s = await status();
            if (s === "done" || s === "error") {
              const more = ctx.storage.sql
                .exec("SELECT COUNT(*) AS c FROM events WHERE idx >= ?", cursor)
                .one();
              if (Number(more.c) === 0) break;
              continue;
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
