/**
 * Step-wise graff run, designed to be driven by a Durable Object: `launch()`
 * once (create sandbox + start graff), then `poll()` repeatedly (read new
 * stdout, emit normalized AgentEvents) until `done`. Unlike the request-scoped
 * generator in agent.ts, the state lives in the instance so a DO can persist /
 * resume it, and it has no node or @codegraff/sdk runtime deps — only the
 * env-injectable CubeSandbox + fetch — so it runs inside workerd.
 *
 * The composed prompt + system prompt + model are passed in (computed by the
 * route from agent.ts); provider keys come from the DO's own env. Tool-call
 * summarization is duplicated here (cosmetic status chips) to avoid importing
 * agent.ts's runtime.
 */
import type { AgentEvent } from "../lib/agent";
import { type CubeSandbox, GRAFF_BIN_PATH } from "../lib/cubesandbox";

const BASE = "https://backend.lawplain.com";

/** graff `--json` stdout events. */
type GraffEvent =
  | { type: "reasoning" | "text"; text?: string }
  | { type: "tool_call"; name: string; input?: unknown }
  | { type: "turn"; text: string; cost_usd: number; context_tokens: number }
  | { type: "error"; message: string };

export interface GraffRunParams {
  model: string;
  providerEnv: Record<string, string>;
  prompt: string;
  systemPrompt: string;
}

