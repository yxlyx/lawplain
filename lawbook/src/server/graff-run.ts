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
import { normalizeToolRejected } from "../lib/agent-event-normalizer";
import { summarizeToolCall } from "../lib/agent-tool-summary";
import { type CubeSandbox, GRAFF_BIN_PATH } from "../lib/cubesandbox";
import { ReasoningSanitizer, sanitizeAnswer } from "../lib/reasoning-sanitizer";
import {
  boundedText,
  MAX_ASK_TEXT_BYTES,
  safeAgentError,
} from "./ask-security";

/** graff `--json` stdout events. */
type GraffEvent =
  | { type: "reasoning" | "text"; text?: string }
  | { type: "tool_call"; name: string; input?: unknown }
  | {
      type: "tool_rejected";
      name: string;
      reason: "budget" | "duplicate";
      message?: string;
    }
  | { type: "turn"; text: string; cost_usd: number; context_tokens: number }
  | { type: "error"; message: string };

export interface GraffRunParams {
  model: string;
  providerEnv: Record<string, string>;
  prompt: string;
  systemPrompt: string;
  toolCallBudget: number;
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
  private sanitizer = new ReasoningSanitizer();
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
    onSandboxCreated?: (sandboxId: string) => void | Promise<void>,
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
    await onSandboxCreated?.(sid);

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
      TOOL_CALL_BUDGET: String(
        Math.min(6, Math.max(1, Math.trunc(params.toolCallBudget))),
      ),
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
        `rm -f /tmp/graff.out /tmp/graff.err /tmp/graff.exit /tmp/graff.launch; nohup /bin/bash -lc 'printf %s "$PROMPT_JSON" | "$GRAFF_BIN" --json --yolo --no-telemetry --max-tool-calls "$TOOL_CALL_BUDGET" --dedupe-tool-calls --model "$MODEL" --system-prompt "$SYSTEM_PROMPT" > /tmp/graff.out 2> /tmp/graff.err; echo $? > /tmp/graff.exit' > /tmp/graff.launch 2>&1 < /dev/null & echo $!`,
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

    const rawOut = (await sandbox.readSandboxFile(sid, "/tmp/graff.out")) ?? "";
    const boundedOut = boundedText(rawOut, MAX_ASK_TEXT_BYTES);
    const out = boundedOut.text;
    if (boundedOut.truncated && this.offset >= out.length) {
      this.done = true;
      return [{ type: "error", message: safeAgentError() }];
    }
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
              const remaining =
                MAX_ASK_TEXT_BYTES -
                new TextEncoder().encode(this.streamedText).length;
              const clean = this.sanitizer.push(ev.text);
              const text = boundedText(clean, Math.max(0, remaining));
              this.streamedText += text.text;
              if (text.text) events.push({ type: "delta", text: text.text });
              if (text.truncated) {
                this.done = true;
                return [
                  ...events,
                  { type: "error", message: safeAgentError() },
                ];
              }
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
          case "tool_rejected":
            events.push(normalizeToolRejected(ev));
            break;
          case "turn":
            this.sawTurn = true;
            this.finalText = sanitizeAnswer(ev.text);
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

    const tail = this.sanitizer.finish();
    this.streamedText += tail;
    const tailEvents: AgentEvent[] = tail
      ? [{ type: "delta", text: tail }]
      : [];
    if (exitCode && exitCode !== 0) {
      const diag = await failureDiag();
      return [
        ...tailEvents,
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
        ...tailEvents,
        {
          type: "error",
          message: diag
            ? `sandboxed graff ended before producing an answer: ${diag}`
            : "sandboxed graff ended before producing an answer (no output)",
        },
      ];
    }
    return [
      ...tailEvents,
      {
        type: "done",
        text: this.finalText,
        costUsd: this.costUsd,
        contextTokens: this.contextTokens,
      },
    ];
  }
}