interface ToolSummary {
  key: string;
  summary: string;
  kind: "search" | "detail" | "setup" | "other";
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseUrlSafe(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw.replace(/["')]+$/, ""));
  } catch {
    return null;
  }
}

function extractSearchQuery(cmd: string, url: URL | null): string | null {
  const fromUrl = url?.searchParams.get("q");
  if (fromUrl) return fromUrl;
  const dataUrlencode = cmd.match(/--data-urlencode\s+["']q=([^"']+)["']/);
  if (dataUrlencode) return dataUrlencode[1];
  const queryParam = cmd.match(/[?&]q=([^&"'\s]+)/);
  return queryParam?.[1] ?? null;
}

function summarizeToolCall(name: string, input: unknown): ToolSummary {
  const inp =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (name === "bash") {
    const cmd = String(inp.command ?? "").trim();
    const urlRaw = cmd.match(/https?:\/\/[^\s"')]+/)?.[0];
    const url = parseUrlSafe(urlRaw);
    const q = extractSearchQuery(cmd, url);
    if (q) {
      const path = url?.pathname ?? "unknown-search";
      const endpoint = path.replace(BASE, "");
      return {
        key: `bash:${endpoint}?q=${q}`,
        summary: `search: ${decodeURIComponentSafe(q)} (${endpoint})`,
        kind: "search",
      };
    }
    if (url) {
      const path = `${url.pathname}${url.search}`.replace(BASE, "");
      return {
        key: `bash:${path}`,
        summary: url.pathname.replace(BASE, ""),
        kind: url.pathname.startsWith("/v1/") ? "detail" : "other",
      };
    }
    return {
      key: `bash:${cmd.slice(0, 160)}`,
      summary: cmd.slice(0, 80),
      kind: "other",
    };
  }
  if (name === "webfetch") {
    const url = String(inp.url ?? "");
    return { key: `webfetch:${url}`, summary: `fetch ${url}`, kind: "detail" };
  }
  if (name === "read_file") {
    const path = String(inp.path ?? "");
    return { key: `read_file:${path}`, summary: `read ${path}`, kind: "other" };
  }
  return { key: name, summary: name, kind: "other" };
}

const RUN_DEADLINE_MS = 300_000;

/** Holds the parse state for one graff run so a DO can drive it across alarms. */
export class GraffRun {
  readonly startedAt: number;
  sandboxId: string | null = null;
  done = false;
  /** The final answer markdown once the turn completes. */
  finalText = "";
  costUsd = 0;
  contextTokens = 0;

  private offset = 0;
  private lineBuf = "";
  private rawNonJson = "";
  private streamedText = "";
  private sawTurn = false;
  private sawText = false;
  private announcedAnswering = false;
  private seenTools = new Map<string, number>();
  private lastHeartbeat: number;

  constructor(startedAt: number = Date.now()) {
    this.startedAt = startedAt;
    this.lastHeartbeat = startedAt;
  }

  private elapsed(now: number = Date.now()): number {
    return now - this.startedAt;
  }

  /** Create the sandbox, install graff, and launch the run in the background. */
  async launch(
    sandbox: CubeSandbox,
    params: GraffRunParams,
  ): Promise<AgentEvent[]> {
    const events: AgentEvent[] = [];
    events.push({
      type: "progress",
      phase: "sandbox_start",
      message: "Starting secure sandbox…",
      elapsedMs: this.elapsed(),
    });
    const sid = await sandbox.createSandbox({ cpuCount: 2, memoryMB: 1024 });
    this.sandboxId = sid;

    events.push({
      type: "progress",
      phase: "agent_install",
      message: "Loading research runtime…",
      elapsedMs: this.elapsed(),
    });
    await sandbox.installGraff(sid);

    const promptJson = JSON.stringify({ type: "user", text: params.prompt });
    const envs: Record<string, string> = {
      PROMPT_JSON: promptJson,
      SYSTEM_PROMPT: params.systemPrompt,
      GRAFF_BIN: GRAFF_BIN_PATH,
      MODEL: params.model,
      ...params.providerEnv,
      HOME: "/home/user",
      PATH: "/usr/bin:/bin:/usr/local/bin",
      GRAFF_NO_TELEMETRY: "1",
    };

    events.push({
      type: "progress",
      phase: "agent_start",
      message: "Starting research agent…",
      elapsedMs: this.elapsed(),
    });

    const start = await sandbox.runProcess(sid, {
      cmd: "/bin/bash",
      args: [
        "-c",
        `rm -f /tmp/graff.out /tmp/graff.err /tmp/graff.exit /tmp/graff.launch; nohup /bin/bash -lc 'printf %s "$PROMPT_JSON" | "$GRAFF_BIN" --json --yolo --no-telemetry --model "$MODEL" --system-prompt "$SYSTEM_PROMPT" > /tmp/graff.out 2> /tmp/graff.err; echo $? > /tmp/graff.exit' > /tmp/graff.launch 2>&1 < /dev/null & echo $!`,
      ],
      cwd: "/tmp",
      envs,
      timeoutMs: 10_000,
    });
    if (start.exitCode && start.exitCode !== 0) {
      throw new Error(`failed to start graff: ${start.stderr || start.stdout}`);
    }

    events.push({
      type: "progress",
      phase: "thinking",
      message: "Planning searches…",
      elapsedMs: this.elapsed(),
    });
    return events;
  }

  /**
   * Read whatever graff has written since the last poll and return the new
   * normalized events. Sets `done` (and emits the terminal done/error event)
   * once graff exits or the deadline passes.
   */
  async poll(sandbox: CubeSandbox): Promise<AgentEvent[]> {
    if (this.done) return [];
    const sid = this.sandboxId;
    if (!sid) return [];
    const events: AgentEvent[] = [];

    const out = (await sandbox.readSandboxFile(sid, "/tmp/graff.out")) ?? "";
    if (out.length > this.offset) {
      this.lineBuf += out.slice(this.offset);
      this.offset = out.length;

      let nl = this.lineBuf.indexOf("\n");
      while (nl >= 0) {
        const line = this.lineBuf.slice(0, nl).trim();
        this.lineBuf = this.lineBuf.slice(nl + 1);
        if (!line) {
          nl = this.lineBuf.indexOf("\n");
          continue;
        }
        let ev: GraffEvent;
        try {
          ev = JSON.parse(line) as GraffEvent;
        } catch {
          if (this.rawNonJson.length < 2000) {
            this.rawNonJson += (this.rawNonJson ? "\n" : "") + line;
          }
          nl = this.lineBuf.indexOf("\n");
          continue;
        }
        switch (ev.type) {
          case "text":
            if (ev.text) {
              if (!this.announcedAnswering) {
                this.announcedAnswering = true;
                events.push({
                  type: "progress",
                  phase: "answering",
                  message: "Writing answer…",
                  elapsedMs: this.elapsed(),
                });
              }
              this.sawText = true;
              this.streamedText += ev.text;
              events.push({ type: "delta", text: ev.text });
            }
            break;
          case "tool_call": {
            const tool = summarizeToolCall(ev.name, ev.input);
            const count = (this.seenTools.get(tool.key) ?? 0) + 1;
            this.seenTools.set(tool.key, count);
            events.push({
              type: "progress",
              phase: tool.kind === "search" ? "searching" : "reading",
              message:
                tool.kind === "search"
                  ? `Searching ${tool.summary.slice(8)}…`
                  : `Reading source ${tool.summary}…`,
              elapsedMs: this.elapsed(),
            });
            events.push({
              type: "tool",
              name: ev.name,
              key: tool.key,
              summary: tool.summary,
              kind: tool.kind,
              duplicate: count > 1,
              count,
            });
            break;
          }
          case "turn":
            this.sawTurn = true;
            this.finalText = ev.text;
            this.costUsd = ev.cost_usd;
            this.contextTokens = ev.context_tokens;
            break;
          case "error":
            events.push({ type: "error", message: ev.message });
            this.done = true;
            return events;
          default:
            break;
        }
        nl = this.lineBuf.indexOf("\n");
      }
    }

    const exitText = await sandbox.readSandboxFile(sid, "/tmp/graff.exit");
    if (exitText !== null) {
      const exitCode = Number.parseInt(exitText.trim(), 10);
      const stderr =
        (await sandbox.readSandboxFile(sid, "/tmp/graff.err")) ?? "";
      events.push(...(await this.finalize(sandbox, exitCode, stderr)));
      this.done = true;
      return events;
    }

    if (this.elapsed() >= RUN_DEADLINE_MS) {
      events.push({ type: "error", message: "sandboxed graff timed out" });
      this.done = true;
      return events;
    }

    const now = Date.now();
    if (now - this.lastHeartbeat > 8000) {
      this.lastHeartbeat = now;
      events.push({
        type: "progress",
        phase: this.sawText ? "answering" : "thinking",
        message: this.sawText ? "Still writing answer…" : "Still researching…",
        elapsedMs: this.elapsed(now),
      });
    }
    return events;
  }

  private async finalize(
    sandbox: CubeSandbox,
    exitCode: number,
    stderr: string,
  ): Promise<AgentEvent[]> {
    const sid = this.sandboxId;
    const failureDiag = async (): Promise<string> =>
      (
        this.rawNonJson.trim() ||
        stderr.trim() ||
        (sid
          ? ((await sandbox.readSandboxFile(sid, "/tmp/graff.out")) ?? "")
          : ""
        ).trim()
      ).slice(0, 800);

    if (exitCode && exitCode !== 0) {
      const diag = await failureDiag();
      return [
        {
          type: "error",
          message: diag
            ? `sandboxed graff exited with ${exitCode}: ${diag}`
            : `sandboxed graff exited with ${exitCode}`,
        },
      ];
    }
    if (!this.sawTurn && this.streamedText) {
      this.finalText = this.streamedText;
    } else if (!this.sawTurn) {
      const diag = await failureDiag();
      return [
        {
          type: "error",
          message: diag
            ? `sandboxed graff ended before producing an answer: ${diag}`
            : "sandboxed graff ended before producing an answer (no output)",
        },
      ];
    }
    return [
      {
        type: "done",
        text: this.finalText,
        costUsd: this.costUsd,
        contextTokens: this.contextTokens,
      },
    ];
  }
}
